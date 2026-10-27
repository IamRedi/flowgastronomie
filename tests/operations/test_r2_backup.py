"""Focused local safety tests: fake object store, no credentials/network."""
import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from collections import namedtuple

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("r2_backup", ROOT / "infra/staging/r2_backup.py")
r2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r2)


class Store:
    def __init__(self, corrupt=False, receipt_corrupt=False, weekly_fail=False):
        self.objects = {}
        self.corrupt, self.receipt_corrupt, self.weekly_fail = corrupt, receipt_corrupt, weekly_fail

    def put(self, key, path):
        if key in self.objects or (self.weekly_fail and key.startswith("weekly/")):
            raise RuntimeError("write rejected")
        self.objects[key] = Path(path).read_bytes()

    def get(self, key, path):
        data = self.objects[key]
        if (self.corrupt and key.endswith(".age")) or (self.receipt_corrupt and key.endswith(".json")):
            data += b"corrupt"
        Path(path).write_bytes(data)


class BackupTests(unittest.TestCase):
    def test_production_bucket_is_explicit_and_other_projects_are_rejected(self):
        self.assertEqual(r2.configured_bucket({}), 'flowgastronomie-staging-backups')
        self.assertEqual(r2.configured_bucket({'FLOW_R2_BUCKET': 'flowgastronomie-production-backups'}), 'flowgastronomie-production-backups')
        for value in ['businesssite-rc-recovery-backups', '', '../production']:
            with self.assertRaises(ValueError):
                r2.configured_bucket({'FLOW_R2_BUCKET': value})

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.stem = "flowgastronomie-20261013T151003Z"
        for suffix, data in ((".dump", b"synthetic dump"), (".media.tar.gz", b"synthetic media")):
            path = self.root / (self.stem + suffix)
            path.write_bytes(data)
            Path(str(path) + ".sha256").write_text(r2.digest(path) + "  /backups/" + path.name + "\n")
        (self.root / (self.stem + ".complete")).touch()
        self.cipher = self.root / "fake-cipher.age"
        self.cipher.write_bytes(b"unit-test ciphertext placeholder, not age acceptance")

    def test_two_distinct_public_recipients_only(self):
        path = self.root / "recipients.txt"
        for data in ("age1" + "q" * 58, "\n".join(["age1" + "q" * 58] * 2), "AGE-SECRET-KEY-forbidden"):
            path.write_text(data)
            with self.assertRaises(ValueError):
                r2.recipients(path)
        path.write_text("age1" + "q" * 58 + "\nage1" + "p" * 58)
        self.assertEqual(len(r2.recipients(path)), 2)

    def test_missing_completion_or_corrupt_source_refused(self):
        marker = self.root / (self.stem + ".complete")
        marker.unlink()
        with self.assertRaises(ValueError):
            r2.bundle_files(self.root, self.stem)
        marker.touch()
        (self.root / (self.stem + ".dump")).write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            r2.bundle_files(self.root, self.stem)

    def test_manifest_contains_actual_file_hashes_and_unchanged_contract(self):
        files = r2.bundle_files(self.root, self.stem)
        target = self.root / "bundle.tar"
        r2.pack(files, target, ["public-primary", "public-recovery"])
        with tarfile.open(target) as archive:
            manifest = json.load(archive.extractfile("manifest.json"))
            self.assertEqual(len(archive.getnames()), 6)
            for path in files:
                self.assertEqual(manifest["files"][path.name]["sha256"], r2.digest(path))
                self.assertEqual(archive.extractfile(path.name).read(), path.read_bytes())

    def test_production_manifest_requires_its_own_verified_restore_baseline(self):
        files = r2.bundle_files(self.root, self.stem)
        with patch.object(r2, 'BUCKET', 'flowgastronomie-production-backups'):
            with patch.dict(r2.os.environ, {}, clear=True):
                with self.assertRaises(KeyError):
                    r2.pack(files, self.root/'missing.tar', ['primary', 'recovery'])
            with patch.dict(r2.os.environ, {'FLOW_R2_ACCEPTANCE_TABLES': '115', 'FLOW_R2_ACCEPTANCE_MIGRATIONS': '65'}):
                manifest = r2.pack(files, self.root/'production.tar', ['primary', 'recovery'])
                self.assertEqual(manifest['acceptanceBaseline'], {'tables':115, 'migrations':65})

    def test_remote_mismatch_sends_failure_and_no_receipt(self):
        store, events = Store(corrupt=True), []
        with self.assertRaises(ValueError):
            r2.execute(store, self.cipher, ["daily"], self.root, events.append)
        self.assertEqual(events, [False])
        self.assertFalse(any(k.endswith(".json") for k in store.objects))
        self.assertTrue(self.cipher.exists())

    def test_receipt_mismatch_never_signals_success(self):
        events = []
        with self.assertRaises(ValueError):
            r2.execute(Store(receipt_corrupt=True), self.cipher, ["daily"], self.root, events.append)
        self.assertEqual(events, [False])

    def test_weekly_failure_does_not_report_overall_success(self):
        events = []
        with self.assertRaises(RuntimeError):
            r2.execute(Store(weekly_fail=True), self.cipher, ["daily", "weekly"], self.root, events.append)
        self.assertEqual(events, [False])

    def test_success_after_all_downloads(self):
        store, events = Store(), []
        receipts = r2.execute(store, self.cipher, ["daily", "weekly"], self.root, events.append)
        self.assertEqual(events, [True])
        self.assertEqual(len(store.objects), 4)
        self.assertEqual(len(receipts), 2)

    def test_immutable_retry_verifies_identical_existing_bytes(self):
        from botocore.exceptions import ClientError
        from unittest.mock import Mock
        store = object.__new__(r2.BotoR2)
        store.client = Mock()
        store.client.put_object.side_effect = ClientError(
            {'ResponseMetadata': {'HTTPStatusCode': 412}, 'Error': {'Code': 'PreconditionFailed'}}, 'PutObject')
        store.get = lambda key, path: Path(path).write_bytes(self.cipher.read_bytes())
        store.put('daily/test', self.cipher)
        store.get = lambda key, path: Path(path).write_bytes(b'different')
        with self.assertRaises(ValueError):
            store.put('daily/test', self.cipher)
        self.assertEqual(store.client.put_object.call_count, 2)

    def test_stream_retry_is_bounded(self):
        from botocore.exceptions import ReadTimeoutError
        from unittest.mock import Mock
        store = object.__new__(r2.BotoR2)
        store.client = Mock()
        store.client.get_object.side_effect = ReadTimeoutError(endpoint_url='redacted')
        with patch.object(r2.time, 'sleep'):
            with self.assertRaises(ReadTimeoutError):
                store.get('daily/test', self.root/'retry')
        self.assertEqual(store.client.get_object.call_count, 3)

    def test_no_non_eu_endpoint(self):
        with self.assertRaises(ValueError):
            r2.R2("https://" + "a" * 32 + ".r2.cloudflarestorage.com")

    def test_local_disk_reserve_fails_closed_without_deletion(self):
        usage = namedtuple("Usage", "total used free")
        with patch.object(r2.shutil, "disk_usage", return_value=usage(100*1024**3, 99*1024**3, 1024**3)):
            with self.assertRaises(ValueError):
                r2.disk_guard(self.root, 1000)
        self.assertTrue(self.cipher.exists())

    def test_healthchecks_start_never_uses_success_endpoint(self):
        with patch.object(r2.urllib.request, "urlopen") as call:
            call.return_value.__enter__.return_value.status = 200
            url = "https://hc-ping.com/" + "0"*36
            r2.ping(url, "start")
            self.assertEqual(call.call_args.args[0].full_url, url + "/start")
            self.assertEqual(call.call_args.args[0].data, b"")

    def test_budget_must_be_fresh_account_wide_and_below_limit(self):
        obs = dict(scope="all-account-r2-standard", observedAt=100000, storageBytes=2510000,
                   forecastStorageBytes=2510000, classA=35, classB=65)
        self.assertFalse(r2.budget_guard(obs, 1_000_000, 100010))
        for change in ({"observedAt": 0}, {"scope": "flow-only"}, {"storageBytes": 9_000_000_000}):
            with self.assertRaises(ValueError):
                r2.budget_guard({**obs, **change}, 1_000_000, 100010)
        self.assertTrue(r2.budget_guard({**obs, "storageBytes": 8_000_000_000}, 0, 100010))

    def test_retention_requires_new_verified_successor_and_expired_receipt_lock(self):
        now = 2_000_000
        records = [dict(key=f"daily/{i}", cadence="daily", verified=True,
                        createdAt=now-i*86400, receiptCreatedAt=now-i*86400+60,
                        verifiedAt=now) for i in range(9)]
        self.assertEqual(r2.retention_plan(records, "daily", records[0], now), ["daily/8"])
        self.assertEqual(r2.retention_plan(records, "daily", {**records[0], "verified": False}, now), [])
        self.assertEqual(r2.retention_plan(records, "weekly", records[0], now), [])
        self.assertEqual(r2.retention_plan(records, "daily", records[0], now+3601), [])
        self.assertEqual(len(records), 9)  # Planner did not mutate inventory.


if __name__ == "__main__":
    unittest.main()

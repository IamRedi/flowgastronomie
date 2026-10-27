"""Inactive M2 upload candidate. No scheduler, credentials, keys or deletion API.

Run only after owner authorization and provisioning. Retention output is a plan;
automatic deletion remains disarmed until real recovery/lock acceptance passes.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import uuid


def configured_bucket(environment):
    value = environment.get('FLOW_R2_BUCKET', 'flowgastronomie-staging-backups')
    if value not in ('flowgastronomie-staging-backups', 'flowgastronomie-production-backups'):
        raise ValueError('Unapproved backup bucket')
    return value


BUCKET = configured_bucket(os.environ)
POLICIES = {"daily": (7, 7 * 86400), "weekly": (4, 28 * 86400)}


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def recipients(path):
    values = [line.strip() for line in Path(path).read_text().splitlines()
              if line.strip() and not line.lstrip().startswith("#")]
    if len(values) != 2 or len(set(values)) != 2 or any(
        not re.fullmatch(r"age1[0-9a-z]{58}", value) for value in values
    ):
        raise ValueError("Exactly two distinct native age public recipients required")
    return values


def bundle_files(directory, stem):
    if not re.fullmatch(r"flowgastronomie-\d{8}T\d{6}Z", stem):
        raise ValueError("Invalid bundle identifier")
    directory = Path(directory).resolve()
    files = [directory / (stem + suffix) for suffix in (
        ".dump", ".dump.sha256", ".media.tar.gz", ".media.tar.gz.sha256", ".complete")]
    if any(path.is_symlink() or not path.is_file() for path in files):
        raise ValueError("Complete regular-file bundle required")
    if files[0].stat().st_size == 0 or files[2].stat().st_size == 0:
        raise ValueError("Empty backup payload")
    for payload, sidecar in ((files[0], files[1]), (files[2], files[3])):
        parts = sidecar.read_text().strip().split(maxsplit=1)
        if len(parts) != 2 or parts[1].lstrip("*") != "/backups/" + payload.name:
            raise ValueError("Unexpected checksum path")
        if parts[0] != digest(payload):
            raise ValueError("Source checksum mismatch")
    return files


def pack(files, output, public_keys):
    baseline = {"tables": 114, "migrations": 61}
    if BUCKET == 'flowgastronomie-production-backups':
        baseline = {key: int(os.environ['FLOW_R2_ACCEPTANCE_'+key.upper()])
                    for key in ('tables', 'migrations')}
        if any(value < 1 for value in baseline.values()):
            raise ValueError('Verified production restore baseline required')
    manifest = {"format": "flow-m2-v1", "postgresMajor": 18,
                "acceptanceBaseline": baseline,
                "recipients": public_keys,
                "files": {p.name: {"bytes": p.stat().st_size, "sha256": digest(p)}
                          for p in files}}
    data = json.dumps(manifest, sort_keys=True).encode()
    with tarfile.open(output, "x") as archive:
        for path in files:
            archive.add(path, arcname=path.name, recursive=False)
        entry = tarfile.TarInfo("manifest.json")
        entry.size, entry.mode = len(data), 0o600
        archive.addfile(entry, io.BytesIO(data))
    return manifest


def budget_guard(observation, upload_bytes, now):
    # Fresh account-wide telemetry must include BusinessSite, not only this bucket.
    if observation.get("scope") != "all-account-r2-standard":
        raise ValueError("Account-wide budget observation required")
    age = now - observation["observedAt"]
    if not 0 <= age <= 86400:
        raise ValueError("Budget telemetry stale or in future")
    projected = max(observation["storageBytes"], observation["forecastStorageBytes"]) + upload_bytes
    a, b = observation["classA"], observation["classB"]
    if min(projected, a, b) < 0 or projected >= 9_000_000_000 or a + 100 >= 900_000 or b + 100 >= 9_000_000:
        raise ValueError("No-cost safety threshold reached")
    return projected >= 8_000_000_000 or a >= 800_000 or b >= 8_000_000


def retention_plan(records, cadence, successor, now):
    """Never deletes. Requires a fresh verified successor in the same cadence."""
    keep, seconds = POLICIES[cadence]
    if successor.get("cadence") != cadence or not successor.get("verified"):
        return []
    if not 0 <= now - successor["verifiedAt"] <= 3600:
        return []
    scoped = [r for r in records if r.get("cadence") == cadence]
    if any(not r.get("verified") for r in scoped):
        return []  # Unknown/incomplete inventory requires operator review.
    if len({r["key"] for r in scoped}) != len(scoped):
        return []
    if successor["key"] not in {r["key"] for r in scoped}:
        return []
    ordered = sorted(scoped, key=lambda r: r["createdAt"], reverse=True)
    if not ordered or ordered[0]["key"] != successor["key"]:
        return []
    candidates = []
    for item in ordered[keep:]:
        # Receipt can have been written after the archive: use the later lock.
        until = max(item["createdAt"], item["receiptCreatedAt"]) + seconds
        if item["key"].startswith(cadence + "/") and now >= until:
            candidates.append(item["key"])
    return candidates


def quiet_run(args):
    result = subprocess.run(args, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=900, check=False)
    if result.returncode:
        raise RuntimeError("External backup step failed; provider output suppressed")


class R2:
    def __init__(self, endpoint):
        if not re.fullmatch(r"https://[a-f0-9]{32}\.eu\.r2\.cloudflarestorage\.com", endpoint):
            raise ValueError("Explicit EU endpoint required")
        self.args = ["aws", "--endpoint-url", endpoint, "--region", "auto",
                     "--no-cli-pager", "s3api"]

    def put(self, key, path):
        quiet_run(self.args + ["put-object", "--bucket", BUCKET, "--key", key,
                              "--body", str(path), "--if-none-match", "*",
                              "--storage-class", "STANDARD"])

    def get(self, key, path):
        quiet_run(self.args + ["get-object", "--bucket", BUCKET, "--key", key, str(path)])


class BotoR2:
    """Bounded SDK retry; ambiguous immutable PUT is accepted only after GET/hash."""
    def __init__(self, credential, endpoint):
        import boto3
        from botocore.config import Config
        c = json.loads(Path(credential).read_text(encoding="utf-8-sig"))
        R2(endpoint)  # Validate EU without invoking the legacy CLI.
        if c['bucket'] != BUCKET or c['endpoint'] != endpoint:
            raise ValueError('Credential target mismatch')
        self.client = boto3.client('s3', endpoint_url=endpoint, region_name='auto',
            aws_access_key_id=c['accessKeyId'], aws_secret_access_key=c['secretAccessKey'],
            config=Config(connect_timeout=10, read_timeout=60,
                          retries={'mode': 'standard', 'total_max_attempts': 3}))

    def put(self, key, path):
        from botocore.exceptions import ClientError
        try:
            with Path(path).open('rb') as body:
                self.client.put_object(Bucket=BUCKET, Key=key, Body=body,
                                       IfNoneMatch='*', StorageClass='STANDARD')
        except ClientError as error:
            if error.response.get('ResponseMetadata', {}).get('HTTPStatusCode') not in (409, 412):
                raise
            with tempfile.TemporaryDirectory(prefix='flow-r2-retry-') as work:
                downloaded = Path(work)/'existing'
                self.get(key, downloaded)
                if digest(downloaded) != digest(path) or downloaded.stat().st_size != Path(path).stat().st_size:
                    raise ValueError('Immutable existing object differs') from None

    def get(self, key, path):
        # SDK retries requests; retry interrupted response streams with a fresh GET.
        from botocore.exceptions import BotoCoreError
        for attempt in range(3):
            try:
                stream = self.client.get_object(Bucket=BUCKET, Key=key)['Body']
                try:
                    with Path(path).open('wb') as target:
                        shutil.copyfileobj(stream, target, 1024*1024)
                finally:
                    stream.close()
                return
            except BotoCoreError:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)


def publish(store, encrypted, cadence, work):
    checksum = digest(encrypted)
    key = f"{cadence}/{uuid.uuid4().hex}-{checksum}.tar.age"
    store.put(key, encrypted)
    downloaded = Path(work) / f"{cadence}.download.age"
    store.get(key, downloaded)
    if downloaded.stat().st_size != encrypted.stat().st_size or digest(downloaded) != checksum:
        raise ValueError("Remote ciphertext verification failed")
    receipt = {"key": key, "sha256": checksum, "bytes": encrypted.stat().st_size,
               "verifiedAt": int(time.time()), "verification": "full-get-sha256"}
    receipt_path = Path(work) / f"{cadence}.receipt.json"
    receipt_path.write_text(json.dumps(receipt, sort_keys=True))
    store.put(key + ".receipt.json", receipt_path)
    receipt_download = Path(work) / f"{cadence}.receipt.download.json"
    store.get(key + ".receipt.json", receipt_download)
    if digest(receipt_path) != digest(receipt_download):
        raise ValueError("Remote receipt verification failed")
    return receipt


def disk_guard(directory, payload_bytes, reserve_bytes=None):
    usage = shutil.disk_usage(directory)
    reserve = max(2 * 1024**3, int(usage.total * 0.10)) if reserve_bytes is None else max(2 * 1024**3, reserve_bytes)
    if usage.free - payload_bytes * 4 < reserve:
        raise ValueError("Local disk reserve insufficient; preserve backups and alert")


def ping(url, success):
    if not re.fullmatch(r"https://hc-ping\.com/[a-f0-9-]{36}", url):
        raise ValueError("Dedicated Healthchecks URL required")
    # No response body, backup data, URL, exceptions or credentials in logs.
    suffix = "/start" if success == "start" else ("" if success is True else "/fail")
    request = urllib.request.Request(url + suffix, data=b"", method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status != 200:
            raise RuntimeError("External monitor acknowledgement failed")


def execute(store, encrypted, cadences, work, signal):
    try:
        receipts = [publish(store, encrypted, cadence, work) for cadence in cadences]
        signal(True)
        return receipts
    except Exception:
        try:
            signal(False)
        except Exception:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-directory", type=Path, required=True)
    parser.add_argument("--stem", required=True)
    parser.add_argument("--recipients", type=Path, required=True)
    parser.add_argument("--budget-observation", type=Path, required=True)
    parser.add_argument("--eu-endpoint", required=True)
    parser.add_argument("--weekly-due", action="store_true")
    parser.add_argument("--execute-authorized-upload", action="store_true")
    parser.add_argument("--credential", type=Path)
    parser.add_argument("--proof-output", type=Path)
    parser.add_argument("--defer-success", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    signal_url = os.environ.get("FLOW_HEALTHCHECKS_URL", "")
    execution_started = False
    try:
        keys = recipients(args.recipients)
        files = bundle_files(args.bundle_directory, args.stem)
        store = BotoR2(args.credential, args.eu_endpoint) if args.credential else R2(args.eu_endpoint)
        if not args.execute_authorized_upload:
            print("PREFLIGHT ONLY: bundle and recipients valid; no upload, ping or deletion")
            return 0
        if not signal_url:
            raise ValueError("External monitor must be configured before activation")
        if not args.defer_success:
            ping(signal_url, "start")
        disk_guard(tempfile.gettempdir(), sum(p.stat().st_size for p in files))
        with tempfile.TemporaryDirectory(prefix="flow-r2-") as temporary:
            work = Path(temporary)
            plain, encrypted = work / "bundle.tar", work / "bundle.tar.age"
            pack(files, plain, keys)
            quiet_run(["age", "-r", keys[0], "-r", keys[1], "-o", str(encrypted), str(plain)])
            cadences = ["daily", "weekly"] if args.weekly_due else ["daily"]
            observation = json.loads(args.budget_observation.read_text())
            if budget_guard(observation, (encrypted.stat().st_size + 4096) * len(cadences), time.time()):
                raise ValueError("Quota warning: owner review required before further upload")
            execution_started = True
            receipts = execute(store, encrypted, cadences, work,
                lambda ok: None if ok and args.defer_success else ping(signal_url, ok))
            if args.proof_output:
                proof = {'stem': args.stem, 'receipts': receipts, 'remoteSHA256': 'PASS',
                         'completedAt': int(time.time()), 'localDeletion': False}
                temporary_proof = args.proof_output.with_suffix('.partial')
                temporary_proof.write_text(json.dumps(proof, indent=2))
                temporary_proof.replace(args.proof_output)
        print("Remote bytes verified; no backups deleted; recovery acceptance is separate")
        return 0
    except Exception:
        if args.execute_authorized_upload and signal_url and not execution_started:
            try:
                ping(signal_url, False)
            except Exception:
                pass
        print("Backup preflight/upload failed; no backups deleted", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

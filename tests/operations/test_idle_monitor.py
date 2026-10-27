import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("monitor", ROOT / "infra/staging/monitor.py")
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class IdleMonitorTest(unittest.TestCase):
    def test_default_always_checks_database(self):
        self.assertTrue(monitor.database_probe_due({}, now=1000))

    def test_interval_bounds_fail_closed(self):
        for interval in (1, 299, 1801, -1):
            with self.assertRaises(ValueError):
                monitor.database_probe_due({"FLOW_DB_PROBE_INTERVAL_SECONDS": str(interval)})

    def test_missing_corrupt_future_and_expired_state_require_probe(self):
        with tempfile.TemporaryDirectory() as directory:
            state = pathlib.Path(directory) / "probe.json"
            env = {"FLOW_DB_PROBE_INTERVAL_SECONDS": "900", "FLOW_DB_PROBE_STATE": str(state)}
            self.assertTrue(monitor.database_probe_due(env, now=1000))
            for text in ("invalid", "{}", json.dumps({"lastSuccessfulProbe": 1001}), json.dumps({"lastSuccessfulProbe": 100})):
                state.write_text(text)
                self.assertTrue(monitor.database_probe_due(env, now=1000))

    def test_success_allows_idle_then_expires_exactly_at_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            state = pathlib.Path(directory) / "probe.json"
            env = {"FLOW_DB_PROBE_INTERVAL_SECONDS": "900", "FLOW_DB_PROBE_STATE": str(state)}
            monitor.record_database_probe(env, now=1000)
            self.assertFalse(monitor.database_probe_due(env, now=1899))
            self.assertTrue(monitor.database_probe_due(env, now=1900))


if __name__ == "__main__":
    unittest.main()

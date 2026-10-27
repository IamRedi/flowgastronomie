import importlib.util
from pathlib import Path
import unittest


source = Path(__file__).resolve().parents[2] / 'infra/staging/monitor.py'
spec = importlib.util.spec_from_file_location('flow_monitor', source)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class MonitorIsolation(unittest.TestCase):
    def test_default_retains_staging_target(self):
        wrapper, prefix = monitor.monitor_target({})
        self.assertEqual(wrapper, '/opt/flowgastronomie/current/infra/staging/compose.sh')
        self.assertEqual(prefix, 'flowgastronomie')

    def test_production_cannot_monitor_staging_jobs_by_accident(self):
        wrapper, prefix = monitor.monitor_target({'FLOW_MONITOR_SCOPE': 'production'})
        self.assertEqual(wrapper, '/opt/flowgastronomie-public/current/infra/production/public-compose.sh')
        self.assertEqual(prefix, 'flowgastronomie-public')

    def test_invalid_scope_fails_closed(self):
        with self.assertRaises(ValueError):
            monitor.monitor_target({'FLOW_MONITOR_SCOPE': '../../other-project'})

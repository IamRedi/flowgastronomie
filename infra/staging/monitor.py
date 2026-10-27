"""Local failure visibility. No credentials, tracking URLs or log bodies emitted."""

import os
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen


def backup_fresh(directory, now=None):
    now = time.time() if now is None else now
    for marker in Path(directory).glob("flowgastronomie-*.complete"):
        if not 0 <= now - marker.stat().st_mtime <= 26 * 3600:
            continue
        base = str(marker).removesuffix(".complete")
        if all(Path(base + suffix).is_file() and Path(base + suffix).stat().st_size
               for suffix in (".dump", ".dump.sha256", ".media.tar.gz", ".media.tar.gz.sha256")):
            return True
    return False


def monitor_target(environment):
    scope = environment.get('FLOW_MONITOR_SCOPE', 'staging')
    targets = {
        'staging': ('/opt/flowgastronomie/current/infra/staging/compose.sh', 'flowgastronomie'),
        'production': ('/opt/flowgastronomie-public/current/infra/production/public-compose.sh', 'flowgastronomie-public'),
    }
    if scope not in targets:
        raise ValueError('Unknown monitoring scope')
    return targets[scope]


def database_probe_due(environment, now=None):
    """Default remains a fresh DB probe on every monitor run."""
    now = time.time() if now is None else now
    raw = environment.get("FLOW_DB_PROBE_INTERVAL_SECONDS", "0")
    interval = int(raw)
    if interval == 0:
        return True
    if not 300 <= interval <= 1800:
        raise ValueError("Database probe interval must be 0 or 300..1800")
    state = Path(environment["FLOW_DB_PROBE_STATE"])
    try:
        previous = json.loads(state.read_text())["lastSuccessfulProbe"]
        age = now - float(previous)
        return not 0 <= age < interval
    except (OSError, ValueError, TypeError, KeyError):
        return True


def record_database_probe(environment, now=None):
    if int(environment.get("FLOW_DB_PROBE_INTERVAL_SECONDS", "0")) == 0:
        return
    state = Path(environment["FLOW_DB_PROBE_STATE"])
    state.write_text(json.dumps({"lastSuccessfulProbe": time.time() if now is None else now}))
    state.chmod(0o600)


def main():
    failures = []
    wrapper, prefix = monitor_target(os.environ)
    compose = ["sh", wrapper]
    for service in ("api", "web", "proxy"):
        try:
            container = subprocess.check_output(compose + ["ps", "-q", service], text=True).strip()
            health = subprocess.check_output(
                ["docker", "inspect", "--format", "{{.State.Health.Status}}", container],
                text=True, stderr=subprocess.DEVNULL).strip()
            if health != "healthy":
                failures.append(service + " unhealthy")
        except Exception:
            failures.append(service + " unavailable")
    due = database_probe_due(os.environ)
    checks = [("WEB_HOST", "/sq"), ("API_HOST", "/health")]
    if due:
        checks.append(("API_HOST", "/ready"))
    database_success = False
    for variable, path in checks:
        try:
            host = os.environ[variable]
            if not host or any(c in host for c in "/:@?#\\"):
                raise ValueError("Invalid hostname")
            with urlopen("https://" + host + path, timeout=20) as response:
                if response.status != 200:
                    raise ValueError("Endpoint unhealthy")
                if path == "/ready":
                    database_success = True
        except Exception:
            failures.append(variable + " HTTPS unavailable")
    if database_success:
        record_database_probe(os.environ)
    try:
        if not backup_fresh(os.environ["BACKUP_DIRECTORY"]):
            failures.append("complete database/media backup older than 26h or missing")
        usage = shutil.disk_usage(os.environ["BACKUP_DIRECTORY"])
        if usage.free < max(5 * 1024**3, usage.total * .15):
            failures.append("host disk space low")
    except Exception:
        failures.append("backup storage unavailable")
    for unit in (prefix+"-backup.timer", prefix+"-retention.timer", "certbot.timer"):
        if subprocess.run(["systemctl", "is-active", "--quiet", unit]).returncode:
            failures.append(unit + " inactive")
    if subprocess.run(["systemctl", "is-failed", "--quiet",
                       prefix+"-backup.service", prefix+"-retention.service"]).returncode == 0:
        failures.append("scheduled job failed")
    print("; ".join(failures) if failures else prefix+" health and backup freshness OK")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

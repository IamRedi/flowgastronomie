"""Load root-only configuration without exposing credentials in command arguments."""
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    os.umask(0o077)
    try:
        config_path = Path(sys.argv[1])
        if config_path.stat().st_mode & 0o077:
            raise ValueError('Configuration must be owner-only')
        config = json.loads(config_path.read_text())
        if any(not k.startswith('FLOW_R2_') for k in config):
            raise ValueError('Unexpected setting')
        environment = dict(os.environ, **config)
        monitor = json.loads(Path(config['FLOW_R2_MONITOR_CREDENTIAL']).read_text())
        environment['FLOW_HEALTHCHECKS_URL'] = monitor['backup']
        environment['PATH'] = '/opt/flowgastronomie/r2-venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
        job = Path(config['FLOW_R2_CODE_DIRECTORY'])/'infra/staging/r2-job.proposed.sh'
        return subprocess.call(['/bin/sh', str(job)], env=environment)
    except Exception:
        print('R2 launcher failed; protected configuration requires operator review', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

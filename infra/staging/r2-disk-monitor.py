"""Record local capacity/growth and fail safely before backup exhaustion."""
import json
from pathlib import Path
import shutil
import time
from r2_backup import disk_guard

directory = Path('/var/backups/flowgastronomie')
output = Path('/var/lib/flowgastronomie/r2-monitor/disk.json')
previous = json.loads(output.read_text()) if output.exists() else {}
usage = shutil.disk_usage(directory)
backup_bytes = sum(p.stat().st_size for p in directory.iterdir() if p.is_file())
observation = dict(observedAt=int(time.time()), totalBytes=usage.total,
    freeBytes=usage.free, usedBytes=usage.used, backupBytes=backup_bytes,
    backupGrowthBytes=backup_bytes-previous.get('backupBytes', backup_bytes),
    previousObservedAt=previous.get('observedAt'), localDeletion=False)
output.with_suffix('.partial').write_text(json.dumps(observation, indent=2))
output.with_suffix('.partial').replace(output)
print(json.dumps(observation))
disk_guard(directory, 1073741824)
if usage.used / usage.total >= 0.80:
    raise SystemExit('Disk usage >=80%; preserve backups and alert')

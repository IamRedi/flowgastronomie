"""Translate the direct Neon URI into libpq defaults without secret argv."""

import os
import subprocess
import sys
import tempfile
from urllib.parse import parse_qsl, unquote, urlsplit


def main():
    password_file = None
    try:
        uri = urlsplit(os.environ["DATABASE_URL_DIRECT"])
        if uri.scheme not in ("postgres", "postgresql") or not uri.hostname:
            raise ValueError("PostgreSQL URI required")
        host = uri.hostname
        port = str(uri.port or 5432)
        database = unquote(uri.path.removeprefix("/"))
        user = unquote(uri.username or "")
        password = unquote(uri.password or "")
        if not all((database, user, password)):
            raise ValueError("Complete connection required")
        env = {key: value for key, value in os.environ.items()
               if not key.startswith("PG") and key != "DATABASE_URL_DIRECT"}
        env.update(PGHOST=host, PGPORT=port, PGDATABASE=database, PGUSER=user,
                   PGSSLMODE="require", PGCONNECT_TIMEOUT="15")
        parameters = {
            "sslmode": "PGSSLMODE", "channel_binding": "PGCHANNELBINDING",
            "connect_timeout": "PGCONNECT_TIMEOUT", "application_name": "PGAPPNAME",
            "sslrootcert": "PGSSLROOTCERT", "options": "PGOPTIONS",
        }
        for key, value in parse_qsl(uri.query, keep_blank_values=True):
            if key not in parameters or not value:
                raise ValueError("Unsupported libpq connection option")
            env[parameters[key]] = value

        def escape(value):
            if "\n" in value or "\r" in value:
                raise ValueError("Invalid password-file field")
            return value.replace("\\", "\\\\").replace(":", "\\:")

        with tempfile.NamedTemporaryFile(mode="w", delete=False) as credential:
            password_file = credential.name
            os.chmod(password_file, 0o600)
            credential.write(":".join(map(escape, (host, port, database, user, password))) + "\n")
        env["PGPASSFILE"] = password_file
        return subprocess.run(["sh", "/opt/backup.sh"], env=env, check=False).returncode
    except Exception:
        # Provider credentials and URI parser errors must never enter job logs.
        print("Logical backup configuration/execution failed", file=sys.stderr)
        return 1
    finally:
        if password_file is not None:
            os.unlink(password_file)


if __name__ == "__main__":
    sys.exit(main())

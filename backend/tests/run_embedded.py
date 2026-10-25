"""Run pytest on disposable embedded PostgreSQL without Docker or hosted access.

From backend:
  uv run --python 3.12 --with pgserver python tests/run_embedded.py -q

Extra arguments are passed to pytest unchanged. pgserver is an invocation-only
dependency; application dependencies and the existing Docker runner stay intact.
"""

import asyncio
import os
import subprocess
import sys
import tempfile

import pgserver
from verify_migration_paths import ROOT, fresh_install


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="tmm-tests-") as directory:
        server = pgserver.get_server(directory, cleanup_mode="stop")
        try:
            uri = server.get_uri()
            asyncio.run(fresh_install(uri))
            env = os.environ.copy()
            env["TEST_DATABASE_URL"] = uri
            env["DATABASE_URL"] = uri
            return subprocess.run(
                [sys.executable, "-m", "pytest", *sys.argv[1:]],
                cwd=ROOT / "backend",
                env=env,
                check=False,
            ).returncode
        finally:
            server.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())

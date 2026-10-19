import os
from pathlib import Path


directory = Path(os.environ["PROMETHEUS_MULTIPROC_DIR"])
if directory != Path("/var/lib/legal-service-hub/metrics"):
    raise RuntimeError("拒绝清理未知监控目录")
directory.mkdir(mode=0o750, parents=True, exist_ok=True)
for path in directory.glob("*.db"):
    if path.is_file() and not path.is_symlink():
        path.unlink()

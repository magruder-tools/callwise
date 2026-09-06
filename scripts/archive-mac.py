"""Archive a built app while preserving macOS framework symlinks.

Use after: electron-builder --mac --dir --arm64 --publish never
This avoids expanding symlinks into repeated framework binaries on Linux.
"""
from pathlib import Path
import os
import stat
import zipfile

root = Path(__file__).resolve().parents[1]
app = root / 'release/mac-arm64/Callwise.app'
if not app.is_dir():
    raise SystemExit('Build the Apple Silicon app directory first.')
destination = root / 'dist/Callwise-macos-arm64-development.zip'
destination.parent.mkdir(exist_ok=True)
links = 0
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for folder, directories, files in os.walk(app, followlinks=False):
        for name in directories + files:
            item = Path(folder) / name
            relative = item.relative_to(app.parent).as_posix()
            if item.is_symlink():
                metadata = zipfile.ZipInfo(relative)
                metadata.create_system = 3
                metadata.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(metadata, os.readlink(item))
                links += 1
            elif item.is_file():
                archive.write(item, relative)
print(f'Created {destination.name}: {destination.stat().st_size:,} bytes, {links} symlinks preserved.')

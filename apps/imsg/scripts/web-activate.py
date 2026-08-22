#!/usr/bin/env python3
"""Atomically activates a staged web dist and retains bounded prior generations."""

from __future__ import annotations

import ctypes
import os
import shutil
import sys
import time
from pathlib import Path

RENAME_SWAP = 0x00000002
AT_FDCWD = -2


def fail(message: str) -> None:
    raise SystemExit(f"web activation: {message}")


def copy_previous_assets(active: Path, staging: Path) -> None:
    manifest = active / ".comma-assets"
    if not manifest.is_file():
        return
    for line in manifest.read_text(encoding="utf-8").splitlines():
        relative = Path(line)
        if relative.is_absolute() or ".." in relative.parts or relative.parts[:2] != ("_expo", "static"):
            fail(f"unsafe previous asset path: {line}")
        source = active / relative
        destination = staging / relative
        if source.is_file() and not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)


def atomic_swap(left: Path, right: Path) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    try:
        renameatx_np = libc.renameatx_np
    except AttributeError:
        fail("atomic directory swap is unavailable on this host")
    renameatx_np.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameatx_np.restype = ctypes.c_int
    result = renameatx_np(
        AT_FDCWD,
        os.fsencode(left),
        AT_FDCWD,
        os.fsencode(right),
        RENAME_SWAP,
    )
    if result != 0:
        error = ctypes.get_errno()
        fail(f"atomic directory swap failed: {os.strerror(error)}")


def archive_name(root: Path, previous_sha: str) -> Path:
    base = previous_sha if len(previous_sha) == 40 and all(char in "0123456789abcdef" for char in previous_sha) else "unknown"
    candidate = root / base
    if not candidate.exists():
        return candidate
    return root / f"{base}-{int(time.time())}"


def prune_archives(root: Path, retention: int) -> None:
    archives = sorted(
        (path for path in root.iterdir() if path.is_dir()),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for path in archives[retention:]:
        shutil.rmtree(path)


def activate(staging: Path, active: Path, archive_root: Path, previous_sha: str, retention: int) -> Path | None:
    if retention < 1:
        fail("retention must be at least one prior generation")
    if not (staging / "index.html").is_file() or not (staging / ".comma-assets").is_file():
        fail("staged release is incomplete")

    archive_root.mkdir(parents=True, exist_ok=True)
    archived: Path | None = None
    if active.exists():
        if not active.is_dir():
            fail(f"active path is not a directory: {active}")
        copy_previous_assets(active, staging)
        atomic_swap(staging, active)
        try:
            archived = archive_name(archive_root, previous_sha)
            os.rename(staging, archived)
            os.utime(archived, None)
            prune_archives(archive_root, retention)
        except Exception:
            rollback_source = archived if archived is not None and archived.is_dir() else staging
            if rollback_source.is_dir():
                atomic_swap(active, rollback_source)
                shutil.rmtree(rollback_source)
            raise
    else:
        os.rename(staging, active)
        prune_archives(archive_root, retention)
    return archived


def rollback(active: Path, archived: Path) -> None:
    if not active.is_dir() or not archived.is_dir():
        fail("rollback requires active and archived directories")
    atomic_swap(active, archived)
    shutil.rmtree(archived)


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "activate":
        if len(sys.argv) != 7:
            fail("usage: web-activate.py activate STAGING ACTIVE ARCHIVE_ROOT PREVIOUS_SHA RETENTION")
        staging, active, archive_root = map(Path, sys.argv[2:5])
        try:
            retention = int(sys.argv[6])
        except ValueError:
            fail("retention must be an integer")
        archived = activate(staging, active, archive_root, sys.argv[5], retention)
        print(archived or "")
        return
    if mode == "rollback":
        if len(sys.argv) != 4:
            fail("usage: web-activate.py rollback ACTIVE ARCHIVED")
        rollback(Path(sys.argv[2]), Path(sys.argv[3]))
        return
    fail("mode must be activate or rollback")


if __name__ == "__main__":
    main()

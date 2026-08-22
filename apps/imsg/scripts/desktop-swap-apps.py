#!/usr/bin/env python3
"""Atomically exchange two adjacent macOS app bundles with renameatx_np."""

import ctypes
import os
import sys

AT_FDCWD = -2
RENAME_SWAP = 0x00000002


def swap(left: str, right: str) -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    renameatx_np = libc.renameatx_np
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
        raise OSError(error, os.strerror(error), f"{left} <-> {right}")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: desktop-swap-apps.py LEFT RIGHT")
    swap(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()

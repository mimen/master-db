#!/bin/bash
set -euo pipefail
skill="$(cd "$(dirname "$0")/.." && pwd)"
build="${TMPDIR:-/tmp}/comma-latency-build"
mkdir -p "$build"
swiftc -O -swift-version 5 "$skill"/native/*.swift -o "$build/comma-latency" -framework AppKit -framework ScreenCaptureKit -framework ApplicationServices
exec "$build/comma-latency" "$@"

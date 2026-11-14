#!/bin/sh
# Universal (arm64 + x86_64) build of the Bluetooth helper -> app/build/dt-ble
set -e
cd "$(dirname "$0")"
OUT=../../build; mkdir -p $OUT
for a in arm64 x86_64; do swiftc -O -target $a-apple-macos11 main.swift -o $OUT/dt-ble-$a; done
lipo -create $OUT/dt-ble-arm64 $OUT/dt-ble-x86_64 -output $OUT/dt-ble
rm $OUT/dt-ble-arm64 $OUT/dt-ble-x86_64
codesign -s - -f $OUT/dt-ble 2>/dev/null || true

#!/usr/bin/env bash
# Bash equivalent of dev.ps1's MSVC environment (rusqlite bundled needs cl.exe).
# Usage: source scripts/dev-env.sh && cargo test
MSVC_VER="14.51.36231"
SDK_VER="10.0.28000.0"
MSVC_ROOT="$HOME/.kairo-dev/msvc"
export PATH="$MSVC_ROOT/VC/Tools/MSVC/$MSVC_VER/bin/Hostx64/x64:$MSVC_ROOT/Windows Kits/10/bin/$SDK_VER/x64:$HOME/.cargo/bin:$PATH"
export CC=cl.exe
export CXX=cl.exe
export INCLUDE="C:\\Users\\jeswa\\.kairo-dev\\msvc\\VC\\Tools\\MSVC\\$MSVC_VER\\include;C:\\Users\\jeswa\\.kairo-dev\\msvc\\Windows Kits\\10\\Include\\$SDK_VER\\ucrt;C:\\Users\\jeswa\\.kairo-dev\\msvc\\Windows Kits\\10\\Include\\$SDK_VER\\shared;C:\\Users\\jeswa\\.kairo-dev\\msvc\\Windows Kits\\10\\Include\\$SDK_VER\\um;C:\\Users\\jeswa\\.kairo-dev\\msvc\\Windows Kits\\10\\Include\\$SDK_VER\\winrt;C:\\Users\\jeswa\\.kairo-dev\\msvc\\Windows Kits\\10\\Include\\$SDK_VER\\cppwinrt"
export LIB="C:\\Users\\jeswa\\.kairo-dev\\msvc\\VC\\Tools\\MSVC\\$MSVC_VER\\lib\\x64;C:\\Users\\jeswa\\.kairo-dev\\msvc\\Windows Kits\\10\\Lib\\$SDK_VER\\ucrt\\x64;C:\\Users\\jeswa\\.kairo-dev\\msvc\\Windows Kits\\10\\Lib\\$SDK_VER\\um\\x64"

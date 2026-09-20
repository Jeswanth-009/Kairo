#!/usr/bin/env bash
# Bash equivalent of dev.ps1's MSVC environment (rusqlite bundled needs cl.exe).
# Usage: source scripts/dev-env.sh && cargo test
# The portable MSVC tree is expected at ~/.kairo-dev/msvc (see dev.ps1).
MSVC_VER="14.51.36231"
SDK_VER="10.0.28000.0"
MSVC_ROOT="$HOME/.kairo-dev/msvc"
# cl.exe/link.exe consume INCLUDE/LIB as Windows paths — convert the bash-style
# $HOME expansion to a drive path (cygpath -m gives C:/... which they accept).
MSVC_WIN="$(cygpath -m "$MSVC_ROOT")"
export PATH="$MSVC_ROOT/VC/Tools/MSVC/$MSVC_VER/bin/Hostx64/x64:$MSVC_ROOT/Windows Kits/10/bin/$SDK_VER/x64:$HOME/.cargo/bin:$PATH"
export CC=cl.exe
export CXX=cl.exe
export INCLUDE="$MSVC_WIN/VC/Tools/MSVC/$MSVC_VER/include;$MSVC_WIN/Windows Kits/10/Include/$SDK_VER/ucrt;$MSVC_WIN/Windows Kits/10/Include/$SDK_VER/shared;$MSVC_WIN/Windows Kits/10/Include/$SDK_VER/um;$MSVC_WIN/Windows Kits/10/Include/$SDK_VER/winrt;$MSVC_WIN/Windows Kits/10/Include/$SDK_VER/cppwinrt"
export LIB="$MSVC_WIN/VC/Tools/MSVC/$MSVC_VER/lib/x64;$MSVC_WIN/Windows Kits/10/Lib/$SDK_VER/ucrt/x64;$MSVC_WIN/Windows Kits/10/Lib/$SDK_VER/um/x64"

$MSVC_ROOT = Join-Path $env:USERPROFILE ".kairo-dev\msvc"
$MSVC_VER = "14.51.36231"
$SDK_VER = "10.0.28000.0"
$env:PATH = "$MSVC_ROOT\VC\Tools\MSVC\$MSVC_VER\bin\Hostx64\x64;$MSVC_ROOT\Windows Kits\10\bin\$SDK_VER\x64;$HOME\.cargo\bin;$env:PATH"
$env:CC = "cl.exe"
$env:CXX = "cl.exe"
$env:INCLUDE = "$MSVC_ROOT\VC\Tools\MSVC\$MSVC_VER\include;$MSVC_ROOT\Windows Kits\10\Include\$SDK_VER\ucrt;$MSVC_ROOT\Windows Kits\10\Include\$SDK_VER\shared;$MSVC_ROOT\Windows Kits\10\Include\$SDK_VER\um;$MSVC_ROOT\Windows Kits\10\Include\$SDK_VER\winrt;$MSVC_ROOT\Windows Kits\10\Include\$SDK_VER\cppwinrt"
$env:LIB = "$MSVC_ROOT\VC\Tools\MSVC\$MSVC_VER\lib\x64;$MSVC_ROOT\Windows Kits\10\Lib\$SDK_VER\ucrt\x64;$MSVC_ROOT\Windows Kits\10\Lib\$SDK_VER\um\x64"

npm run tauri dev

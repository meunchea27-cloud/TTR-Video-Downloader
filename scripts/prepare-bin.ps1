$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null

$ytdlp = Join-Path $bin 'yt-dlp.exe'
$ffmpegZip = Join-Path $env:TEMP 'ttr-ffmpeg.zip'
$ffmpegExtract = Join-Path $env:TEMP 'ttr-ffmpeg-extract'
$ffmpegExe = Join-Path $bin 'ffmpeg.exe'
$ffprobeExe = Join-Path $bin 'ffprobe.exe'

Write-Host 'Downloading yt-dlp...'
Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $ytdlp

Write-Host 'Downloading FFmpeg essentials...'
Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $ffmpegZip
if (Test-Path $ffmpegExtract) { Remove-Item $ffmpegExtract -Recurse -Force }
Expand-Archive -Path $ffmpegZip -DestinationPath $ffmpegExtract -Force

$foundFfmpeg = Get-ChildItem $ffmpegExtract -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
$foundFfprobe = Get-ChildItem $ffmpegExtract -Recurse -Filter 'ffprobe.exe' | Select-Object -First 1
if (-not $foundFfmpeg) { throw 'ffmpeg.exe was not found in the downloaded archive.' }
if (-not $foundFfprobe) { throw 'ffprobe.exe was not found in the downloaded archive.' }
Copy-Item $foundFfmpeg.FullName $ffmpegExe -Force
Copy-Item $foundFfprobe.FullName $ffprobeExe -Force

Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
Remove-Item $ffmpegExtract -Recurse -Force -ErrorAction SilentlyContinue

Write-Host 'Bundled binaries:'
Get-ChildItem $bin | Format-Table Name, Length

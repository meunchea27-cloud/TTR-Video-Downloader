# TTR Video Downloader

Windows desktop video downloader built with Electron, yt-dlp and FFmpeg.

## Included features

- MP4 video and MP3 audio downloads
- 360p / 480p / 720p / 1080p / Best
- Live progress percentage, speed and ETA
- Pause / Resume on Windows
- Cancel download
- Video thumbnail + title preview
- Download history with URL reuse and folder shortcut
- Custom output filename
- Compact UI / smaller display
- Animated progress bar (idle / working / paused / done / error states)
- Remembers the last save folder
- NSIS installer with Desktop and Start Menu shortcuts
- Bundled yt-dlp + FFmpeg; no Node.js required on the installed PC

## Build the Windows installer

On Windows 10/11 with Node.js 18+ installed:

1. Extract this project.
2. Double-click `BUILD-WINDOWS.bat`.
3. Wait for the build to finish.
4. The installer will be in `dist\TTR-Video-Downloader-Setup-1.1.2.exe`.

The build script downloads the current yt-dlp Windows executable and an FFmpeg Windows essentials build, then bundles them into the installer.

## Manual commands

```powershell
npm install
npm run build
```

## Runtime

The finished installer does not require Node.js, yt-dlp, or FFmpeg to be separately installed.

Use the downloader only for content you are authorized to download.

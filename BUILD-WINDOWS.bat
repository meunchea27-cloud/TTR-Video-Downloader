@echo off
setlocal
cd /d "%~dp0"
echo ========================================
echo TTR Video Downloader - Windows Builder
echo ========================================
echo.
where node >nul 2>nul || (echo Node.js is required. Install Node.js 18+ and try again.&pause&exit /b 1)
where npm >nul 2>nul || (echo npm is required.&pause&exit /b 1)
call npm install --no-audit --no-fund
if errorlevel 1 (echo npm install failed.&pause&exit /b 1)
call npm run build
if errorlevel 1 (echo Build failed.&pause&exit /b 1)
echo.
echo BUILD COMPLETE. Check the dist folder for the installer.
pause

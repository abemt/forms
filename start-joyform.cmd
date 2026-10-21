@echo off
rem Starts the Form 680 AutoNotes app (already built) on http://localhost:8787 and keeps every saved report.
setlocal
cd /d "%~dp0"
set "JOB_TTL_HOURS=0"
if not exist "server\dist\index.js" (
  echo The app is not built yet. Running: npm install ^&^& npm run build
  call "C:\Program Files\nodejs\npm.cmd" install || goto :fail
  call "C:\Program Files\nodejs\npm.cmd" run build || goto :fail
)
echo Form 680 AutoNotes - open http://localhost:8787 in your browser. Close this window to stop the app.
start "" http://localhost:8787
call "C:\Program Files\nodejs\npm.cmd" start
goto :eof
:fail
echo Build failed. See the messages above.
pause

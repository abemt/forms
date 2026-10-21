@echo off
rem One-time setup for voice-note transcription (private Python + faster-whisper + speech model). Needs internet once.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-voice.ps1" %*
pause

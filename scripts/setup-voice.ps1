<#
  One-time setup for voice-note transcription (offline, free, no API key).

  Installs a private Python 3.12 inside joy-form\tools\whisper\python (nothing is installed
  system-wide), the faster-whisper speech-to-text package, and a speech model into
  joy-form\tools\whisper\models. After this, transcription works without internet.

    powershell -ExecutionPolicy Bypass -File scripts\setup-voice.ps1            # CPU + GPU libraries if an NVIDIA GPU is present
    powershell -ExecutionPolicy Bypass -File scripts\setup-voice.ps1 -NoGpu     # CPU only (smaller download)
    powershell -ExecutionPolicy Bypass -File scripts\setup-voice.ps1 -Model large-v3-turbo   # add another model

  Downloads: ~150 MB packages + 1.5 GB model (medium.en); NVIDIA GPU libraries add ~1 GB.
#>
param(
  [string]$Model = 'medium.en',
  [switch]$NoGpu
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root 'tools\whisper'
$pyDir = Join-Path $tools 'python'
$python = Join-Path $pyDir 'python.exe'
$models = Join-Path $tools 'models'
$pyVersion = '3.12.10'
New-Item -ItemType Directory -Force -Path $tools, $models | Out-Null

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

if (-not (Test-Path $python)) {
  Step "Downloading private Python $pyVersion"
  $zip = Join-Path $env:TEMP "python-$pyVersion-embed-amd64.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/$pyVersion/python-$pyVersion-embed-amd64.zip" -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $pyDir -Force
  Remove-Item $zip -Force
  # The embeddable build ignores site-packages until "import site" is enabled.
  $pth = Get-ChildItem $pyDir -Filter 'python*._pth' | Select-Object -First 1
  Set-Content -Path $pth.FullName -Encoding ASCII -Value @('python312.zip', '.', 'Lib\site-packages', 'import site')
}

if (-not (Test-Path (Join-Path $pyDir 'Scripts\pip.exe'))) {
  Step 'Installing pip'
  $getPip = Join-Path $env:TEMP 'get-pip.py'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPip
  & $python $getPip --no-warn-script-location
  if ($LASTEXITCODE -ne 0) { throw 'pip installation failed' }
  Remove-Item $getPip -Force
}

Step 'Installing faster-whisper'
& $python -m pip install --no-warn-script-location --upgrade faster-whisper
if ($LASTEXITCODE -ne 0) { throw 'faster-whisper installation failed' }

$hasNvidia = [bool](Get-Command nvidia-smi -ErrorAction SilentlyContinue)
if ($hasNvidia -and -not $NoGpu) {
  Step 'NVIDIA GPU found - installing CUDA libraries for fast transcription (about 1 GB)'
  & $python -m pip install --no-warn-script-location --upgrade nvidia-cublas-cu12 'nvidia-cudnn-cu12==9.*'
  if ($LASTEXITCODE -ne 0) { Write-Warning 'GPU libraries could not be installed; transcription will use the CPU.' }
}

Step "Downloading speech model $Model (one time)"
& $python (Join-Path $root 'scripts\transcribe.py') --download $Model --models-dir $models
if ($LASTEXITCODE -ne 0) { throw "model download failed: $Model" }

Step 'Checking the installation'
& $python (Join-Path $root 'scripts\transcribe.py') --check --models-dir $models
Write-Host "`nVoice transcription is ready. Restart the app (start-joyform.cmd) if it is running." -ForegroundColor Green

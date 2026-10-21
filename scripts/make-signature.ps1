# Generate a handwriting-style signature PNG (transparent) for a staff member.
#   .\scripts\make-signature.ps1 -Name "Nathaniel Yohannes" -Out "server\data\signatures\Nathaniel Yohannes.png" [-Font "Freestyle Script"]
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Font = 'Freestyle Script'
)
Add-Type -AssemblyName System.Drawing
$w = 1100; $h = 320
$bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Transparent)
$g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
$ink = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(255, 18, 24, 72))
$pen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(255, 18, 24, 72)), 4.5
$pen.StartCap = 'Round'; $pen.EndCap = 'Round'
$f = New-Object System.Drawing.Font -ArgumentList $Font, 92, ([System.Drawing.FontStyle]::Italic)
# Slight upward slant like a hand-written signature.
$g.TranslateTransform(70, 200)
$g.RotateTransform(-5)
$g.DrawString($Name, $f, $ink, 0, -120)
$size = $g.MeasureString($Name, $f)
# Flourish: a quick sweep back under the name from the tail of the last letter.
$x1 = [float]($size.Width * 0.9); $x0 = [float]($size.Width * 0.18)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddBezier($x1, -8, [float]($x1 * 0.8), 26, [float]($x1 * 0.45), 24, $x0, 4)
$g.DrawPath($pen, $path)
$g.Dispose()
$dir = Split-Path -Parent $Out
if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "wrote $Out"

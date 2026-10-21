# Makes a spoken test voice note with the Windows built-in voice (no real client data).
#   powershell -ExecutionPolicy Bypass -File scripts\make-test-voice.ps1 <out.wav> [text-file]
param([Parameter(Mandatory = $true)][string]$Out, [string]$TextFile)
Add-Type -AssemblyName System.Speech
$text = if ($TextFile) { Get-Content -Raw -Path $TextFile } else {
  'Today is September twelfth. Steve went to day program in the morning and came back at four. ' +
  'He cooked spaghetti for dinner with Rahel, then he played his guitar in the living room. ' +
  'Jerrell stayed home in the morning. He was drawing a picture of the house and he was in a good mood. ' +
  'In the afternoon Hanna took Jerrell to Walmart and he bought new shoes with his own money. ' +
  'In the evening both of them played dominoes together. Last night Steve slept well, no seizure.'
}
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = -1
$synth.SetOutputToWaveFile($Out)
$synth.Speak($text)
$synth.Dispose()
Write-Output "wrote $Out"

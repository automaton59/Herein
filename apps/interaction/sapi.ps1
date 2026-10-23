param([Parameter(Mandatory=$true)][string]$OutputPath, [string]$Voice = 'Microsoft Huihui Desktop')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$taskText = [Console]::In.ReadToEnd()
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $taskSynth.SelectVoice($Voice)
    $taskSynth.SetOutputToWaveFile($OutputPath)
    $taskSynth.Speak($taskText)
} finally {
    $taskSynth.Dispose()
}

param([string]$Voice = 'Microsoft Huihui Desktop')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
Add-Type -TypeDefinition @'
using System;
using System.IO;
public sealed class HereinPcmStream : MemoryStream {
    private readonly Stream output = Console.OpenStandardOutput();
    public override void Write(byte[] buffer, int offset, int count) {
        base.Write(buffer, offset, count);
        output.Write(buffer, offset, count);
        output.Flush();
    }
}
'@
$taskText = [Console]::In.ReadToEnd()
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $taskSynth.SelectVoice($Voice)
    $taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    $taskSynth.SetOutputToAudioStream((New-Object HereinPcmStream), $taskFormat)
    $taskSynth.Speak($taskText)
} finally {
    $taskSynth.Dispose()
}

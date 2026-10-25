param([string]$Voice = 'Microsoft Huihui Desktop')
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
Add-Type -TypeDefinition @'
using System;
using System.IO;
public sealed class HereinJsonPcmStream : MemoryStream {
    public string Id;
    public override void Write(byte[] buffer, int offset, int count) {
        base.Write(buffer, offset, count);
        var pcm = Convert.ToBase64String(buffer, offset, count);
        Console.WriteLine("{\"id\":\"" + Id + "\",\"pcm\":\"" + pcm + "\"}");
        Console.Out.Flush();
    }
}
'@
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $taskSynth.SelectVoice($Voice)
    $taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
    [Console]::WriteLine('{"ready":true,"provider":"sapi","sampleRate":24000}')
    while ($null -ne ($taskLine = [Console]::ReadLine())) {
        $taskRequest = $taskLine | ConvertFrom-Json
        $taskStream = New-Object HereinJsonPcmStream
        $taskStream.Id = [string]$taskRequest.id
        try {
            $taskSynth.SetOutputToAudioStream($taskStream, $taskFormat)
            $taskSynth.Speak([string]$taskRequest.text)
            [Console]::WriteLine(('{"id":"' + $taskRequest.id + '","done":true}'))
        } catch {
            [Console]::WriteLine(('{"id":"' + $taskRequest.id + '","done":true,"error":"sapi_synthesis_failed"}'))
        } finally {
            $taskStream.Dispose()
        }
    }
} finally {
    $taskSynth.Dispose()
}

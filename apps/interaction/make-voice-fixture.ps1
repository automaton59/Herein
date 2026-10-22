param([Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$taskPcm = New-Object System.IO.MemoryStream
try {
    $taskSynth.SelectVoice('Microsoft Huihui Desktop')
    $taskSynth.Rate = 1
    $taskPcm.Write((New-Object byte[] (16000*2*15)), 0, 16000*2*15)
    # ASCII JSON escapes also work in Windows PowerShell 5.1 without a UTF-8 BOM.
    $taskInputs = '["\u4f60\u597d\u3002","\u6211\u5728\u8fd9\u91cc\u3002","\u6162\u6162\u8bf4\u3002","\u4eca\u5929\u8f9b\u82e6\u4e86\u3002","\u542c\u5230\u4e86\u3002","\u8fd9\u4e2a\u4e0d\u9519\u3002","\u522b\u6025\u3002","\u4f11\u606f\u4e00\u4e0b\u5427\u3002","\u6211\u966a\u7740\u4f60\u3002","\u665a\u5b89\u3002"]' | ConvertFrom-Json
    foreach ($taskText in $taskInputs) {
        $taskClip = New-Object System.IO.MemoryStream
        try {
            $taskSynth.SetOutputToAudioStream($taskClip, $taskFormat)
            $taskSynth.Speak($taskText)
            $taskBytes = $taskClip.ToArray()
            $taskPcm.Write($taskBytes, 0, $taskBytes.Length)
            $taskPcm.Write((New-Object byte[] (16000*2*4)), 0, 16000*2*4)
        } finally { $taskClip.Dispose() }
    }
    $taskWave = [System.IO.File]::Create([System.IO.Path]::GetFullPath($Output))
    $taskWriter = New-Object System.IO.BinaryWriter($taskWave)
    try {
        $taskWriter.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
        $taskWriter.Write([uint32]($taskPcm.Length + 36))
        $taskWriter.Write([System.Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
        $taskWriter.Write([uint32]16)
        $taskWriter.Write([uint16]1)
        $taskWriter.Write([uint16]1)
        $taskWriter.Write([uint32]16000)
        $taskWriter.Write([uint32]32000)
        $taskWriter.Write([uint16]2)
        $taskWriter.Write([uint16]16)
        $taskWriter.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
        $taskWriter.Write([uint32]$taskPcm.Length)
        $taskWriter.Write($taskPcm.ToArray())
    } finally { $taskWriter.Dispose() }
    Write-Output 'Generated ten fixed synthetic clips; no microphone recording.'
} finally { $taskSynth.Dispose(); $taskPcm.Dispose() }

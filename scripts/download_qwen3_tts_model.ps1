param(
  [string]$LocalDir = "tmp\models\qwen3-tts-customvoice",
  [string]$Repo = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
  [string]$Endpoint = "https://hf-mirror.com"
)

$ErrorActionPreference = "Stop"

$files = @(
  ".gitattributes",
  "README.md",
  "config.json",
  "generation_config.json",
  "merges.txt",
  "model.safetensors",
  "preprocessor_config.json",
  "speech_tokenizer/config.json",
  "speech_tokenizer/configuration.json",
  "speech_tokenizer/model.safetensors",
  "speech_tokenizer/preprocessor_config.json",
  "tokenizer_config.json",
  "vocab.json"
)

New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null

foreach ($file in $files) {
  $target = Join-Path $LocalDir ($file -replace '/', [IO.Path]::DirectorySeparatorChar)
  $parent = Split-Path -Parent $target
  if ($parent) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  $url = "$Endpoint/$Repo/resolve/main/$file"
  Write-Host "Downloading $file"
  & curl.exe -L --fail --retry 5 --retry-delay 2 -C - -o $target $url

  if ($LASTEXITCODE -ne 0) {
    throw "curl failed for $file with exit code $LASTEXITCODE"
  }
}

Write-Host "Downloaded $Repo to $LocalDir"

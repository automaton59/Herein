#!/usr/bin/env node
/**
 * Local TTS benchmark.
 *
 * Measures wall-clock latency, audio duration and RTF for a batch endpoint
 * such as scripts/qwen3_tts_service.py. It does not download models or call
 * any cloud service.
 *
 * Usage:
 *   node scripts/benchmark_tts.mjs --endpoint http://127.0.0.1:9881
 *   node scripts/benchmark_tts.mjs --endpoint http://127.0.0.1:9881 --runs 5
 */

import { performance } from 'node:perf_hooks';

const DEFAULT_SENTENCES = [
  '咋啦。',
  '嗯，我在。',
  '你今天怎么这么晚。',
  '别急，慢慢说。',
  '这个不错。',
];

function parseArgs(argv) {
  const args = {
    endpoint: 'http://127.0.0.1:9881',
    path: '/tts',
    speaker: 'Serena',
    emotion: 'neutral',
    language: 'Chinese',
    runs: 3,
    warmup: 1,
    sentences: DEFAULT_SENTENCES,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === '--endpoint') {
      args.endpoint = value;
      index += 1;
    } else if (key === '--path') {
      args.path = value;
      index += 1;
    } else if (key === '--speaker') {
      args.speaker = value;
      index += 1;
    } else if (key === '--emotion') {
      args.emotion = value;
      index += 1;
    } else if (key === '--runs') {
      args.runs = Math.max(1, Number.parseInt(value, 10) || 1);
      index += 1;
    } else if (key === '--warmup') {
      args.warmup = Math.max(0, Number.parseInt(value, 10) || 0);
      index += 1;
    } else if (key === '--text') {
      args.sentences = [value];
      index += 1;
    } else if (key === '--help' || key === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${key}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/benchmark_tts.mjs [options]

  --endpoint <url>    default http://127.0.0.1:9881
  --path <path>       default /tts
  --speaker <name>    default Serena
  --emotion <name>    default neutral
  --runs <n>          measured runs per sentence, default 3
  --warmup <n>        warmup runs per sentence, default 1
  --text <sentence>   benchmark one custom sentence
`);
}

function readWavInfo(arrayBuffer) {
  const view = new DataView(arrayBuffer);

  if (view.byteLength < 44) {
    throw new Error('response is too short to be a WAV file');
  }

  const riff = String.fromCharCode(...new Uint8Array(arrayBuffer, 0, 4));
  const wave = String.fromCharCode(...new Uint8Array(arrayBuffer, 8, 4));

  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('response is not a RIFF/WAVE file');
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;

  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(...new Uint8Array(arrayBuffer, offset, 4));
    const size = view.getUint32(offset + 4, true);

    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (id === 'data') {
      dataSize = size;
      break;
    }

    offset += 8 + size + (size % 2);
  }

  if (!sampleRate || !channels || !bitsPerSample) {
    throw new Error('WAV fmt chunk is missing');
  }

  const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
  return {
    sampleRate,
    channels,
    bitsPerSample,
    durationSeconds: bytesPerSecond > 0 ? dataSize / bytesPerSecond : 0,
  };
}

async function synthesize(args, text) {
  const url = `${args.endpoint.replace(/\/$/, '')}${args.path}`;
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      emotion: args.emotion,
      speaker: args.speaker,
      language: args.language,
    }),
  });
  const body = await response.arrayBuffer();
  const latencyMs = performance.now() - started;

  if (!response.ok) {
    const detail = new TextDecoder().decode(body);
    throw new Error(`HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const info = readWavInfo(body);
  return {
    latencyMs,
    audioSeconds: info.durationSeconds,
    rtf: info.durationSeconds > 0 ? latencyMs / 1000 / info.durationSeconds : Number.POSITIVE_INFINITY,
    sampleRate: info.sampleRate,
    bytes: body.byteLength,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`endpoint: ${args.endpoint}${args.path}`);
  console.log(`speaker: ${args.speaker}  emotion: ${args.emotion}  runs: ${args.runs}`);

  let health = null;
  try {
    const response = await fetch(`${args.endpoint.replace(/\/$/, '')}/health`);
    health = await response.json();
    console.log(`health: ok=${health.ok} mode=${health.mode} model=${health.model} device=${health.device}`);
  } catch (error) {
    console.warn(`health check failed: ${error instanceof Error ? error.message : error}`);
    console.warn('continuing; /tts may still work');
  }

  if (args.warmup > 0) {
    console.log(`warmup: ${args.warmup} run(s) per sentence`);
    for (const sentence of args.sentences) {
      for (let run = 0; run < args.warmup; run += 1) {
        await synthesize(args, sentence);
      }
    }
  }

  const rows = [];

  for (const sentence of args.sentences) {
    for (let run = 0; run < args.runs; run += 1) {
      const result = await synthesize(args, sentence);
      rows.push({ sentence, run: run + 1, ...result });
      console.log(
        `${sentence}  run=${run + 1}  latency=${result.latencyMs.toFixed(0)}ms  audio=${result.audioSeconds.toFixed(2)}s  RTF=${result.rtf.toFixed(2)}`,
      );
    }
  }

  const mean = rows.reduce((sum, row) => sum + row.rtf, 0) / rows.length;
  const meanLatency = rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length;
  const meanAudio = rows.reduce((sum, row) => sum + row.audioSeconds, 0) / rows.length;

  console.log('');
  console.log(`mean latency: ${meanLatency.toFixed(0)}ms`);
  console.log(`mean audio:   ${meanAudio.toFixed(2)}s`);
  console.log(`mean RTF:     ${mean.toFixed(2)}`);
  console.log('note: batch endpoint latency is not streaming TTFA; streaming needs a separate /tts/stream endpoint.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

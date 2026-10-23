import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve("tmp/interaction-evidence");
await mkdir(output, { recursive: true });
const results = [];
const inputs = [
  "你好。",
  "嗯，我在。",
  "别急，慢慢说。",
  "你今天怎么这么晚。",
  "这个不错。",
];
const fixtures = [];
for (const text of inputs) {
  const start = performance.now();
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "sapi-stream.ps1"),
    ],
    { windowsHide: true },
  );
  const chunks = [];
  let firstMs;
  let error = "";
  child.stdout.on("data", (data) => {
    firstMs ??= performance.now() - start;
    chunks.push(data);
  });
  child.stderr.on("data", (data) => (error += data));
  child.stdin.end(text, "utf8");
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(error)),
    );
  });
  const pcm = Buffer.concat(chunks);
  const elapsedMs = performance.now() - start;
  const audioSeconds = pcm.length / 48000;
  const result = {
    firstMs,
    elapsedMs,
    audioSeconds,
    rtf: elapsedMs / 1000 / audioSeconds,
    bytes: pcm.length,
    prefix: pcm.subarray(0, 8).toString("hex"),
  };
  console.log(JSON.stringify(result));
  results.push(result);
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  await writeFile(
    path.join(output, `sapi-${results.length}.wav`),
    Buffer.concat([header, pcm]),
  );
  const samples = new Float32Array(pcm.length / 2);
  for (let i = 0; i < samples.length; i++)
    samples[i] = pcm.readInt16LE(i * 2) / 32768;
  const down = new Int16Array(Math.floor((samples.length * 16000) / 24000));
  for (let i = 0; i < down.length; i++)
    down[i] = samples[Math.floor(i * 1.5)] * 32767;
  fixtures.push(Buffer.from(down.buffer).toString("base64"));
}
const asr = spawn(
  config.asr.python,
  [
    path.join(root, "asr-worker.py"),
    "--model",
    config.asr.model,
    "--device",
    config.asr.device || "cpu",
  ],
  {
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PATH:
        (config.asr.cudaBin ? config.asr.cudaBin + ";" : "") + process.env.PATH,
    },
  },
);
let buffer = "";
const pending = [];
asr.stderr.on("data", (d) => process.stderr.write(d));
asr.stdout.on("data", (data) => {
  buffer += data;
  for (let idx; (idx = buffer.indexOf("\n")) >= 0;) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    const result = JSON.parse(line);
    console.log(JSON.stringify(result));
    pending.shift()?.(result);
  }
});
const ready = await new Promise((resolve) => pending.push(resolve));
const asrResults = [];
for (let i = 0; i < fixtures.length; i++) {
  const wait = new Promise((resolve) => pending.push(resolve));
  asr.stdin.write(JSON.stringify({ id: i, pcm: fixtures[i] }) + "\n");
  asrResults.push(await wait);
}
asr.stdin.end();
await writeFile(
  path.join(output, "local-voice-probe.json"),
  JSON.stringify({ tts: results, asrReady: ready, asr: asrResults }, null, 2),
);

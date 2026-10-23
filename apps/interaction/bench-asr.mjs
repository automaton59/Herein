import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { VoiceWorkers } = require("./workers.cjs");
const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const workers = new VoiceWorkers(config);
try {
  if (!workers.asr.ready)
    await new Promise((resolve, reject) => {
      workers.asr.once("ready", resolve);
      workers.asr.once("failure", reject);
    });
  const results = [];
  for (let i = 1; i <= 5; i++) {
    const wav = await fs.readFile(
      path.resolve("tmp/interaction-evidence", `sapi-${i}.wav`),
    );
    const input = wav.subarray(44);
    const down = Buffer.alloc(Math.floor(((input.length / 2) * 2) / 3) * 2);
    for (let j = 0; j < down.length / 2; j++)
      down.writeInt16LE(input.readInt16LE(Math.floor(j * 1.5) * 2), j * 2);
    const value = await workers.transcribe(down);
    results.push({ fixture: i, ...value });
    console.log(JSON.stringify(value));
  }
  await fs.writeFile(
    "tmp/interaction-evidence/asr-worker-probe.local.json",
    JSON.stringify(results, null, 2),
  );
} finally {
  workers.close();
}

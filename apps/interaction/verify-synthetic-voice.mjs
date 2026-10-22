import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const dir = path.resolve(process.argv[2]);
const endpoint = JSON.parse(await fs.readFile(path.join(dir, "endpoint.local.json"), "utf8"));
const headers = { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" };
async function request(route, body) {
  const response = await fetch(endpoint.url + route, {
    method: body ? "POST" : "GET", headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.ok(response.ok, `${route}: ${response.status}`);
  return response.json();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const deadline = Date.now() + 30000;
while (true) {
  const health = await request("/health");
  if (health.ready && health.asr && health.tts) break;
  assert.ok(Date.now() < deadline, "Worker startup timeout");
  await sleep(250);
}
const streamAbort = new AbortController();
const stream = await fetch(endpoint.url + "/v1/events", { headers, signal: streamAbort.signal });
assert.ok(stream.ok);
const responses = [];
const started = new Date().toISOString();
let buffer = "", timedOut = false;
const timer = setTimeout(() => { timedOut = true; streamAbort.abort(); }, 110000);
await request("/v1/listening", { enabled: true });
try {
  for await (const chunk of stream.body) {
    buffer += Buffer.from(chunk).toString("utf8");
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      const data = block.split("\n").find(line => line.startsWith("data: "));
      if (!data) continue;
      const event = JSON.parse(data.slice(6));
      if (event.type !== "transcript" || !event.text) continue;
      // Transcripts remain in memory; the report stores only lengths and counts.
      const result = await request("/v1/speech", { text: "听到了。", turnId: event.turnId });
      responses.push({ number: responses.length + 1, characters: event.text.length, generation: result.generation });
    }
    if (responses.length >= 10) break;
  }
} catch (error) { if (!timedOut) throw error; }
finally { clearTimeout(timer); streamAbort.abort(); }
await sleep(4000);
await request("/v1/listening", { enabled: false });
const sampleDeadline = Date.now() + 7000;
let health;
do {
  await sleep(250);
  health = await request("/health");
} while ((health.metrics.tracks !== 0 || health.metrics.bufferMs !== 0 || health.metrics.type !== "renderer.sample") && Date.now() < sampleDeadline);
const events = (await fs.readFile(path.join(dir, "metrics.jsonl"), "utf8")).trim().split("\n").map(JSON.parse)
  .filter(row => row.at >= started);
const sounds = events.filter(row => row.type === "playback.sound" && responses.some(r => r.generation === row.generation));
const turns = events.filter(row => row.type === "voice.turn");
const report = { buildId: endpoint.buildId, syntheticInput: true, realMicrophone: false,
  timedOut, transcriptCount: responses.length, responses,
  voiceTurns: turns, sounds, health: health.metrics,
  complete: responses.length === 10 && sounds.length === 10 && sounds.every(s => s.endToSoundMs > 0),
};
await fs.writeFile(path.join(dir, "synthetic-voice-verification.local.json"), JSON.stringify(report, null, 2));
assert.equal(report.complete, true, "Synthetic ten-turn chain incomplete; inspect local evidence");
console.log(JSON.stringify({ syntheticTenTurns: true, realMicrophone: false,
  endToSoundMs: sounds.map(s => s.endToSoundMs), underruns: report.health.underruns }));

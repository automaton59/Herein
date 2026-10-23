import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const root = await fs.realpath(path.resolve(process.argv[2]));
const manifest = JSON.parse(await fs.readFile(path.join(root, "portable-manifest.json"), "utf8"));
assert.equal(manifest.formatVersion, 1);
assert.equal(manifest.includesModels, false);
assert.equal(manifest.includesPrivateConfiguration, false);
const expected = new Map(manifest.files.map(file => [file.file, file]));
assert.equal(expected.size, manifest.files.length, "Duplicate package manifest entry");
let observed = 0;
async function scan(directory, relative = "") {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, "Package symlinks are not permitted");
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) { await scan(path.join(directory, entry.name), name); continue; }
    assert.equal(entry.isFile(), true);
    if (name === "portable-manifest.json") continue;
    const record = expected.get(name);
    assert.ok(record, `Unlisted package file: ${name}`);
    const bytes = await fs.readFile(path.join(directory, entry.name));
    assert.equal(bytes.length, record.bytes, `Size mismatch: ${name}`);
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), record.sha256,
      `Hash mismatch: ${name}`);
    observed++;
  }
}
await scan(root);
assert.equal(observed, expected.size, "A package file is missing");
const sources = ["main.cjs", "workers.cjs", "preload.cjs", "contracts.mjs",
  "asr-worker.py", "qwen-worker.py", "gguf-worker.py", "sapi-worker.ps1",
  "renderer/runtime.mjs", "renderer/avatar.mjs", "renderer/body.mjs",
  "renderer/audio.mjs", "renderer/audio-worklet.mjs", "renderer/index.html", "renderer/style.css"];
const hash = crypto.createHash("sha256");
for (const source of sources) hash.update(source).update(await fs.readFile(path.join(root, "apps/interaction", source)));
hash.update(await fs.readFile(path.join(root, "tmp/interaction-dist/assets/main.js")));
assert.equal(hash.digest("hex"), manifest.buildId, "Package runtime buildId mismatch");
console.log(JSON.stringify({ portableIntegrityVerified: true, buildId: manifest.buildId,
  files: observed, bytes: manifest.files.reduce((total, file) => total + file.bytes, 0),
  signatureVerified: false, runtimeLaunchVerified: false,
  physicalHardwareVerified: false }));

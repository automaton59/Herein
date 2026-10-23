import test from "node:test";
import assert from "node:assert/strict";
import { PcmRing, VoiceActivity, TextSegments } from "../renderer/audio.mjs";
import { assetPath, validateManifest, speechCommand } from "../contracts.mjs";
test("bounded PCM ring preserves ordering across wrap and clears on interruption", () => {
  const ring = new PcmRing(5);
  assert.equal(ring.push([1, 2, 3, 4]), true);
  const out = new Float32Array(3);
  ring.take(out);
  assert.deepEqual([...out], [1, 2, 3]);
  assert.equal(ring.push([5, 6, 7, 8]), true);
  assert.equal(ring.push([9]), false);
  const rest = new Float32Array(7);
  assert.equal(ring.take(rest), 5);
  assert.deepEqual([...rest], [4, 5, 6, 7, 8, 0, 0]);
  ring.push([10]);
  ring.clear();
  ring.take(out);
  assert.deepEqual([...out], [0, 0, 0]);
});
test("VAD speech start interrupts before utterance endpoint and suppresses short noise", () => {
  const vad = new VoiceActivity();
  const voice = new Float32Array(320).fill(0.08),
    quiet = new Float32Array(320);
  const events = [];
  for (let i = 0; i < 15; i++)
    events.push(...vad.consume(voice, 20, true).events);
  assert.equal(events[0]?.type, "start");
  for (let i = 0; i < 23; i++) events.push(...vad.consume(quiet).events);
  assert.equal(events[1]?.type, "end");
  assert.ok(events[1].frames.length > 15);
  const short = new VoiceActivity();
  const noise = [];
  for (let i = 0; i < 3; i++) noise.push(...short.consume(voice).events);
  for (let i = 0; i < 23; i++) noise.push(...short.consume(quiet).events);
  assert.equal(noise.at(-1).type, "discard");
});
test("VAD caps continuously voiced audio instead of growing without bound", () => {
  const vad = new VoiceActivity({ maxUtteranceMs: 1000 });
  let end;
  for (let i = 0; i < 60; i++) {
    end ||= vad
      .consume(new Float32Array(320).fill(0.1))
      .events.find((e) => e.type === "end");
  }
  assert.ok(end);
  assert.ok(end.durationMs <= 1000);
  assert.ok(end.frames.length <= 50);
});
test("streaming text emits complete clauses and enforces whole-turn bounds", () => {
  const text = new TextSegments();
  assert.deepEqual(text.append("你好"), []);
  assert.deepEqual(text.append("。第二句话！还没完"), ["你好。", "第二句话！"]);
  assert.deepEqual(text.append("", true), ["还没完"]);
  assert.throws(() => text.append("x".repeat(501)));
});
test("avatar manifest rejects missing backend and filesystem escapes", () => {
  const root =
    process.platform === "win32" ? "C:\\private\\avatar" : "/private/avatar";
  const valid = {
    version: 1,
    cubism: 4,
    root,
    entry: "body/model.model3.json",
    core: "core.js",
    parameters: { mouth: "ParamMouthOpenY" },
  };
  assert.equal(validateManifest(valid), valid);
  assert.throws(() => assetPath(root, "../secret"));
  assert.throws(() => validateManifest({ ...valid, cubism: 3 }));
  assert.throws(() => validateManifest({ ...valid, parameters: {} }));
});
test("speech contract accepts bounded commands and never coerces arbitrary objects", () => {
  assert.equal(
    speechCommand({ text: " hello ", emotion: "happy" }).text,
    "hello",
  );
  assert.throws(() => speechCommand({ text: "x".repeat(501) }));
  assert.throws(() => speechCommand({ text: { toString: () => "hello" } }));
});

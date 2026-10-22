import test from "node:test";
import assert from "node:assert/strict";
import { BodyAnimator } from "../renderer/body.mjs";
import { avatarCommand, validateManifest } from "../contracts.mjs";

const manifest = {
  motions: {
    idle: { group: "Idle", index: 0, loop: true },
    thinking: { group: "Anima", index: 2, loop: true },
    speaking: { group: "Anima", index: 0, loop: true },
    thinkEnd: { group: "Anima", index: 1, loop: false },
  },
  states: { idle: "idle", thinking: "thinking", speaking: "speaking", interrupted: "idle" },
  expressions: { neutral: null, happy: "happy" },
  interactions: { tap: { motion: "thinkEnd", emotion: "happy" } },
};
function rig(play = async () => true) {
  const calls = [];
  const body = new BodyAnimator(manifest, {
    stop: () => calls.push("stop"),
    play: spec => { calls.push(spec); return play(spec); },
    expression: name => calls.push(name),
  });
  return { body, calls };
}
test("same-group speaking and thinking use exact indices, cancellation replaces the loop", async () => {
  const { body, calls } = rig();
  body.setState("thinking");
  body.setState("speaking");
  body.setState("interrupted");
  await Promise.resolve();
  assert.deepEqual(calls.filter(x => typeof x === "object").map(x => x.index), [2, 0, 0]);
  assert.equal(body.motionName, "idle");
  assert.equal(body.emotion, "neutral");
});
test("tap is one shot and returns to current execution state with the previous expression", async () => {
  const { body, calls } = rig();
  body.setState("speaking");
  await body.interact("tap");
  assert.equal(body.motionName, "thinkEnd");
  body.finished();
  assert.equal(body.motionName, "speaking");
  assert.equal(calls.at(-2), "stop");
  assert.ok(calls.includes("happy"));
  assert.ok(calls.includes("neutral"));
});
test("late rejected motion cannot undo a newer state", async () => {
  let release;
  const { body } = rig(spec => spec.index === 2
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve(true));
  body.setState("thinking");
  body.setState("speaking");
  release(false);
  await Promise.resolve();
  assert.equal(body.motionName, "speaking");
});
test("motion-only commands preserve expression and invalid model mappings are rejected", () => {
  assert.deepEqual(avatarCommand({ motion: "thinking" }, manifest), { motion: "thinking", emotion: undefined });
  assert.throws(() => avatarCommand({ motion: "unknown" }, manifest));
  const valid = { ...manifest, version: 1, cubism: 4,
    root: process.platform === "win32" ? "C:\\private\\avatar" : "/private/avatar",
    entry: "model.json", core: "core.js", parameters: { mouth: "ParamMouthOpenY" } };
  validateManifest(valid);
  assert.throws(() => validateManifest({ ...valid, motions: { idle: { group: "Idle", index: -1 } } }));
});

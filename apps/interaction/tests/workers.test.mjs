import test from "node:test";
import assert from "node:assert/strict";
import { VoiceWorkers } from "../workers.cjs";
import { once } from "node:events";
test(
  "SAPI cancellation during synthesis prevents stale PCM, and bounded chunks permit replacement",
  { skip: process.platform !== "win32" },
  async () => {
    const workers = Object.create(VoiceWorkers.prototype);
    workers.config = {
      tts: { provider: "sapi", voice: "Microsoft Huihui Desktop" },
    };
    workers.sequence = 0;
    workers.tts = null;
    workers.qwenBusy = false;
    const frames = [];
    const old = workers.speak(
      { text: "这是一句将被打断的测试声音。" },
      1,
      async (data, meta) => frames.push({ data, meta }),
    );
    workers.cancel();
    await old;
    assert.equal(frames.length, 0);
    try {
      const next = [];
      await workers.speak({ text: "你好。" }, 2, async (data, meta) =>
        next.push({ data, meta }),
      );
      assert.ok(next.length > 0);
      assert.ok(
        next.every(
          (frame) => frame.data.length <= 4800 && frame.meta.generation === 2,
        ),
      );
    } finally {
      workers.close();
    }
  },
);

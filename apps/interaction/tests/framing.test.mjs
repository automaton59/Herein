import test from "node:test";
import assert from "node:assert/strict";
import { avatarLayout } from "../renderer/framing.mjs";

test("bust framing fills width and crops below the chest", () => {
  const bust = avatarLayout({
    modelWidth: 400,
    modelHeight: 1000,
    width: 360,
    height: 384,
    framing: "bust",
  });
  const full = avatarLayout({
    modelWidth: 400,
    modelHeight: 1000,
    width: 360,
    height: 384,
    framing: "full",
  });

  assert.ok(bust.scale > full.scale);
  assert.ok(bust.y - (1000 * bust.scale) / 2 <= 0);
  assert.equal(bust.x, 180);
});

test("half framing is between bust and full", () => {
  const bust = avatarLayout({ modelWidth: 400, modelHeight: 1000, width: 360, height: 384, framing: "bust" });
  const half = avatarLayout({ modelWidth: 400, modelHeight: 1000, width: 360, height: 384, framing: "half" });
  const full = avatarLayout({ modelWidth: 400, modelHeight: 1000, width: 360, height: 384, framing: "full" });

  assert.ok(half.scale < bust.scale);
  assert.ok(half.scale > full.scale);
});

test("offsets and custom custom framing factors are honored", () => {
  const layout = avatarLayout({
    modelWidth: 400,
    modelHeight: 1000,
    width: 360,
    height: 384,
    framing: "bust",
    offsetX: 0.1,
    offsetY: 0.05,
    framingScaleBust: 1.2,
  });

  assert.equal(layout.x, 360 * 0.6);
  assert.ok(layout.y > 0);
});

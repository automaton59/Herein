import test from "node:test";
import assert from "node:assert/strict";
import { cubism4Inventory } from "../avatar-inventory.mjs";

function fixture() {
  const manifest = { parameters: { mouth: "Mouth", eyeLeft: "Eye" },
    expressions: { neutral: null, relaxed: "identity", happy: "overwrite" },
    motions: { reaction: { group: "Actions", index: 0, loop: false } } };
  const model = { FileReferences: { DisplayInfo: "info.json",
    Expressions: [{ Name: "identity", File: "identity.json" }, { Name: "overwrite", File: "overwrite.json" }],
    Motions: { Actions: [{ File: "motion.json" }] } },
    Groups: [{ Name: "EyeBlink", Ids: ["Eye"] }, { Name: "LipSync", Ids: [] }], HitAreas: [] };
  const documents = new Map([
    ["info.json", { Parameters: [{ Id: "Mouth" }] }],
    ["identity.json", { Parameters: [{ Id: "Mouth", Value: 0, Blend: "Add" }, { Id: "Eye", Value: 1, Blend: "Multiply" }] }],
    ["overwrite.json", { Parameters: [{ Id: "Mouth", Value: 0, Blend: "Overwrite" }] }],
    ["motion.json", { Meta: { Duration: 1.717, Fps: 60, Loop: true }, Curves: [{ Target: "Parameter", Id: "Eye" }] }],
  ]);
  return { manifest, model, documents };
}

test("replacement audit distinguishes identity from overwrite-zero and source loop from runtime override", () => {
  const { manifest, model, documents } = fixture();
  const inventory = cubism4Inventory(manifest, model, documents);
  assert.equal(inventory.expressionEffects[0].identityOnly, true);
  assert.equal(inventory.expressionEffects[1].identityOnly, false);
  assert.equal(inventory.motionMappings[0].choices[0].sourceLoop, true);
  assert.equal(inventory.motionMappings[0].choices[0].effectiveLoop, false);
  assert.equal(inventory.motionMappings[0].choices[0].hasMouthCurve, false);
  assert.equal(inventory.parameterMetadataAuthoritative, false);
  assert.ok(inventory.warnings.some(item => item.code === "parameter_absent_from_optional_display_info"));
});

test("replacement audit rejects renamed expressions and missing motion indices", () => {
  const { manifest, model, documents } = fixture();
  assert.throws(() => cubism4Inventory({ ...manifest, expressions: { happy: "renamed" } }, model, documents));
  assert.throws(() => cubism4Inventory({ ...manifest, motions: { idle: { group: "Actions", index: 2 } } }, model, documents));
});

test("optional metadata absence remains unknown and legacy group selection lists all choices", () => {
  const { manifest, model, documents } = fixture();
  documents.delete("info.json");
  model.FileReferences.Motions.Actions.push({ File: "motion.json" });
  const inventory = cubism4Inventory({ ...manifest, motions: { idle: "Actions" } }, model, documents);
  assert.equal(inventory.parameterMappings[0].declaredInDisplayInfo, null);
  assert.equal(inventory.motionMappings[0].selection, "random_from_group");
  assert.equal(inventory.motionMappings[0].choices.length, 2);
});

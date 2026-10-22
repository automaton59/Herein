import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { validateManifest, assetPath } from "./contracts.mjs";

const manifest = validateManifest(JSON.parse(await fs.readFile(process.argv[2], "utf8")));
const model = JSON.parse(await fs.readFile(assetPath(manifest.root, manifest.entry), "utf8"));
const refs = model.FileReferences;
const prefix = path.dirname(manifest.entry);
const files = [manifest.entry, manifest.core];
if (manifest.cubism === 4) {
  for (const value of [refs.Moc, refs.Physics, refs.Pose, refs.DisplayInfo,
    ...(refs.Textures || []), ...(refs.Expressions || []).map(x => x.File),
    ...Object.values(refs.Motions || {}).flat().map(x => x.File)].filter(Boolean))
    files.push(path.join(prefix, value));
} else {
  for (const value of [model.model, model.physics, model.pose, ...(model.textures || []),
    ...(model.expressions || []).map(x => x.file),
    ...Object.values(model.motions || {}).flat().map(x => x.file)].filter(Boolean))
    files.push(path.join(prefix, value));
}
const digest = crypto.createHash("sha256").update(JSON.stringify({ ...manifest, root: undefined }));
const root = await fs.realpath(manifest.root);
const assets = [];
for (const file of [...new Set(files)].sort()) {
  const actual = await fs.realpath(assetPath(root, file));
  if (!actual.startsWith(root + path.sep)) throw new Error("Avatar asset symlink escapes root");
  const bytes = await fs.readFile(actual);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  digest.update(file).update(bytes);
  assets.push({ file: file.replaceAll("\\", "/"), bytes: bytes.length, sha256 });
}
const expressionEffects = [];
if (manifest.cubism === 4) {
  for (const definition of refs.Expressions || []) {
    const expression = JSON.parse(await fs.readFile(
      assetPath(root, path.join(prefix, definition.File)), "utf8"));
    const parameters = expression.Parameters || [];
    const effective = parameters.filter(parameter =>
      parameter.Blend === "Overwrite" ||
      (parameter.Blend === "Multiply" ? parameter.Value !== 1 : parameter.Value !== 0));
    expressionEffects.push({ name: definition.Name, parameterCount: parameters.length,
      effectiveParameterCount: effective.length,
      identityOnly: effective.length === 0,
      parameters: effective.map(parameter => ({ id: parameter.Id, value: parameter.Value,
        blend: parameter.Blend || "Add" })),
    });
  }
}
const report = { cubism: manifest.cubism, modelFingerprint: digest.digest("hex"),
  assets, expressions: Object.keys(manifest.expressions || {}), motions: manifest.motions,
  expressionEffects,
  localOnly: true };
if (process.argv[3]) await fs.writeFile(process.argv[3], JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cubism: report.cubism, assets: assets.length,
  modelFingerprint: report.modelFingerprint, bytes: assets.reduce((sum, x) => sum + x.bytes, 0),
  identityOnlyExpressions: expressionEffects.filter(effect => effect.identityOnly).map(effect => effect.name) }));

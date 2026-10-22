import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { validateManifest, assetPath } from "./contracts.mjs";
import { cubism4Inventory } from "./avatar-inventory.mjs";

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
const documents = new Map();
for (const file of [...new Set(files)].sort()) {
  const actual = await fs.realpath(assetPath(root, file));
  if (!actual.startsWith(root + path.sep)) throw new Error("Avatar asset symlink escapes root");
  const bytes = await fs.readFile(actual);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  digest.update(file).update(bytes);
  assets.push({ file: file.replaceAll("\\", "/"), bytes: bytes.length, sha256 });
  if (manifest.cubism === 4 && file.toLowerCase().endsWith(".json"))
    documents.set(path.relative(prefix, file).replaceAll("\\", "/"), JSON.parse(bytes));
}
const inventory = manifest.cubism === 4 ? cubism4Inventory(manifest, model, documents) : {};
const report = { cubism: manifest.cubism, modelFingerprint: digest.digest("hex"),
  assets, expressions: Object.keys(manifest.expressions || {}), motions: manifest.motions,
  ...inventory,
  localOnly: true };
if (process.argv[3]) await fs.writeFile(process.argv[3], JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cubism: report.cubism, assets: assets.length,
  modelFingerprint: report.modelFingerprint, bytes: assets.reduce((sum, x) => sum + x.bytes, 0),
  identityOnlyExpressions: (inventory.expressionEffects || []).filter(effect => effect.identityOnly).map(effect => effect.name),
  warnings: inventory.warnings || [] }));

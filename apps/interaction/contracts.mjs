import path from "node:path";
export function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || ![2, 4].includes(manifest.cubism))
    throw new Error("Avatar manifest requires version 1 and cubism 2 or 4");
  if (!path.isAbsolute(manifest.root ?? ""))
    throw new Error("Avatar root must be absolute");
  for (const key of ["entry", "core"]) assetPath(manifest.root, manifest[key]);
  if (!manifest.parameters || typeof manifest.parameters.mouth !== "string")
    throw new Error("Avatar mouth parameter is required");
  for (const [name, value] of Object.entries(manifest.motions || {})) {
    const spec = typeof value === "string" ? { group: value } : value;
    if (!spec || typeof spec.group !== "string" || !spec.group ||
        (spec.index !== undefined && (!Number.isInteger(spec.index) || spec.index < 0)) ||
        (spec.loop !== undefined && typeof spec.loop !== "boolean"))
      throw new Error(`Invalid avatar motion: ${name}`);
  }
  for (const value of Object.values(manifest.expressions || {}))
    if (value !== null && typeof value !== "string")
      throw new Error("Invalid avatar expression");
  for (const name of Object.values(manifest.states || {}))
    if (!Object.hasOwn(manifest.motions || {}, name))
      throw new Error("Avatar state refers to unknown motion");
  for (const value of Object.values(manifest.interactions || {}))
    if (!Object.hasOwn(manifest.motions || {}, value?.motion) ||
        (value.emotion !== undefined && !Object.hasOwn(manifest.expressions || {}, value.emotion)))
      throw new Error("Avatar interaction refers to unknown action");
  return manifest;
}
export function avatarCommand(value, manifest) {
  if (!value || (value.emotion === undefined && value.motion === undefined))
    throw new Error("Invalid avatar command");
  for (const [key, entries] of [["emotion", manifest.expressions], ["motion", manifest.motions]])
    if (value[key] !== undefined &&
        (typeof value[key] !== "string" || !Object.hasOwn(entries || {}, value[key])))
      throw new Error(`Unknown avatar ${key}`);
  return { emotion: value.emotion, motion: value.motion };
}
export function assetPath(root, entry) {
  if (
    typeof entry !== "string" ||
    !entry ||
    path.isAbsolute(entry) ||
    entry.includes("\0")
  )
    throw new Error("Invalid asset path");
  const target = path.resolve(root, entry);
  if (!target.startsWith(path.resolve(root) + path.sep))
    throw new Error("Asset path escapes root");
  return target;
}
export function speechCommand(value) {
  if (
    !value ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    value.text.length > 500
  )
    throw new Error("Speech text must have 1–500 characters");
  return {
    text: value.text.trim(),
    emotion:
      typeof value.emotion === "string"
        ? value.emotion.slice(0, 40)
        : "neutral",
    instruct:
      typeof value.instruct === "string" ? value.instruct.slice(0, 200) : "",
    turnId:
      typeof value.turnId === "string" ? value.turnId.slice(0, 80) : undefined,
  };
}

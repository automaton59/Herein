import path from "node:path";
export function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || ![2, 4].includes(manifest.cubism))
    throw new Error("Avatar manifest requires version 1 and cubism 2 or 4");
  if (!path.isAbsolute(manifest.root ?? ""))
    throw new Error("Avatar root must be absolute");
  for (const key of ["entry", "core"]) assetPath(manifest.root, manifest[key]);
  if (!manifest.parameters || typeof manifest.parameters.mouth !== "string")
    throw new Error("Avatar mouth parameter is required");
  return manifest;
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

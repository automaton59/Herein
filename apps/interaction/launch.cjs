const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const root = __dirname;
const configPath = process.argv.find(arg => arg.startsWith("--config="))?.slice(9) ||
  process.env.HEREIN_INTERACTION_CONFIG;
let rendererDir = path.resolve(root, "../../tmp/interaction-dist");
if (configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (config.rendererDir) rendererDir = path.resolve(config.rendererDir);
  } catch (error) {
    console.error("Cannot read interaction config:", error.message);
    process.exit(1);
  }
}
if (
  !fs.existsSync(path.join(rendererDir, "index.html"))
) {
  console.error("Run npm run build in apps/interaction first.");
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const runtimeArgs = process.argv.slice(2);
// Chromium can launch GPU/network children while main's config read awaits IO.
// Set their profile through the command line before Electron starts.
const runtimeDataDir = path.resolve(
  runtimeArgs.find(arg => arg.startsWith("--data-dir="))?.slice(11) ||
  process.env.HEREIN_INTERACTION_DATA_DIR || path.join(root, "../../tmp/interaction-data"),
);
const profileArg = runtimeArgs.find(arg => arg.startsWith("--user-data-dir="));
if (profileArg && path.resolve(profileArg.slice(16)).toLowerCase() !== runtimeDataDir.toLowerCase()) {
  console.error("The Chromium profile must match the interaction data directory.");
  process.exit(1);
}
if (!profileArg) runtimeArgs.push(`--user-data-dir=${runtimeDataDir}`);
const child = spawn(require("electron"), [root, ...runtimeArgs], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => process.exit(code ?? 1));

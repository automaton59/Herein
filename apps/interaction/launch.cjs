const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const root = __dirname;
if (
  !fs.existsSync(path.resolve(root, "../../tmp/interaction-dist/index.html"))
) {
  console.error("Run npm run build in apps/interaction first.");
  process.exit(1);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), [root, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => process.exit(code ?? 1));

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("The portable runtime currently supports Windows");
const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const outputArg = args.find(arg => arg.startsWith("--output="))?.slice(9);
const rendererArg = args.find(arg => arg.startsWith("--renderer="))?.slice(11);
if (!outputArg || !rendererArg || args.some(arg => !arg.startsWith("--output=") && !arg.startsWith("--renderer=")))
  throw new Error("Usage: node package-portable.mjs --output=<new-directory> --renderer=<saved-bundle>");
const output = path.resolve(outputArg);
const renderer = await fs.realpath(path.resolve(rendererArg));
const electron = path.dirname(require("electron"));
const sources = ["main.cjs", "workers.cjs", "preload.cjs", "contracts.mjs",
  "asr-worker.py", "qwen-worker.py", "gguf-worker.py", "sapi-worker.ps1",
  "renderer/runtime.mjs", "renderer/avatar.mjs", "renderer/body.mjs",
  "renderer/audio.mjs", "renderer/audio-worklet.mjs", "renderer/index.html", "renderer/style.css"];
const hash = crypto.createHash("sha256");
for (const name of sources) hash.update(name).update(await fs.readFile(path.join(root, name)));
hash.update(await fs.readFile(path.join(renderer, "assets/main.js")));
const buildId = hash.digest("hex");
// A new directory and explicit source list prevent private data or an old
// portable package from being swept into this artifact. No recursive deletion.
await fs.mkdir(output);
const files = [];
async function copy(source, relative) {
  const bytes = await fs.readFile(source);
  await write(relative, bytes);
}
async function write(relative, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const destination = path.join(output, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes, { flag: "wx" });
  files.push({ file: relative.replaceAll("\\", "/"), bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
}
async function copyTree(source, relative, bundledRenderer = false) {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Portable inputs must not contain symlinks");
    if (entry.isDirectory()) {
      if (bundledRenderer && entry.name !== "assets") throw new Error("Unexpected renderer directory");
      await copyTree(path.join(source, entry.name), path.join(relative, entry.name), bundledRenderer);
    } else {
      if (!entry.isFile()) throw new Error("Unexpected portable input");
      if (bundledRenderer && !/\.(html|js|css)$/.test(entry.name)) throw new Error("Unexpected renderer asset");
      await copy(path.join(source, entry.name), path.join(relative, entry.name));
    }
  }
}
for (const name of sources) await copy(path.join(root, name), path.join("apps/interaction", name));
await write("apps/interaction/package.json",
  JSON.stringify({ name: "herein-interaction-portable", private: true, version: "0.1.0", main: "main.cjs" }, null, 2));
await copyTree(renderer, "tmp/interaction-dist", true);
for (const name of ["config.example.json", "avatar.dsh.example.json", "avatar.example.json"])
  await copy(path.join(root, name), name);
const packageNotices = [], inspectedPackages = new Set();
async function collectNotices(name, from = root) {
  if (name.startsWith("@types/")) return;
  const resolver = createRequire(path.join(from, "package.json"));
  let packageRoot, metadata;
  // Read package metadata through Node's dependency lookup roots. This also
  // handles builtin-name packages and packages exporting only subpaths.
  for (const lookup of resolver.resolve.paths(name) || resolver.resolve.paths(`${name}/`) || []) {
    const candidate = path.join(lookup, name);
    metadata = await fs.readFile(path.join(candidate, "package.json"), "utf8")
      .then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (metadata?.name === name) { packageRoot = candidate; break; }
  }
  if (!packageRoot) throw new Error(`Package metadata missing: ${name}`);
  if (inspectedPackages.has(packageRoot)) return;
  inspectedPackages.add(packageRoot);
  const noticeFiles = (await fs.readdir(packageRoot, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice)([.-]|$)/i.test(entry.name));
  if (!noticeFiles.length) {
    if (name === "@pixi/colord" && metadata.version === "2.9.6")
      await copy(path.join(root, "licenses/colord-2.9.6.md"), path.join("licenses", name, "LICENSE.md"));
    else if (name === "@pixi/text-html" && metadata.version === "7.4.3")
      await copy(path.join(path.dirname(packageRoot), "core/LICENSE"), path.join("licenses", name, "LICENSE"));
    else throw new Error(`Dependency license missing: ${name}`);
  }
  for (const notice of noticeFiles)
    await copy(path.join(packageRoot, notice.name), path.join("licenses", name, notice.name));
  packageNotices.push({ name, version: metadata.version, license: metadata.license });
  for (const dependency of Object.keys(metadata.dependencies || {})) await collectNotices(dependency, packageRoot);
}
for (const name of ["pixi.js", "pixi-live2d-display", "@pixi/unsafe-eval"]) await collectNotices(name);
await copy(path.join(root, "licenses/cubism-web-framework.md"), "licenses/cubism-web-framework.md");
await write("licenses/renderer-dependencies.json", JSON.stringify(packageNotices, null, 2));
await copyTree(electron, "electron");
const launcher = `[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [Parameter(Mandatory=$true)][string]$DataDirectory
)
$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathRooted($ConfigPath) -or -not [System.IO.Path]::IsPathRooted($DataDirectory)) {
  throw 'Use absolute external config and data paths'
}
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$runtimeExe = Join-Path $PSScriptRoot 'electron/electron.exe'
$runtimeApp = Join-Path $PSScriptRoot 'apps/interaction'
$previousNodeMode = $env:ELECTRON_RUN_AS_NODE
try {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  & $runtimeExe $runtimeApp "--config=$resolvedConfig" "--data-dir=$DataDirectory" "--user-data-dir=$DataDirectory"
} finally {
  $env:ELECTRON_RUN_AS_NODE = $previousNodeMode
}
`;
await write("Start-Interaction.ps1", launcher);
await write("PORTABLE.md", `# Herein 独立交互运行时

buildId: ${buildId}

包含 Electron 与独立 renderer，不需要仓库或 Node.js。仅支持当前 Windows 架构。
不包含模型、Cubism Core、Python 环境、配置或语音数据。保留 electron/ 的上游许可。

从模板创建外部私有配置和模型 manifest，填写本机离线 ASR/TTS 与资源路径。
删除配置中的 rendererDir，使用包内 tmp/interaction-dist；也可填写该目录的绝对路径。
使用全新的外部数据目录。默认 port=0 随机分配；C 读取该目录 endpoint.local.json。

启动：powershell -NoProfile -ExecutionPolicy Bypass -File .\\Start-Interaction.ps1 -ConfigPath <绝对私有配置路径> -DataDirectory <绝对独立数据目录>

无声软件测试设 silentOutput=true、autoListen=false；真实声音与麦克风需在验收时显式开启。
包内默认数据目录会写入 tmp，但生产/测试均建议显式指定外部目录。
缺少本机推理环境时不能运行语音。当前版本的全天候及真人关卡以证据报告为准。
`);
await fs.writeFile(path.join(output, "portable-manifest.json"), JSON.stringify({
  formatVersion: 1, buildId, packaged: new Date().toISOString(), platform: process.platform,
  arch: process.arch, electronVersion: (await fs.readFile(path.join(electron, "version"), "utf8")).trim(),
  includesModels: false, includesPrivateConfiguration: false, files,
}, null, 2));
console.log(JSON.stringify({ portablePackaged: true, output, buildId,
  files: files.length, bytes: files.reduce((total, file) => total + file.bytes, 0),
  includesModels: false, includesPrivateConfiguration: false }));

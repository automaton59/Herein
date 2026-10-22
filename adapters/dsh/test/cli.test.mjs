import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

const cli = resolve(import.meta.dirname, '../scripts/cli.mjs');
const install = process.env.HEREIN_DSH_INSTALL || 'C:/Users/wzy_8/AppData/Local/Programs/DeepSeek Harness';
async function run(args) {
  const child = spawn(process.execPath, [cli, ...args], { windowsHide: true });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, `CLI ${args[0]} failed: ${stderr}`);
  return stdout;
}
async function serve(root, keys) {
  const child = spawn(process.execPath, [cli, 'serve', '--root', root, '--install', install, '--public-key', join(keys, 'approval-public.pem'), '--token-file', join(keys, 'transport-token')], { windowsHide: true });
  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('CLI startup timeout')); }, 25000);
    child.stdout.on('data', data => { output += data; if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0])); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`CLI exited during startup: ${code}`)); });
  });
  child.stderr.on('data', () => {});
  return { child, ready: await ready };
}
test('documented CLI separates approval authority, installs a reviewed plugin, and survives actual service restart', { timeout: 90000 }, async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'herein-cli-')), root = join(scratch, 'bridge'), keys = join(scratch, 'operator');
  await run(['keys', '--dir', keys]);
  let service = await serve(root, keys);
  t.after(() => service.child.kill());
  const request = join(scratch, 'request.json'), planPath = join(scratch, 'plan.json'), approvalPath = join(scratch, 'approval.json');
  await writeFile(request, JSON.stringify({ action: 'install', target: resolve(import.meta.dirname, '../fixtures/hello-v1'), enabled: true }));
  const connection = () => ['--url', service.ready.url, '--token-file', join(keys, 'transport-token')];
  await run(['plan', ...connection(), '--request', request, '--out', planPath]);
  const plan = JSON.parse(await readFile(planPath, 'utf8'));
  await run(['approve', '--plan', planPath, '--private-key', join(keys, 'approval-private.pem'), '--actor', 'CLI test operator: reviewed repository hello only', '--accept-host-code-risk', 'yes', '--out', approvalPath]);
  const operationId = randomUUID();
  const result = JSON.parse(await run(['execute', ...connection(), '--plan-id', plan.id, '--operation-id', operationId, '--approval', approvalPath]));
  assert.equal(result.application, 'applied');
  const argsPath = join(scratch, 'args.json'); await writeFile(argsPath, '{"name":"CLI"}');
  assert.equal(JSON.parse(await run(['call', ...connection(), '--name', 'herein_hello', '--args', argsPath])).value, 'hello CLI (v1)');
  const exit = once(service.child, 'exit'); service.child.kill(); await exit;
  service = await serve(root, keys);
  assert.equal(JSON.parse(await run(['call', ...connection(), '--name', 'herein_hello', '--args', argsPath])).value, 'hello CLI (v1)');
  assert.equal(JSON.parse(await run(['result', ...connection(), '--operation-id', operationId])).application, 'applied');
  console.log(JSON.stringify({ cliInstall: result.application, actualServiceRestart: true, callAfterRestart: 'hello CLI (v1)', approvalPrivateKeyOutsideBridge: true }));
});

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAuthority, approvePlan } from '../src/approval.mjs';
import { DshBridge } from '../src/bridge.mjs';
import { serveBridge } from '../src/server.mjs';
import { DshBridgeClient } from '../src/client.mjs';
import { within } from '../src/common.mjs';
const [command, ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) { if (!args[i].startsWith('--') || !args[i+1]) throw new Error('Options require --name value'); options[args[i].slice(2)] = args[i+1]; }
const json = async path => JSON.parse(await readFile(path, 'utf8'));
switch (command) {
  case 'keys': {
    const dir = resolve(options.dir); await mkdir(dir, { recursive: true });
    const keys = createAuthority();
    await writeFile(join(dir, 'approval-private.pem'), keys.privateKey, { flag: 'wx', mode: 0o600 });
    await writeFile(join(dir, 'approval-public.pem'), keys.publicKey, { flag: 'wx', mode: 0o600 });
    await writeFile(join(dir, 'transport-token'), randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
    console.log('Created approval keys and transport token. Keep the private key outside the bridge root.'); break;
  }
  case 'serve': {
    if (options['token-file'] && within(options.root, options['token-file'])) throw new Error('Keep the transport token outside the bridge root.');
    const bridge = await DshBridge.open({ root: options.root, install: options.install, publicKey: await readFile(options['public-key'], 'utf8') });
    let server;
    try { server = await serveBridge(bridge, { token: (await readFile(options['token-file'], 'utf8')).trim(), port: Number(options.port || 0) }); }
    catch (error) { await bridge.close(); throw error; }
    console.log(JSON.stringify({ url: server.url, profileId: bridge.profileId, runtimeVersion: bridge.runtimeVersion }));
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await server.close(); await bridge.close(); };
    process.on('SIGINT', close); process.on('SIGTERM', close); break;
  }
  case 'approve': {
    if (options['accept-host-code-risk'] !== 'yes') throw new Error('Review the plan, then use --accept-host-code-risk yes. Host code has your Windows user permissions.');
    const plan = await json(options.plan);
    const grant = approvePlan(plan, await readFile(options['private-key'], 'utf8'), options.actor);
    await writeFile(options.out, JSON.stringify(grant, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Signed the exact reviewed plan; grant expires in 5 minutes.'); break;
  }
  case 'inventory': case 'plan': case 'execute': case 'call': case 'audit': case 'result': case 'cancel': {
    const client = new DshBridgeClient({ url: options.url, token: (await readFile(options['token-file'], 'utf8')).trim() });
    const value = command === 'inventory' ? await client.inventory() : command === 'audit' ? await client.audit() : command === 'plan' ? await client.prepare(await json(options.request)) : command === 'execute' ? await client.execute(options['plan-id'], await json(options.approval), options['operation-id']) : command === 'call' ? await client.call(options.name, await json(options.args)) : command === 'cancel' ? await client.cancel(options['operation-id']) : await client.result(options['operation-id']);
    if (options.out) await writeFile(options.out, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); else console.log(JSON.stringify(value, null, 2)); break;
  }
  default: console.log('DSH bridge: keys, serve, inventory, plan, approve, execute, call, cancel, result, audit. See adapters/dsh/README.md.');
}

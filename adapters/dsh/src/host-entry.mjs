import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
const install = process.env.HEREIN_DSH_INSTALL;
if (!install || !process.env.DSH_HOME || process.env.HEREIN_DSH_PROFILE !== 'herein-b-test' || resolve(process.env.DSH_HOME) !== resolve(process.cwd(), 'home')) throw new Error('Host must be launched by the isolated bridge');
const { containWindowsChildren } = await import('./windows-job.mjs');
const containment = await containWindowsChildren(install);
const runtime = join(install, 'resources/app.asar/dsh');
const { runProfile } = await import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js')).href);
const { createLaunchEnvironmentSnapshot } = await import(pathToFileURL(join(runtime, 'node_modules/@deepseek-ai/dsh-launch-environment/lib/index.js')).href);
const host = await runProfile({
  environment: createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]),
  profile: process.env.HEREIN_DSH_PROFILE,
  patchFiles: [], args: [],
  packageManager: { command: process.execPath, args: ['--expose-internals', join(install, 'resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.mjs')], env: { ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_NODE_EXECUTABLE: process.execPath, npm_config_offline: 'true' } }
});
const { createProvider } = await import('./provider.mjs');
const provider = createProvider(host.ctx);
process.send?.({ type: 'ready', version: provider.version, services: ['pluginManager', 'tools', 'hmr'].map(name => ({ name, available: !!host.ctx.get(name) })) });
const calls = new Map();
process.on('message', async request => {
  if (request.method === 'shutdown') {
    for (const controller of calls.values()) controller.abort();
    await host.shutdown.shutdown(0);
    process.disconnect?.();
    process.exit(0);
    return;
  }
  if (request.method === 'cancel') {
      calls.get(request.target)?.abort();
    await provider.cancelInstall(request.target);
    return;
  }
  const controller = new AbortController();
  calls.set(request.args?.requestId || request.id, controller);
  try {
    const value = await provider.invoke(request.method, request.args || {}, controller.signal);
    process.send?.({ id: request.id, ok: true, value });
  } catch (error) {
    process.send?.({ id: request.id, ok: false, error: { code: error.code || 'HOST_OPERATION_FAILED' } });
  } finally { calls.delete(request.args?.requestId || request.id); }
});
process.on('disconnect', () => { host.shutdown.shutdown(0).finally(() => process.exit(0)); });

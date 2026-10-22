// This is the entire DSH-facing adaptation. Lifecycle operations remain DSH's.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = join(process.env.HEREIN_DSH_INSTALL, 'resources/app.asar/dsh/node_modules/@deepseek-ai');
const { getDshRuntimeVersion } = await import(pathToFileURL(join(runtime, 'dsh-app-boot/lib/index.js')).href);
export function createProvider(ctx) {
  const manager = ctx.get('pluginManager');
  const tools = ctx.get('tools');
  if (!manager || !tools || !ctx.get('hmr')) throw new Error('Required DSH services unavailable');
  return {
    version: getDshRuntimeVersion(),
    cancelInstall: id => manager.cancelInstall(id),
    async invoke(method, args, signal) {
      switch (method) {
        case 'inventory': return { plugins: await manager.listPlugins(), bundles: await manager.listBundles(), capabilities: tools.schemas() };
        case 'inspect': return manager.inspect(args.target, undefined, signal);
        case 'cancelInstall': return manager.cancelInstall(args.requestId);
        case 'install': return manager.installBundle(args.target, { enabled: args.enabled === true, requestId: args.requestId, approvedBuilds: args.approvedBuilds, saveExact: true });
        case 'setPlugin': return manager.setPluginEnabled(args.target, args.enabled);
        case 'setBundle': return manager.setBundleEnabled(args.target, args.enabled);
        case 'remove': return manager.removeBundle(args.target);
        case 'call': return tools.execute({ name: args.name, arguments: args.arguments, callId: args.requestId, signal });
        default: throw Object.assign(new Error('Unknown operation'), { code: 'UNKNOWN_OPERATION' });
      }
    }
  };
}

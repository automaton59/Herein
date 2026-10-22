import { DshBridge } from '../src/bridge.mjs';
import { readFile } from 'node:fs/promises';
const bridge = await DshBridge.open({ root: process.argv[2], install: process.argv[3], publicKey: await readFile(process.argv[4], 'utf8') });
process.send({ type: 'ready', hostPid: bridge.host.child.pid });
process.on('message', async request => {
  try {
    const result = await bridge.execute(request.planId, request.approval, request.operationId);
    process.send({ type: 'result', result });
  } catch (error) { process.send({ type: 'error', code: error.code }); }
});

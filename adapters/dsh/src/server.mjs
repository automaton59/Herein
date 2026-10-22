import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fail } from './common.mjs';

export async function serveBridge(bridge, { token, port = 0 } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw fail('STRONG_TOKEN_REQUIRED');
  const expected = Buffer.from('Bearer ' + token);
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { if (!response.destroyed) { response.statusCode = status; response.end(JSON.stringify(value)); } };
    const actual = Buffer.from(request.headers.authorization || '');
    if (request.headers.origin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      await bridge.audit.append('transport.denied', { code: request.headers.origin ? 'BROWSER_ORIGIN_DENIED' : 'AUTH_REQUIRED' });
      send(401, { error: { code: 'AUTH_REQUIRED' } }); return;
    }
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method === 'GET') {
        switch (path) {
          case '/health': send(200, { protocol: 1, profileId: bridge.profileId, runtimeVersion: bridge.runtimeVersion, host: bridge.host?.child ? 'running' : 'offline' }); return;
          case '/v1/inventory': send(200, await bridge.inventory()); return;
          case '/v1/audit': send(200, { records: bridge.audit.records }); return;
          case '/v1/snapshots': send(200, { snapshots: await bridge.snapshots() }); return;
          default: {
            const match = path.match(/^\/v1\/operations\/([a-f0-9-]{36})$/);
            if (match) { const result = bridge.audit.operation(match[1]); send(result ? 200 : 404, result || { error: { code: 'RESULT_NOT_FOUND' } }); return; }
          }
        }
      }
      if (request.method !== 'POST') { send(404, { error: { code: 'NOT_FOUND' } }); return; }
      if (!request.headers['content-type']?.startsWith('application/json')) throw fail('JSON_REQUIRED');
      let bytes = 0, parts = [];
      for await (const part of request) { bytes += part.length; if (bytes > 1024 * 1024) throw fail('REQUEST_TOO_LARGE'); parts.push(part); }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      switch (path) {
        case '/v1/plans': send(200, await bridge.prepare(body)); return;
        case '/v1/execute': send(200, await bridge.execute(body.planId, body.approval, body.operationId)); return;
        case '/v1/cancel': send(200, await bridge.cancel(body.operationId)); return;
        case '/v1/call': send(200, await bridge.call(body.name, body.arguments, { signal: controller.signal, timeoutMs: body.timeoutMs })); return;
        default: send(404, { error: { code: 'NOT_FOUND' } });
      }
    } catch (error) { send(400, { error: { code: error.code || 'INVALID_REQUEST' } }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }) };
}

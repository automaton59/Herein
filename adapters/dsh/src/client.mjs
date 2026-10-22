export class DshBridgeClient {
  constructor({ url, token }) { this.url = url.replace(/\/$/, ''); this.token = token; }
  async request(path, body, signal) {
    const response = await fetch(this.url + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error.code), { code: value.error.code });
    return value;
  }
  health() { return this.request('/health'); }
  inventory() { return this.request('/v1/inventory'); }
  prepare(request) { return this.request('/v1/plans', request); }
  execute(planId, approval, operationId) { return this.request('/v1/execute', { planId, approval, operationId }); }
  cancel(operationId) { return this.request('/v1/cancel', { operationId }); }
  call(name, args, options = {}) { return this.request('/v1/call', { name, arguments: args, timeoutMs: options.timeoutMs }, options.signal); }
  result(operationId) { return this.request(`/v1/operations/${operationId}`); }
  audit() { return this.request('/v1/audit'); }
  snapshots() { return this.request('/v1/snapshots'); }
}

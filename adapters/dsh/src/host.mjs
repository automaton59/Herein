import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './common.mjs';

export class DshHost {
  constructor({ install, home, profile, cwd, onExit }) { Object.assign(this, { install, home, profile, cwd, onExit }); this.pending = new Map(); }
  async start() {
    if (this.child) throw fail('HOST_ALREADY_STARTED');
    // Credentials, model keys, proxy credentials, NODE_OPTIONS and user DSH
    // settings never cross this process boundary.
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    Object.assign(env, { PATH: [join(this.install, 'resources/runtime/bin'), join(process.env.SystemRoot || 'C:/Windows', 'System32')].join(delimiter), USERPROFILE: this.home, HOME: this.home, APPDATA: join(this.home, 'appdata'), LOCALAPPDATA: join(this.home, 'localappdata'), DSH_HOME: this.home, HEREIN_DSH_INSTALL: this.install, HEREIN_DSH_PROFILE: this.profile, ELECTRON_RUN_AS_NODE: '1', DSH_TELEMETRY_DISABLED: '1', CI: '1' });
    const child = spawn(join(this.install, 'DeepSeek Harness.exe'), ['--expose-internals', fileURLToPath(new URL('./host-entry.mjs', import.meta.url))], { env, cwd: this.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.child = child;
    // Native diagnostic text can contain source URLs or untrusted plugin text.
    // Drain it, but do not persist or expose it. Structured errors are retained.
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    const ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    const timer = setTimeout(() => { this.readyReject?.(fail('HOST_START_TIMEOUT')); child.kill(); }, 20000);
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); this.readyResolve?.(message); return; }
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id);
      clearTimeout(task.timer);
      message.ok ? task.resolve(message.value) : task.reject(fail(message.error?.code || 'HOST_OPERATION_FAILED'));
    });
    const exited = (code, signal) => {
      clearTimeout(timer);
      this.child = undefined;
      this.readyReject?.(fail('HOST_EXITED'));
      for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(fail('HOST_EXITED')); }
      this.pending.clear();
      this.onExit?.({ code, signal });
    };
    child.once('exit', exited);
    child.once('error', () => exited(null, 'spawn-error'));
    this.ready = await ready;
    return this.ready;
  }
  request(method, args = {}, { timeoutMs = 60000, signal } = {}) {
    const child = this.child;
    if (!child?.connected) return Promise.reject(fail('HOST_OFFLINE'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => child.connected && child.send({ method: 'cancel', target: args.requestId || id });
      if (signal?.aborted) { reject(fail('ABORTED_BEFORE_DISPATCH')); return; }
      signal?.addEventListener('abort', abort, { once: true });
      const complete = cb => value => { signal?.removeEventListener('abort', abort); cb(value); };
      const timer = setTimeout(() => { abort(); child.kill(); this.pending.delete(id); signal?.removeEventListener('abort', abort); reject(fail('HOST_REQUEST_TIMEOUT')); }, timeoutMs);
      this.pending.set(id, { resolve: complete(resolve), reject: complete(reject), timer });
      child.send({ id, method, args });
    });
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    await new Promise(resolve => {
      const timer = setTimeout(() => child.kill(), 6000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      if (child.connected) child.send({ id: randomUUID(), method: 'shutdown' }); else child.kill();
    });
    this.stopping = false;
  }
}

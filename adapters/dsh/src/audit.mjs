import { open, readFile } from 'node:fs/promises';
import { canonical, digest, fail } from './common.mjs';

export class AuditJournal {
  constructor(path) { this.path = path; this.records = []; this.tail = Promise.resolve(); }
  async load() {
    let content;
    try { content = await readFile(this.path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (content && !content.endsWith('\n')) throw fail('AUDIT_TRUNCATED');
    let previous = '0'.repeat(64), sequence = 0;
    this.records = content.split('\n').filter(Boolean).map(line => {
      const record = JSON.parse(line), { hash, ...body } = record;
      if (body.sequence !== ++sequence || body.previous !== previous || digest(body) !== hash) throw fail('AUDIT_TAMPERED');
      previous = hash;
      return record;
    });
  }
  append(event, data = {}) {
    const task = this.tail.then(async () => {
      if (this.poisoned) throw fail('AUDIT_UNAVAILABLE');
      const body = { sequence: this.records.length + 1, previous: this.records.at(-1)?.hash || '0'.repeat(64), time: new Date().toISOString(), event, ...data };
      const record = { ...body, hash: digest(body) };
      const fd = await open(this.path, 'a', 0o600);
      try { await fd.writeFile(canonical(record) + '\n'); await fd.sync(); } finally { await fd.close(); }
      this.records.push(record);
      return record;
    });
    this.tail = task.catch(() => { this.poisoned = true; });
    return task;
  }
  usedNonce(nonce) { return this.records.some(row => row.event === 'approval.consumed' && row.nonce === nonce); }
  operation(id) { return this.records.findLast(row => row.event === 'operation.finished' && row.operationId === id)?.result; }
}

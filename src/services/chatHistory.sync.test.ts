import { describe, expect, it } from 'vitest';
import type { Message } from './interfaces';
import { diffMessagesForCoreSync } from './chatHistory';

function message(id: string, content: string, status: Message['status'] = 'sent'): Message {
  return {
    id,
    role: 'user',
    content,
    timestamp: new Date('2026-10-22T12:00:00.000Z'),
    status,
  };
}

describe('diffMessagesForCoreSync', () => {
  it('sends all messages on the first sync', () => {
    const result = diffMessagesForCoreSync([message('a', '一'), message('b', '二')], {});
    expect(result.upserts.map(item => item.id)).toEqual(['a', 'b']);
    expect(result.deletes).toEqual([]);
  });

  it('sends only changed/added messages and explicit deletes after that', () => {
    const first = diffMessagesForCoreSync([message('a', '一'), message('b', '二')], {});
    const second = diffMessagesForCoreSync(
      [
        { ...message('a', '一改'), timestamp: new Date('2026-10-22T12:00:01.000Z') },
        message('c', '三'),
      ],
      first.current,
    );

    expect(second.upserts.map(item => item.id)).toEqual(['a', 'c']);
    expect(second.deletes).toEqual(['b']);
    expect(Object.keys(second.current)).toEqual(['a', 'c']);
  });

  it('treats status/emotion changes as updates', () => {
    const first = diffMessagesForCoreSync([message('a', '一')], {});
    const second = diffMessagesForCoreSync(
      [{ ...message('a', '一', 'pending'), emotion: 'happy' }],
      first.current,
    );
    expect(second.upserts).toHaveLength(1);
    expect(second.deletes).toEqual([]);
  });
});

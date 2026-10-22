/** @vitest-environment node */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from './database';
import { createPhase2Repositories } from './repositories';

const tempDirs: string[] = [];

function createTestDatabase() {
  const dir = mkdtempSync(path.join(tmpdir(), 'al-1s-repos-'));
  tempDirs.push(dir);
  const db = openPhase2Database(path.join(dir, 'app.db'));
  return db;
}

function closeTestDatabase(db: Phase2Database) {
  closePhase2Database(db);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('phase2 repositories', () => {
  it('stores app settings as JSON values', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.settings.set('themeMode', 'dark');
    repos.settings.set('memorySettings', {
      enabled: true,
      triggerMessageCount: 20,
      profileMode: 'follow-chat',
    });

    expect(repos.settings.get('themeMode')).toBe('dark');
    expect(repos.settings.get('memorySettings')).toEqual({
      enabled: true,
      triggerMessageCount: 20,
      profileMode: 'follow-chat',
    });
    expect(repos.settings.get('missing', 'fallback')).toBe('fallback');

    closeTestDatabase(db);
  });

  it('upserts and deletes API profiles without changing encrypted key payloads', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.apiProfiles.upsert({
      id: 'profile-1',
      name: 'Main',
      provider: 'custom',
      baseURL: 'https://example.test/v1',
      model: 'model-a',
      temperature: 0.7,
      maxTokens: 2000,
      encryptedApiKey: 'ciphertext',
      keyEncoding: 'safe:v1',
      lastConnectedAt: '2026-06-19T00:00:00.000Z',
    });

    repos.apiProfiles.upsert({
      id: 'profile-1',
      name: 'Main Renamed',
      provider: 'custom',
      baseURL: 'https://example.test/v1',
      model: 'model-b',
      encryptedApiKey: 'ciphertext',
      keyEncoding: 'safe:v1',
    });

    expect(repos.apiProfiles.list()).toEqual([
      expect.objectContaining({
        id: 'profile-1',
        name: 'Main Renamed',
        model: 'model-b',
        encryptedApiKey: 'ciphertext',
        keyEncoding: 'safe:v1',
      }),
    ]);

    repos.apiProfiles.delete('profile-1');
    expect(repos.apiProfiles.list()).toEqual([]);

    closeTestDatabase(db);
  });

  it('keeps one primary timeline per character and archives additional timelines', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({
      id: 'char-1',
      name: 'AL-1S',
      description: 'A warm companion.',
      scenario: 'Private chat.',
      firstMessage: 'I am here.',
      systemPrompt: 'Stay in character.',
      personalityCore: 'Kind and playful.',
      speakingStyle: 'Natural.',
      valuesText: 'Care.',
      boundaries: 'Respect user limits.',
    });

    const primary = repos.timelines.ensurePrimaryForCharacter('char-1', 'AL-1S');
    const samePrimary = repos.timelines.ensurePrimaryForCharacter('char-1', 'AL-1S renamed');
    const archive = repos.timelines.createArchiveForCharacter('char-1', 'Old chat', 'conv-old');

    expect(samePrimary.id).toBe(primary.id);
    expect(repos.timelines.getPrimaryForCharacter('char-1')?.id).toBe(primary.id);
    expect(archive.isPrimary).toBe(false);
    expect(repos.timelines.listByCharacter('char-1').map(item => item.id)).toEqual([
      archive.id,
      primary.id,
    ]);

    closeTestDatabase(db);
  });

  it('stores messages and supports delete-after in a timeline', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });
    const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', 'AL-1S');

    repos.messages.append({
      id: 'm1',
      timelineId: timeline.id,
      role: 'user',
      content: 'hello',
      timestamp: '2026-06-19T00:00:00.000Z',
    });
    repos.messages.append({
      id: 'm2',
      timelineId: timeline.id,
      role: 'assistant',
      content: 'hi',
      timestamp: '2026-06-19T00:01:00.000Z',
      emotion: 'happy',
      voiceInstruct: '用轻快、带笑意的语气说',
    });
    repos.messages.append({
      id: 'm3',
      timelineId: timeline.id,
      role: 'user',
      content: 'later',
      timestamp: '2026-06-19T00:02:00.000Z',
    });

    expect(repos.messages.listRecent(timeline.id, 10)).toEqual([
      expect.objectContaining({ id: 'm1' }),
      expect.objectContaining({
        id: 'm2',
        emotion: 'happy',
        voiceInstruct: '用轻快、带笑意的语气说',
      }),
      expect.objectContaining({ id: 'm3' }),
    ]);

    repos.messages.deleteAfter(timeline.id, 'm1');
    expect(repos.messages.listRecent(timeline.id, 10).map(message => message.id)).toEqual(['m1']);

    closeTestDatabase(db);
  });

  it('treats appending an existing message id as an idempotent update', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });
    const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', 'AL-1S');

    repos.messages.append({
      id: 'm1',
      timelineId: timeline.id,
      role: 'user',
      content: 'pending draft',
      timestamp: '2026-06-19T00:00:00.000Z',
      status: 'pending',
    });

    expect(() => repos.messages.append({
      id: 'm1',
      timelineId: timeline.id,
      role: 'user',
      content: 'sent message',
      timestamp: '2026-06-19T00:00:00.000Z',
      status: 'sent',
    })).not.toThrow();

    expect(repos.messages.listRecent(timeline.id, 10)).toEqual([
      expect.objectContaining({
        id: 'm1',
        content: 'sent message',
        status: 'sent',
      }),
    ]);

    closeTestDatabase(db);
  });

  it('clears all messages in a timeline', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });
    const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', 'AL-1S');
    repos.messages.append({
      id: 'm1',
      timelineId: timeline.id,
      role: 'user',
      content: 'hello',
      timestamp: '2026-06-19T00:00:00.000Z',
    });
    repos.messages.append({
      id: 'm2',
      timelineId: timeline.id,
      role: 'assistant',
      content: 'hi',
      timestamp: '2026-06-19T00:01:00.000Z',
    });

    repos.messages.clearTimeline(timeline.id);

    expect(repos.messages.listRecent(timeline.id, 10)).toEqual([]);

    closeTestDatabase(db);
  });

  it('upserts summaries and filters disabled memories from active context', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });
    const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', 'AL-1S');

    repos.summaries.upsert({
      id: 'summary-1',
      timelineId: timeline.id,
      content: 'They talked about moving from Hangzhou to Shanghai.',
      messageCount: 12,
      sourceMessageIds: ['m1', 'm2'],
    });
    repos.summaries.upsert({
      id: 'summary-1',
      timelineId: timeline.id,
      content: 'Updated summary.',
      messageCount: 14,
      sourceMessageIds: ['m1', 'm2', 'm3'],
    });

    const summary = repos.summaries.getByTimeline(timeline.id);
    expect(summary).toEqual(expect.objectContaining({
      content: 'Updated summary.',
      messageCount: 14,
      sourceMessageIds: ['m1', 'm2', 'm3'],
    }));

    repos.memories.create({
      id: 'mem-1',
      characterId: 'char-1',
      timelineId: timeline.id,
      scope: 'character',
      kind: 'state',
      content: 'User will move from Hangzhou to Shanghai next week.',
      currentValue: 'Moving to Shanghai next week.',
      previousValue: 'Recently in Hangzhou.',
      sourceMessageIds: ['m1'],
      confidence: 0.9,
      origin: 'summary',
      audience: 'private',
      importance: 8,
      provenance: 'summary',
      sourceObservationIds: ['obs-1'],
      recallCount: 3,
    });
    repos.memories.create({
      id: 'mem-2',
      characterId: 'char-1',
      scope: 'character',
      kind: 'preference',
      content: 'User dislikes being called boss.',
      pinned: true,
      origin: 'manual',
      audience: 'group',
      importance: 9,
      provenance: 'owner',
    });

    repos.memories.create({
      id: 'mem-3',
      characterId: 'char-1',
      scope: 'character',
      kind: 'event',
      content: '用户下周搬去上海 Shanghai。',
      audience: 'group',
      importance: 7,
    });

    repos.memories.disable('mem-1');

    expect(repos.memories.search('Shanghai', { characterId: 'char-1' }).map(memory => memory.id)).toContain('mem-3');
    expect(repos.memories.search('上海', { characterId: 'char-1' }).map(memory => memory.id)).toContain('mem-3');
    expect(repos.memories.search('上海', { characterId: 'char-1', audience: 'private' })).toEqual([]);
    expect(repos.memories.listActive({ characterId: 'char-1' }).map(memory => memory.id)).toEqual(['mem-2', 'mem-3']);
    expect(repos.memories.listActive({ characterId: 'char-1', audience: 'group' }).map(memory => memory.id)).toEqual(['mem-2', 'mem-3']);
    expect(repos.memories.listActive({ characterId: 'char-1', minImportance: 9 }).map(memory => memory.id)).toEqual(['mem-2']);
    expect(repos.memories.listAll({ characterId: 'char-1' }).map(memory => memory.id).sort()).toEqual(['mem-1', 'mem-2', 'mem-3']);
    expect(repos.memories.listAll({ characterId: 'char-1' }).find(memory => memory.id === 'mem-1')).toEqual(expect.objectContaining({
      audience: 'private',
      importance: 8,
      provenance: 'summary',
      sourceObservationIds: ['obs-1'],
      recallCount: 3,
    }));

    repos.memories.delete('mem-2');
    expect(repos.memories.listAll({ characterId: 'char-1' }).map(memory => memory.id).sort()).toEqual(['mem-1', 'mem-3']);

    closeTestDatabase(db);
  });

  it('upserts and reads relationship profiles separately from character identity', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });
    repos.relationships.upsert({
      characterId: 'char-1',
      tone: 'close and relaxed',
      closeness: 4,
      sharedHabits: 'Say good night.',
      privateLanguage: 'soft nickname',
      importantExperiences: 'Gift on August 3.',
      unresolvedContext: 'Moving logistics.',
    });

    repos.relationships.upsert({
      characterId: 'char-1',
      tone: 'more intimate',
      closeness: 5,
      sharedHabits: 'Say good night.',
      privateLanguage: 'soft nickname',
      importantExperiences: 'Gift on August 3.',
      unresolvedContext: '',
    });

    expect(repos.relationships.get('char-1')).toEqual(expect.objectContaining({
      characterId: 'char-1',
      tone: 'more intimate',
      closeness: 5,
      importantExperiences: 'Gift on August 3.',
    }));

    closeTestDatabase(db);
  });

  it('stores asset metadata separately from character profile references', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });
    repos.assets.create({
      id: 'asset-1',
      characterId: 'char-1',
      kind: 'avatar',
      relativePath: 'assets/char-1/avatar-asset-1.png',
      mimeType: 'image/png',
      label: '头像',
    });
    repos.characters.upsert({
      id: 'char-1',
      name: 'AL-1S',
      avatarAssetId: 'asset-1',
    });

    expect(repos.assets.get('asset-1')).toEqual(expect.objectContaining({
      id: 'asset-1',
      characterId: 'char-1',
      kind: 'avatar',
      relativePath: 'assets/char-1/avatar-asset-1.png',
    }));
    expect(repos.characters.get('char-1')).toEqual(expect.objectContaining({
      avatarAssetId: 'asset-1',
    }));

    closeTestDatabase(db);
  });

  it('stores and lists expression asset metadata', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });
    repos.assets.create({
      id: 'asset-happy',
      characterId: 'char-1',
      kind: 'expression',
      relativePath: 'assets/char-1/expression-asset-happy.png',
      mimeType: 'image/png',
      label: '开心',
      metadata: { emotion: 'happy', expressionKey: 'happy-main', priority: 10 },
    });
    repos.assets.create({
      id: 'asset-neutral',
      characterId: 'char-1',
      kind: 'expression',
      relativePath: 'assets/char-1/expression-asset-neutral.png',
      mimeType: 'image/png',
      label: '默认',
      metadata: { emotion: 'neutral', priority: 1 },
    });

    expect(repos.assets.list({ characterId: 'char-1', kind: 'expression' })).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'asset-neutral',
        metadata: expect.objectContaining({ emotion: 'neutral', priority: 1 }),
      }),
      expect.objectContaining({
        id: 'asset-happy',
        metadata: expect.objectContaining({ emotion: 'happy', expressionKey: 'happy-main', priority: 10 }),
      }),
    ]));

    repos.assets.update('asset-happy', {
      label: '轻松开心',
      metadata: { emotion: 'happy', expressionKey: 'happy-soft', priority: 20 },
    });

    expect(repos.assets.get('asset-happy')).toEqual(expect.objectContaining({
      label: '轻松开心',
      metadata: expect.objectContaining({ expressionKey: 'happy-soft', priority: 20 }),
    }));

    repos.assets.delete('asset-neutral');
    expect(repos.assets.list({ characterId: 'char-1', kind: 'expression' }).map(asset => asset.id)).toEqual(['asset-happy']);

    closeTestDatabase(db);
  });

  it('upserts and reads character presentation profiles', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });

    expect(repos.presentationProfiles.get('char-1')).toEqual({
      characterId: 'char-1',
      defaultAssetId: null,
      dynamicAssetId: null,
      emotionAssetMap: {},
      fallbackEmotion: 'neutral',
      preferredRenderer: 'auto',
    });

    repos.presentationProfiles.upsert({
      characterId: 'char-1',
      defaultAssetId: 'asset-neutral',
      dynamicAssetId: 'asset-video',
      fallbackEmotion: 'worried',
      preferredRenderer: 'video',
      emotionAssetMap: {
        happy: 'asset-happy',
        worried: 'asset-worried',
      },
    });

    expect(repos.presentationProfiles.get('char-1')).toEqual({
      characterId: 'char-1',
      defaultAssetId: 'asset-neutral',
      dynamicAssetId: 'asset-video',
      fallbackEmotion: 'worried',
      preferredRenderer: 'video',
      emotionAssetMap: {
        happy: 'asset-happy',
        worried: 'asset-worried',
      },
    });

    repos.presentationProfiles.upsert({
      characterId: 'char-1',
      defaultAssetId: null,
      dynamicAssetId: null,
      fallbackEmotion: 'neutral',
      preferredRenderer: 'static',
      emotionAssetMap: {
        happy: 'asset-happy-2',
      },
    });

    expect(repos.presentationProfiles.get('char-1')).toEqual({
      characterId: 'char-1',
      defaultAssetId: null,
      dynamicAssetId: null,
      fallbackEmotion: 'neutral',
      preferredRenderer: 'static',
      emotionAssetMap: {
        happy: 'asset-happy-2',
      },
    });

    closeTestDatabase(db);
  });

  it('syncs timeline messages incrementally without rewriting unchanged rows', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.characters.upsert({ id: 'char-1', name: 'AL-1S' });
    const timeline = repos.timelines.ensurePrimaryForCharacter('char-1', 'AL-1S');
    const base = {
      timelineId: timeline.id,
      role: 'user' as const,
      timestamp: '2026-06-19T08:00:00.000Z',
    };
    const first = { ...base, id: 'msg-1', content: 'one' };
    const second = {
      ...base,
      id: 'msg-2',
      role: 'assistant' as const,
      content: 'two',
      timestamp: '2026-06-19T08:01:00.000Z',
    };

    expect(repos.messages.sync(timeline.id, [first, second], 'AL-1S')).toEqual({
      inserted: 2,
      updated: 0,
      deleted: 0,
    });
    expect(repos.messages.listRecent(timeline.id, 10).map(message => message.id)).toEqual(['msg-1', 'msg-2']);

    const edited = { ...first, content: 'one edited', emotion: 'happy' };
    const third = {
      ...base,
      id: 'msg-3',
      role: 'assistant' as const,
      content: 'three',
      timestamp: '2026-06-19T08:02:00.000Z',
    };

    expect(repos.messages.sync(timeline.id, [edited, second, third], 'Renamed')).toEqual({
      inserted: 1,
      updated: 1,
      deleted: 0,
    });
    expect(repos.messages.listRecent(timeline.id, 10).map(message => message.content)).toEqual([
      'one edited',
      'two',
      'three',
    ]);
    expect(repos.timelines.getPrimaryForCharacter('char-1')?.title).toBe('Renamed');

    expect(repos.messages.sync(timeline.id, [edited, second])).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 1,
    });
    expect(repos.messages.listRecent(timeline.id, 10).map(message => message.id)).toEqual(['msg-1', 'msg-2']);

    expect(repos.messages.sync(timeline.id, [])).toEqual({
      inserted: 0,
      updated: 0,
      deleted: 2,
    });
    expect(repos.messages.listRecent(timeline.id, 10)).toEqual([]);

    closeTestDatabase(db);
  });

  it('stores observations, experiences and sync ops with audience/provenance', () => {
    const db = createTestDatabase();
    const repos = createPhase2Repositories(db);

    repos.channelAccounts.upsert({
      id: 'acct-qq-1',
      platform: 'qq',
      externalId: 'bot-openid',
      displayName: '海拾香',
    });
    repos.identityLinks.upsert({
      id: 'link-1',
      platform: 'qq',
      externalId: 'member-openid',
      canonicalPersonId: 'person-1',
      displayName: '蓝蓝',
    });

    const observation = {
      id: 'obs-1',
      platform: 'qq',
      accountId: 'acct-qq-1',
      conversationId: 'group-openid',
      conversationKind: 'group' as const,
      actorId: 'member-openid',
      actorName: '蓝蓝',
      kind: 'message',
      content: '今天好累。',
      occurredAt: '2026-10-21T12:00:00.000Z',
      receivedAt: '2026-10-21T12:00:01.000Z',
      provenance: 'owner' as const,
      audience: 'group' as const,
      trust: 0.9,
      dedupeKey: 'qq:group-openid:obs-1',
    };

    expect(repos.observations.insert(observation)).toBe(true);
    expect(repos.observations.insert({
      ...observation,
      id: 'obs-duplicate',
      dedupeKey: 'qq:group-openid:obs-1',
    })).toBe(false);

    const observations = repos.observations.listRecent({ platform: 'qq', conversationId: 'group-openid' });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toEqual(expect.objectContaining({
      id: 'obs-1',
      actorName: '蓝蓝',
      audience: 'group',
      provenance: 'owner',
      trust: 0.9,
    }));
    expect(repos.identityLinks.resolve('qq', 'member-openid')?.canonicalPersonId).toBe('person-1');

    repos.experiences.create({
      id: 'exp-1',
      kind: 'listened_music',
      sourceObservationIds: ['obs-1'],
      title: '今天听了一首歌',
      summary: '一首适合深夜的歌。',
      reaction: '还不错。',
      importance: 7,
      happenedAt: '2026-10-21T12:30:00.000Z',
    });
    expect(repos.experiences.listRecent(5)).toEqual([
      expect.objectContaining({
        id: 'exp-1',
        kind: 'listened_music',
        sourceObservationIds: ['obs-1'],
        importance: 7,
      }),
    ]);

    repos.syncOps.append({
      id: 'op-1',
      deviceId: 'device-b',
      hlc: '2026-10-21T12:31:00.000Z-0001',
      entity: 'message',
      entityId: 'obs-1',
      op: 'create',
      payload: { text: 'hi' },
    });
    expect(repos.syncOps.listSince('device-a', '2026-10-21T00:00:00.000Z')).toEqual([
      expect.objectContaining({
        id: 'op-1',
        deviceId: 'device-b',
        entity: 'message',
        payload: { text: 'hi' },
      }),
    ]);

    closeTestDatabase(db);
  });
});

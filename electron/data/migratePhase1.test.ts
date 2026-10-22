/** @vitest-environment node */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { closePhase2Database, openPhase2Database, type Phase2Database } from './database';
import { migratePhase1JsonData } from './migratePhase1';
import { createPhase2Repositories } from './repositories';

const tempDirs: string[] = [];

function createTempDir(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createDb(dir: string): Phase2Database {
  return openPhase2Database(path.join(dir, 'app.db'));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('migratePhase1JsonData', () => {
  it('migrates config, profiles, active conversations, archives, and messages idempotently', () => {
    const dataDir = createTempDir('al-1s-phase1-data-');
    const db = createDb(dataDir);

    writeJson(path.join(dataDir, 'config.json'), {
      activeCharacterId: 'char-1',
      activeProfileId: 'profile-1',
      themeMode: 'dark',
      characters: [
        {
          id: 'char-1',
          name: 'AL-1S',
          description: 'Warm companion.',
          scenario: 'Private chat.',
          firstMessage: 'I am here.',
          systemPrompt: 'Stay in character.',
        },
        {
          id: 'char-2',
          name: 'Mira',
          description: 'Another contact.',
          scenario: '',
          firstMessage: 'Hi.',
          systemPrompt: 'Stay kind.',
        },
      ],
    });

    writeJson(path.join(dataDir, 'api-profiles.json'), [
      {
        id: 'profile-1',
        name: 'Main',
        provider: 'custom',
        baseURL: 'https://api.example.test/v1',
        model: 'model-a',
        temperature: 0.6,
        maxTokens: 2048,
        encryptedApiKey: 'safe-ciphertext',
        keyEncoding: 'safe:v1',
        lastConnectedAt: '2026-06-19T02:00:00.000Z',
      },
    ]);

    writeJson(path.join(dataDir, 'chat-history.json'), {
      activeConversationId: 'conv-new',
      conversations: [
        {
          id: 'conv-old',
          title: 'Old chat',
          characterId: 'char-1',
          createdAt: '2026-06-18T00:00:00.000Z',
          updatedAt: '2026-06-18T01:00:00.000Z',
          messages: [
            {
              id: 'old-m1',
              role: 'user',
              content: 'old hello',
              timestamp: '2026-06-18T00:01:00.000Z',
            },
          ],
        },
        {
          id: 'conv-new',
          title: 'Current chat',
          characterId: 'char-1',
          createdAt: '2026-06-19T00:00:00.000Z',
          updatedAt: '2026-06-19T01:00:00.000Z',
          messages: [
            {
              id: 'new-m1',
              role: 'user',
              content: 'I am in Hangzhou now.',
              timestamp: '2026-06-19T00:01:00.000Z',
            },
            {
              id: 'new-m2',
              role: 'assistant',
              content: 'I remember.',
              timestamp: '2026-06-19T00:02:00.000Z',
              emotion: 'happy',
            },
          ],
        },
        {
          id: 'conv-other',
          title: 'Mira chat',
          characterId: 'char-2',
          createdAt: '2026-06-19T03:00:00.000Z',
          updatedAt: '2026-06-19T03:30:00.000Z',
          messages: [
            {
              id: 'other-m1',
              role: 'user',
              content: 'hello Mira',
              timestamp: '2026-06-19T03:01:00.000Z',
            },
          ],
        },
      ],
    });

    const firstResult = migratePhase1JsonData({ db, dataDir });
    const secondResult = migratePhase1JsonData({ db, dataDir });
    const repos = createPhase2Repositories(db);

    expect(firstResult.status).toBe('migrated');
    expect(secondResult.status).toBe('already-migrated');
    expect(firstResult.backupDir && existsSync(firstResult.backupDir)).toBe(true);
    expect(readFileSync(path.join(firstResult.backupDir!, 'config.json'), 'utf8')).toContain('char-1');

    expect(repos.settings.get('themeMode')).toBe('dark');
    expect(repos.settings.get('activeCharacterId')).toBe('char-1');
    expect(repos.settings.get('activeProfileId')).toBe('profile-1');

    expect(repos.apiProfiles.list()).toEqual([
      expect.objectContaining({
        id: 'profile-1',
        encryptedApiKey: 'safe-ciphertext',
        keyEncoding: 'safe:v1',
      }),
    ]);

    expect(repos.characters.list().map(character => character.id).sort()).toEqual(['char-1', 'char-2']);

    const charOneTimelines = repos.timelines.listByCharacter('char-1');
    const primary = repos.timelines.getPrimaryForCharacter('char-1');
    expect(primary).toEqual(expect.objectContaining({
      title: 'Current chat',
      sourceConversationId: 'conv-new',
      isPrimary: true,
    }));
    expect(charOneTimelines.filter(timeline => !timeline.isPrimary)).toEqual([
      expect.objectContaining({
        title: 'Old chat',
        sourceConversationId: 'conv-old',
        kind: 'archive',
      }),
    ]);

    expect(repos.messages.listRecent(primary!.id, 10).map(message => message.id)).toEqual(['new-m1', 'new-m2']);

    const charTwoPrimary = repos.timelines.getPrimaryForCharacter('char-2');
    expect(charTwoPrimary).toEqual(expect.objectContaining({
      title: 'Mira chat',
      sourceConversationId: 'conv-other',
    }));
    expect(repos.messages.listRecent(charTwoPrimary!.id, 10).map(message => message.id)).toEqual(['other-m1']);

    expect(repos.apiProfiles.list()).toHaveLength(1);
    expect(repos.characters.list()).toHaveLength(2);
    expect(repos.messages.listRecent(primary!.id, 10)).toHaveLength(2);

    closePhase2Database(db);
  });
});

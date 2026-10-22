# Phase 2 Implementation Plan

> Historical status: this was the execution plan used to land Phase 2. The checkbox state below is the original work queue, not the authoritative current status. For current status, use `docs/HANDOVER.md`, `docs/PROJECT-BACKGROUND-AND-ROADMAP.md`, `docs/TESTING.md`, and `docs/PHASE3-HANDOVER.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 2 end-to-end: SQLite-first storage, Phase 1 migration, one primary timeline per character, relationship memory, context assembly, memory UI, Herein character archives, and backup/restore.

**Architecture:** Electron main process owns SQLite and filesystem operations. React renderer accesses data through typed IPC clients and Zustand stores. Work proceeds in tested slices: data foundation first, then migration and timeline, then memory/context, then UI and import/export.

**Tech Stack:** Electron, React, TypeScript, Zustand, `better-sqlite3`, Vitest, React Testing Library, `adm-zip`.

---

## File Structure

### Test and Build

- Modify: `package.json`
  - Add test scripts.
  - Add `better-sqlite3`, `adm-zip`.
  - Add Vitest and testing dependencies.
- Create: `vitest.config.ts`
  - Use React plugin.
  - Default `jsdom` environment.
  - Allow per-file `@vitest-environment node` for SQLite tests.
- Create: `src/test/setup.ts`
  - Add jest-dom matchers if needed.

### Shared Phase 2 Types

- Create: `src/services/phase2/types.ts`
  - Define `Phase2AppSettings`, `CharacterProfile`, `RelationshipProfile`, `Timeline`, `TimelineMessage`, `ConversationSummary`, `MemoryItem`, `MemoryKind`, `MemoryScope`, `ContextAssembly`, `ArchiveManifest`, and IPC payload/result types.
- Create: `src/services/phase2/contextAssembly.ts`
  - Pure renderer-safe context assembly helpers.
- Test: `src/services/phase2/contextAssembly.test.ts`

### Electron SQLite Data Layer

- Create: `electron/data/schema.ts`
  - SQL schema and migrations.
- Create: `electron/data/database.ts`
  - Open database, apply PRAGMAs, run migrations, expose transaction helper.
- Create: `electron/data/repositories.ts`
  - Main-process repositories for settings, profiles, characters, timelines, messages, summaries, memories, assets, migration state.
- Create: `electron/data/migratePhase1.ts`
  - Read Phase 1 JSON and migrate idempotently.
- Create: `electron/data/archive.ts`
  - Backup/restore and Herein character archive helpers.
- Test:
  - `electron/data/database.test.ts`
  - `electron/data/repositories.test.ts`
  - `electron/data/migratePhase1.test.ts`
  - `electron/data/archive.test.ts`

### Electron IPC

- Modify: `electron/main.ts`
  - Register Phase 2 data handlers.
  - Keep legacy JSON handlers during migration.
- Modify: `electron/preload.ts`
  - Expose `window.electron.phase2`.
- Modify: `src/types/electron.d.ts`
  - Add typed `phase2` API.

### Renderer Data Clients

- Create: `src/services/phase2/client.ts`
  - Typed wrapper around `window.electron.phase2`.
  - Browser mode returns a clear unsupported-storage error for Phase 2 data.
- Modify: `src/services/apiProfiles.ts`
  - Use Phase 2 client when available, preserve legacy fallback only for pre-migration/browser-limited mode.
- Modify: `src/services/config/index.ts`
  - Use Phase 2 app settings when available.
- Modify: `src/services/chatHistory.ts`
  - Replace long-term JSON history access with timeline APIs.

### Stores and Chat Flow

- Modify: `src/stores/settings.ts`
  - Load profiles, settings, characters from Phase 2 APIs.
  - Store global memory settings.
- Modify: `src/stores/chat.ts`
  - Use primary timeline per character.
  - Persist messages through Phase 2 APIs.
  - Replace direct `buildCharacterSystemPrompt` with context assembly.
  - Trigger background summary/extraction after assistant replies.
- Modify: `src/services/character.ts`
  - Keep default character, but map it into `CharacterProfile`.
- Create: `src/services/phase2/memoryRunner.ts`
  - Internal structured prompt and validation for summary/extraction.
  - Summary/extraction prompt text is product code, not user settings.
- Test:
  - `src/services/phase2/memoryRunner.test.ts`
  - `src/stores/chat.phase2.test.ts` if store tests stay practical.

### UI

- Create: `src/components/Memory/MemoryPanel.tsx`
  - Chat-side current memory panel.
- Create: `src/components/Memory/MemorySettings.tsx`
  - Global memory settings.
- Modify: `src/components/Settings/SettingsPage.tsx`
  - Add Memory/Data sections.
- Modify: `src/components/Settings/CharacterSettings.tsx`
  - Upgrade character profile fields and import/export entry.
- Modify: `src/components/Chat/ChatWindow.tsx`
  - Add current memory panel entry.
  - Present characters as contacts, not as a role selector plus chat list.
  - Keep one primary chat per contact.
  - Open contact profile drawer from the avatar/name area.
- Modify: `src/components/Chat/MessageList.tsx`
  - Ensure long timeline rendering remains stable.
- Modify: `src/index.css`
  - Add restrained styles for memory panels and data controls.
- Test:
  - `src/components/Memory/MemoryPanel.test.tsx`
  - `src/components/Memory/MemorySettings.test.tsx`

### Docs

- Update: `docs/TESTING.md`
  - Mark implemented checks and commands.
- Update: `docs/HANDOVER.md`
  - Record final Phase 2 implementation notes after completion.

---

## Task 1: Testing Foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Install test and Phase 2 runtime dependencies**

Run:

```bash
npm install better-sqlite3 adm-zip
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @types/better-sqlite3 @types/adm-zip
```

Expected: dependencies install and `package-lock.json` updates.

- [ ] **Step 2: Add test scripts and Vitest config**

Add scripts:

```json
{
  "test": "vitest",
  "test:run": "vitest run"
}
```

Create `vitest.config.ts` with React plugin, alias `@`, setup file, and `jsdom` default environment.

- [ ] **Step 3: Run baseline test command**

Run:

```bash
npm run test:run
```

Expected before tests exist: Vitest reports no test files or exits cleanly after configuration. If it fails due config, fix config before Task 2.

---

## Task 2: SQLite Database Foundation

**Files:**
- Create: `electron/data/database.test.ts`
- Create: `electron/data/schema.ts`
- Create: `electron/data/database.ts`

- [ ] **Step 1: Write failing tests for database initialization**

Test behaviors:

- Opening a fresh database creates `schema_migrations`.
- PRAGMAs enable `foreign_keys` and `WAL`.
- Running migrations twice is idempotent.

Run:

```bash
npm run test:run -- electron/data/database.test.ts
```

Expected RED: import/module missing.

- [ ] **Step 2: Implement schema and database opener**

Implement:

- `CURRENT_SCHEMA_VERSION`.
- Ordered migration list.
- `openPhase2Database(dbPath: string)`.
- `withTransaction<T>(db, fn)`.
- `closePhase2Database(db)`.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
npm run test:run -- electron/data/database.test.ts
npm run electron:compile
```

Expected: tests pass and Electron TypeScript compiles.

---

## Task 3: Repository Layer

**Files:**
- Create: `electron/data/repositories.test.ts`
- Create: `electron/data/repositories.ts`

- [ ] **Step 1: Write failing repository tests**

Test behaviors:

- Upsert and read app settings.
- Create/list/update API profiles without plain key handling.
- Create default character profile.
- Ensure one primary timeline per character.
- Insert/list messages by timeline.
- Upsert summary by timeline.
- Create/edit/disable/pin/delete memory.
- Disabled memory is excluded from active memory queries.

Run:

```bash
npm run test:run -- electron/data/repositories.test.ts
```

Expected RED: repository module missing.

- [ ] **Step 2: Implement repositories**

Use explicit methods, not generic SQL escape hatches:

- `settings.get/set`.
- `apiProfiles.list/upsert/delete/get`.
- `characters.list/upsert/get/ensureDefault`.
- `timelines.getPrimaryForCharacter/ensurePrimary/archive`.
- `messages.append/listRecent/listPage/update/deleteAfter`.
- `summaries.getByTimeline/upsert`.
- `memories.listActive/listAll/create/update/disable/delete/pin`.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
npm run test:run -- electron/data/repositories.test.ts
npm run electron:compile
```

Expected: tests pass and Electron compiles.

---

## Task 4: Phase 1 JSON Migration

**Files:**
- Create: `electron/data/migratePhase1.test.ts`
- Create: `electron/data/migratePhase1.ts`

- [ ] **Step 1: Write failing migration tests**

Test behaviors:

- Migrates `config.json`, `api-profiles.json`, `chat-history.json`.
- Preserves existing encrypted API key payloads.
- Creates one primary timeline per character.
- Archives older same-character conversations.
- Running migration twice does not duplicate records.
- Copies legacy JSON files into a backup folder.

Run:

```bash
npm run test:run -- electron/data/migratePhase1.test.ts
```

Expected RED: migration module missing.

- [ ] **Step 2: Implement migration**

Implement idempotent migration keyed by stable ids from Phase 1 JSON. Preserve Date fields by normalizing to ISO strings.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
npm run test:run -- electron/data/migratePhase1.test.ts
npm run electron:compile
```

Expected: tests pass and Electron compiles.

---

## Task 5: IPC Data API

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Create: `src/services/phase2/client.test.ts`
- Create: `src/services/phase2/client.ts`

- [ ] **Step 1: Write failing client tests**

Test behaviors:

- Browser-only mode returns a clear unsupported-storage error.
- Electron mode forwards typed calls to `window.electron.phase2`.

Run:

```bash
npm run test:run -- src/services/phase2/client.test.ts
```

Expected RED: client module missing.

- [ ] **Step 2: Implement IPC handlers and preload API**

Expose narrow operations:

- `phase2:bootstrap`
- `phase2:settings:get/set`
- `phase2:profiles:list/upsert/delete`
- `phase2:characters:list/upsert`
- `phase2:timeline:getPrimary/listMessages/appendMessage/updateMessage/deleteAfter`
- `phase2:memory:list/create/update/delete`
- `phase2:summary:get/upsert`
- `phase2:backup:export/restore`
- `phase2:characterArchive:export/import`

- [ ] **Step 3: Verify GREEN**

Run:

```bash
npm run test:run -- src/services/phase2/client.test.ts
npm run electron:compile
npm run build
```

Expected: tests and builds pass.

---

## Task 6: Context Assembly And Memory Runner

**Files:**
- Create: `src/services/phase2/contextAssembly.test.ts`
- Create: `src/services/phase2/contextAssembly.ts`
- Create: `src/services/phase2/memoryRunner.test.ts`
- Create: `src/services/phase2/memoryRunner.ts`

- [ ] **Step 1: Write failing context assembly tests**

Test deterministic ordering:

- Character identity.
- Relationship profile.
- Global user facts.
- State memories.
- Preferences.
- Relationship memories.
- Event memories.
- Current summary.
- Recent messages are passed separately.

Run:

```bash
npm run test:run -- src/services/phase2/contextAssembly.test.ts
```

Expected RED: module missing.

- [ ] **Step 2: Implement context assembly**

Return both:

- `systemPrompt`.
- `explainableSections` for the UI label “下次回复会参考”.

- [ ] **Step 3: Write failing memory runner tests**

Test behaviors:

- Builds a summary/extraction prompt that demands JSON only.
- Includes message ids so extracted `sourceMessageIds` can be grounded.
- Parses valid JSON into summary and typed memory items.
- Rejects chat-like invalid output.
- Does not return usable result when schema is missing required fields.

- [ ] **Step 4: Implement memory runner**

Use the existing LLM service abstraction. Keep validation local and dependency-light.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm run test:run -- src/services/phase2/contextAssembly.test.ts src/services/phase2/memoryRunner.test.ts
npm run build
```

Expected: tests and build pass.

---

## Task 7: Renderer Store Integration

**Files:**
- Modify: `src/stores/settings.ts`
- Modify: `src/stores/chat.ts`
- Modify: `src/services/apiProfiles.ts`
- Modify: `src/services/config/index.ts`
- Modify: `src/services/chatHistory.ts`
- Modify: `src/services/character.ts`

- [ ] **Step 1: Add focused failing tests where practical**

Prefer pure-service tests over brittle Zustand integration tests:

- API profile persistence uses Phase 2 client when available.
- Chat request receives assembled context instead of direct character prompt.
- Memory trigger threshold checks after assistant response.

- [ ] **Step 2: Implement Phase 2-backed loading and persistence**

Keep legacy JSON fallback only for limited browser/pre-migration mode.

- [ ] **Step 3: Wire context assembly into chat replies**

Replace direct `buildCharacterSystemPrompt(character)` call with `assembleChatContext`.

- [ ] **Step 4: Trigger background memory summary after assistant replies**

Failed memory runs must not fail the user’s chat send.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test:run
npm run build
```

Expected: tests and build pass.

---

## Task 8: Memory And Settings UI

**Files:**
- Create: `src/components/Memory/MemoryPanel.test.tsx`
- Create: `src/components/Memory/MemoryPanel.tsx`
- Create: `src/components/Memory/MemorySettings.test.tsx`
- Create: `src/components/Memory/MemorySettings.tsx`
- Modify: `src/components/Chat/ChatWindow.tsx`
- Modify: `src/components/Settings/SettingsPage.tsx`
- Modify: `src/components/Settings/CharacterSettings.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Write failing UI tests**

Test behaviors:

- Memory panel renders current summary.
- Memory panel lists active memories by type.
- Disabled memories are visually excluded from next-context list.
- Manual memory form calls create handler.
- Memory settings can select follow-chat-model or a global profile.

- [ ] **Step 2: Implement MemoryPanel**

Use compact app-style controls, no nested cards, no debug jargon.

- [ ] **Step 3: Implement MemorySettings**

Expose memory enablement, global memory profile, and thresholds. Do not expose summary prompt or extraction prompt editors.

- [ ] **Step 4: Integrate UI**

Add chat-side entry and settings page section.

Chat shell requirements:

- The desktop sidebar label is “联系人”.
- Selecting a contact selects or creates that character's one primary conversation.
- The visible contact name is `contactRemark || character.name`.
- Contact remarks are local UI names only; they must not update `CharacterConfig.name` or enter prompt assembly.
- Contact profile drawer owns remark editing, avatar upload, character card settings entry, and clear-chat actions.
- The old always-visible role selector and left-bottom role card preview are removed from the main chat shell.

- [ ] **Step 5: Verify**

Run:

```bash
npm run test:run -- src/components/Memory/MemoryPanel.test.tsx src/components/Memory/MemorySettings.test.tsx
npm run build
```

Expected: tests and build pass.

---

## Task 9: Character Archives And Backup

**Files:**
- Create: `electron/data/archive.test.ts`
- Create: `electron/data/archive.ts`
- Modify: `electron/data/repositories.ts`
- Modify: `electron/main.ts`
- Modify: `src/services/phase2/client.ts`

- [ ] **Step 1: Write failing archive tests**

Test behaviors:

- Character profile export excludes private memories by default.
- Full character archive includes relationship state, memories, summaries, and main timeline.
- Backup zip includes `manifest.json`, `app.db`, and `assets/`.
- Backup excludes API keys by default.
- Restore validates manifest before replacing data.

- [ ] **Step 2: Implement archive helpers**

Use `adm-zip` for zip packaging. Use stable manifest fields:

- `format: "herein-backup"`
- `version`
- `schemaVersion`
- `exportedAt`
- `includesSecrets`

- [ ] **Step 3: Wire IPC and client methods**

Add export/import methods and minimal UI triggers if not already present.

- [ ] **Step 4: Verify**

Run:

```bash
npm run test:run -- electron/data/archive.test.ts
npm run electron:compile
npm run build
```

Expected: tests and build pass.

---

## Task 10: Final Verification And Documentation

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `docs/HANDOVER.md`
- Modify: `docs/local-data-and-secrets.md`

- [ ] **Step 1: Run full automated verification**

Run:

```bash
npm run test:run
npm run build
npm run electron:compile
```

Expected: all pass.

- [ ] **Step 2: Run Electron smoke test**

Run:

```bash
npm start
```

Expected:

- App opens.
- Phase 1 JSON migrates or a fresh `app.db` is created.
- API profile can be created and survives restart.
- A chat message can be sent.
- Memory panel opens.

- [ ] **Step 3: Update docs with final implementation notes**

Document:

- Actual database path.
- Actual backup format.
- Any intentionally limited browser behavior.
- Any deferred but non-blocking Phase 2 polish.

- [ ] **Step 4: Final stale-text and whitespace checks**

Run:

```bash
rg -n "<old current-roadmap phrases>" README.md README.zh-CN.md docs
git diff --check
```

Expected: no stale current-roadmap hits; `git diff --check` exits 0.

---

## Execution Note

The user explicitly asked Codex to split tasks and keep working until Phase 2 is implemented. Therefore execution will proceed inline in this session rather than pausing for an execution-mode choice.

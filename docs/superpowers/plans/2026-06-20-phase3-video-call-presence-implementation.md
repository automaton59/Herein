# Phase 3 Video Call Presence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build Phase 3A: an in-app video-call-style presence window with static character standing-art variants, subtitle output, mini window behavior, and one active call session tied to the current primary timeline.

**Architecture:** Keep the call as renderer state and UI, not a new persistent conversation model. Electron main owns asset import/storage and SQLite metadata; React renderer owns call session state, presentation selection, call window rendering, and integration with the existing chat send flow. Static expression assets are stored through the existing assets table with new metadata and are selected from the latest assistant emotion.

**Tech Stack:** Electron IPC, better-sqlite3 migrations, React, TypeScript, Zustand, Vitest, React Testing Library, lucide-react.

---

## File Structure

### Data And Types

- Modify: `electron/data/schema.ts`
  - Add migration version 2 with `assets.metadata_json`.
- Modify: `electron/data/repositories.ts`
  - Extend `AssetRecord` with `metadata`.
  - Add asset list/update/delete methods needed by the renderer.
- Modify: `src/services/phase2/types.ts`
  - Add presentation/call types: `PresentationEmotion`, `ExpressionAssetMetadata`, `CharacterPresentationProfile`, `CallViewMode`, `CallHost`, `CallSessionState`.
  - Extend `AssetRecord` with `metadata`.
  - Extend preload assets API with expression asset methods.
- Modify: `electron/main.ts`
  - Generalize avatar import into image asset import.
  - Add IPC handlers for expression import/list/update/delete.
- Modify: `electron/preload.ts`
  - Expose expression asset methods.
- Modify: `src/types/electron.d.ts`
  - Types flow through `Phase2PreloadAPI`.
- Modify: `src/services/phase2/client.ts`
  - Add typed renderer calls for expression assets.

### Presentation And Call State

- Create: `src/services/phase3/presentation.ts`
  - Pure helpers for emotion normalization, supported image validation, expression selection, and mode fallback.
- Test: `src/services/phase3/presentation.test.ts`
- Create: `src/stores/call.ts`
  - Zustand store for one active call session.
- Test: `src/stores/call.test.ts`

### UI

- Create: `src/components/Call/CallWindow.tsx`
  - Windowed call overlay with standing art, subtitle area, text input, minimize/close controls.
- Create: `src/components/Call/CallMiniWindow.tsx`
  - Mini floating call window.
- Create: `src/components/Call/CallLayer.tsx`
  - Chooses windowed vs mini rendering and wires store state to components.
- Test: `src/components/Call/CallLayer.test.tsx`
- Create: `src/components/Settings/CharacterAppearanceSettings.tsx`
  - Contact-profile appearance management: upload default/expression art, bind emotion, preview, delete.
- Test: `src/components/Settings/CharacterAppearanceSettings.test.tsx`
- Modify: `src/components/Chat/ChatWindow.tsx`
  - Add video button, call layer, appearance entry in contact profile, call minimization behavior on contact switch.
- Modify: `src/index.css`
  - Add call overlay/mini/subtitle responsive styles if Tailwind utility composition is not enough.

### Docs

- Update: `docs/TESTING.md`
  - Add Phase 3A manual smoke checklist.
- Update: `docs/HANDOVER.md`
  - Record implementation notes after completion.

---

## Task 1: Schema And Repository Support For Asset Metadata

**Files:**
- Modify: `electron/data/schema.ts`
- Modify: `electron/data/repositories.ts`
- Test: `electron/data/repositories.test.ts`

- [x] **Step 1: Add failing repository tests for asset metadata**

Append tests that create expression assets with metadata and list them by character/kind.

```ts
it('stores and lists expression asset metadata', () => {
  const repos = createPhase2Repositories(db);
  repos.characters.upsert({ id: 'char-1', name: '角色', description: '' });

  repos.assets.create({
    id: 'asset-happy',
    characterId: 'char-1',
    kind: 'expression',
    relativePath: 'assets/char-1/expression-happy.png',
    mimeType: 'image/png',
    label: '开心',
    metadata: { emotion: 'happy', expressionKey: 'happy-main', priority: 10 },
  });

  expect(repos.assets.list({ characterId: 'char-1', kind: 'expression' })).toEqual([
    expect.objectContaining({
      id: 'asset-happy',
      metadata: expect.objectContaining({ emotion: 'happy', priority: 10 }),
    }),
  ]);
});
```

- [x] **Step 2: Run the focused repository test**

Run:

```bash
npm run test:run -- electron/data/repositories.test.ts
```

Expected: fail because `metadata` and `assets.list` do not exist.

- [x] **Step 3: Add schema migration version 2**

In `electron/data/schema.ts`, set `CURRENT_SCHEMA_VERSION = 2` and append:

```ts
{
  version: 2,
  name: 'phase3_asset_metadata',
  sql: `
    alter table assets add column metadata_json text not null default '{}';
  `,
}
```

- [x] **Step 4: Extend repository asset mapping**

In `electron/data/repositories.ts`:

- Add `metadata?: Record<string, unknown>` to `AssetRecord`.
- Add `metadata_json` to the asset row mapping.
- Update `assets.create` to write `metadata_json`.
- Add `assets.list(filter)` and `assets.delete(id)`.

Use `parseJson<Record<string, unknown>>(row.metadata_json as string, {})`.

- [x] **Step 5: Verify repository tests**

Run:

```bash
npm run test:run -- electron/data/repositories.test.ts
npm run electron:compile
```

Expected: repository tests pass and Electron TypeScript compiles.

---

## Task 2: Expression Asset IPC And Client API

**Files:**
- Modify: `src/services/phase2/types.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/services/phase2/client.ts`
- Test: `src/services/phase2/client.test.ts`

- [x] **Step 1: Add failing client tests**

Extend the mocked `window.electron.phase2.assets` API with:

```ts
importExpression: vi.fn().mockResolvedValue({ assetId: 'asset-happy', relativePath: 'assets/char-1/expression-asset-happy.png' }),
list: vi.fn().mockResolvedValue([{ id: 'asset-happy', kind: 'expression', metadata: { emotion: 'happy' } }]),
update: vi.fn().mockResolvedValue(true),
delete: vi.fn().mockResolvedValue(true),
```

Assert:

```ts
await expect(client.assets.importExpression('char-1', file, { emotion: 'happy', label: '开心' }))
  .resolves.toEqual({ assetId: 'asset-happy', relativePath: 'assets/char-1/expression-asset-happy.png' });
await expect(client.assets.list({ characterId: 'char-1', kind: 'expression' }))
  .resolves.toHaveLength(1);
```

- [x] **Step 2: Run the focused client test**

Run:

```bash
npm run test:run -- src/services/phase2/client.test.ts
```

Expected: fail because expression asset methods are missing.

- [x] **Step 3: Extend shared Phase 2 types**

Add:

```ts
export type PresentationEmotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'shy' | 'excited' | 'worried';

export interface ExpressionAssetMetadata {
  expressionKey?: string;
  emotion?: PresentationEmotion;
  priority?: number;
}
```

Extend `AssetRecord`:

```ts
metadata?: Record<string, unknown>;
```

Extend `Phase2PreloadAPI.assets`:

```ts
importExpression: (
  characterId: string,
  file: unknown,
  metadata: ExpressionAssetMetadata & { label?: string },
) => Promise<ImportedAsset>;
list: (filter?: { characterId?: string; kind?: AssetRecord['kind'] }) => Promise<AssetRecord[]>;
update: (id: string, patch: Partial<AssetRecord>) => Promise<boolean>;
delete: (id: string) => Promise<boolean>;
```

- [x] **Step 4: Generalize image import in Electron main**

In `electron/main.ts`, add supported extension checks for `png/jpg/jpeg/webp`; keep gif accepted only for existing avatar upload if needed, but reject gif for expressions.

Implement:

```ts
async function importImageAsset(input: {
  characterId: string;
  sourcePath: string;
  kind: 'avatar' | 'expression';
  label: string;
  metadata?: Record<string, unknown>;
}) { /* copy file, create asset record, return { assetId, relativePath } */ }
```

Then keep `importAvatarAsset` as a wrapper and add `importExpressionAsset`.

- [x] **Step 5: Register IPC/preload/client methods**

Add IPC handlers:

- `phase2:assets:import-expression`
- `phase2:assets:list`
- `phase2:assets:update`
- `phase2:assets:delete`

Expose them in `electron/preload.ts` and forward through `src/services/phase2/client.ts`.

- [x] **Step 6: Verify IPC/client**

Run:

```bash
npm run test:run -- src/services/phase2/client.test.ts
npm run electron:compile
```

Expected: tests and compile pass.

---

## Task 3: Presentation Selection Helpers

**Files:**
- Create: `src/services/phase3/presentation.test.ts`
- Create: `src/services/phase3/presentation.ts`

- [x] **Step 1: Write failing pure tests**

Create tests for:

```ts
expect(resolveCallViewMode('fullscreen')).toBe('windowed');
expect(resolveCallViewMode('pip')).toBe('mini');
expect(normalizePresentationEmotion('unknown')).toBe('neutral');
expect(isSupportedStandingArtMime('image/gif')).toBe(false);
```

Add asset selection:

```ts
expect(selectExpressionAsset({
  emotion: 'happy',
  assets: [
    { id: 'neutral', kind: 'expression', relativePath: '', metadata: { emotion: 'neutral' } },
    { id: 'happy', kind: 'expression', relativePath: '', metadata: { emotion: 'happy' } },
  ],
})?.id).toBe('happy');
```

- [x] **Step 2: Run the failing test**

Run:

```bash
npm run test:run -- src/services/phase3/presentation.test.ts
```

Expected: fail because module does not exist.

- [x] **Step 3: Implement `presentation.ts`**

Export:

```ts
export const PRESENTATION_EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'shy', 'excited', 'worried'] as const;
export function normalizePresentationEmotion(value: unknown): PresentationEmotion;
export function resolveCallViewMode(mode: CallViewMode): 'windowed' | 'mini';
export function isSupportedStandingArtMime(mimeType: string): boolean;
export function selectExpressionAsset(input: { emotion?: string | null; assets: AssetRecord[]; fallbackAssetId?: string | null }): AssetRecord | null;
```

Selection order:

1. Exact emotion match with highest `metadata.priority`.
2. Neutral asset.
3. `fallbackAssetId`.
4. First expression asset.
5. `null`.

- [x] **Step 4: Verify presentation tests**

Run:

```bash
npm run test:run -- src/services/phase3/presentation.test.ts
```

Expected: tests pass.

---

## Task 4: Call Store

**Files:**
- Create: `src/stores/call.test.ts`
- Create: `src/stores/call.ts`

- [x] **Step 1: Write failing store tests**

Test one active call session:

```ts
useCallStore.getState().startCall({ characterId: 'char-a', timelineId: 'timeline-a' });
expect(useCallStore.getState().session?.mode).toBe('windowed');
useCallStore.getState().minimizeCall();
expect(useCallStore.getState().session?.mode).toBe('mini');
useCallStore.getState().endCall();
expect(useCallStore.getState().session).toBeNull();
```

Test second-call guard:

```ts
useCallStore.getState().startCall({ characterId: 'char-a', timelineId: 'timeline-a' });
expect(useCallStore.getState().canStartCall('char-b')).toEqual({
  ok: false,
  activeCharacterId: 'char-a',
});
```

- [x] **Step 2: Run the failing store test**

Run:

```bash
npm run test:run -- src/stores/call.test.ts
```

Expected: fail because store does not exist.

- [x] **Step 3: Implement `src/stores/call.ts`**

Use Zustand with:

```ts
interface CallStore {
  session: CallSessionState | null;
  startCall(input: { characterId: string; timelineId: string }): void;
  minimizeCall(): void;
  restoreCall(): void;
  endCall(): void;
  canStartCall(characterId: string): { ok: true } | { ok: false; activeCharacterId: string };
  setLastSubtitleMessageId(messageId: string | null): void;
}
```

Default `host` is `in-app`, default `mode` is `windowed`, and `startedAt` is `new Date().toISOString()`.

- [x] **Step 4: Verify call store tests**

Run:

```bash
npm run test:run -- src/stores/call.test.ts
```

Expected: tests pass.

---

## Task 5: Character Appearance Settings UI

**Files:**
- Create: `src/components/Settings/CharacterAppearanceSettings.test.tsx`
- Create: `src/components/Settings/CharacterAppearanceSettings.tsx`
- Modify: `src/components/Chat/ChatWindow.tsx`

- [x] **Step 1: Write failing UI tests**

Render `CharacterAppearanceSettings` with fake assets and callbacks. Assert:

- Shows upload controls for default standing art and emotion variants.
- Lists existing expression assets with emotion labels.
- Calls `onImportExpression(file, emotion)` when uploading.
- Calls `onDeleteAsset(assetId)` when deleting.

- [x] **Step 2: Run the failing UI test**

Run:

```bash
npm run test:run -- src/components/Settings/CharacterAppearanceSettings.test.tsx
```

Expected: fail because component does not exist.

- [x] **Step 3: Implement `CharacterAppearanceSettings.tsx`**

Props:

```ts
interface CharacterAppearanceSettingsProps {
  assets: AssetRecord[];
  assetDataUrls: Record<string, string>;
  onImportExpression: (file: File, emotion: PresentationEmotion, label: string) => Promise<void>;
  onDeleteAsset: (assetId: string) => Promise<void>;
}
```

UI requirements:

- Compact section suitable for contact profile drawer.
- Emotion options: neutral/happy/sad/angry/shy/excited/worried.
- Accept only `.png,.jpg,.jpeg,.webp`.
- No nested cards.
- Preview thumbnail uses `object-contain`.

- [x] **Step 4: Integrate into contact profile drawer**

In `ChatWindow.tsx`, add an “形象” section inside `ContactProfilePanel`. It should call Phase 2 client asset methods for the current character.

- [x] **Step 5: Verify UI test**

Run:

```bash
npm run test:run -- src/components/Settings/CharacterAppearanceSettings.test.tsx
```

Expected: tests pass.

---

## Task 6: Call Window Components

**Files:**
- Create: `src/components/Call/CallLayer.test.tsx`
- Create: `src/components/Call/CallWindow.tsx`
- Create: `src/components/Call/CallMiniWindow.tsx`
- Create: `src/components/Call/CallLayer.tsx`

- [x] **Step 1: Write failing component tests**

Test:

- `CallLayer` renders nothing without session.
- `windowed` session renders call dialog title and subtitle.
- `mini` session renders mini window.
- Minimize button calls `minimizeCall`.
- Mini click calls restore callback.

- [x] **Step 2: Run failing test**

Run:

```bash
npm run test:run -- src/components/Call/CallLayer.test.tsx
```

Expected: fail because call components do not exist.

- [x] **Step 3: Implement call components**

`CallWindow` props:

```ts
interface CallWindowProps {
  displayName: string;
  statusLabel: string;
  elapsedLabel: string;
  imageSrc?: string;
  subtitle?: string;
  isLoading: boolean;
  onSend: (content: string) => void;
  onMinimize: () => void;
  onClose: () => void;
}
```

Layout:

- Fixed centered overlay.
- Top call bar with display name, status, elapsed time, minimize and close buttons.
- Main standing-art area using `object-contain`.
- Bottom subtitle area, scrollable when long.
- Bottom input form reusing chat send behavior.

`CallMiniWindow` props:

```ts
interface CallMiniWindowProps {
  displayName: string;
  imageSrc?: string;
  subtitle?: string;
  onRestore: () => void;
  onClose: () => void;
}
```

- [x] **Step 4: Implement `CallLayer` data binding**

`CallLayer` receives current character/conversation data from `ChatWindow`, expression assets, data URLs, latest assistant subtitle, and store callbacks.

- [x] **Step 5: Verify component tests**

Run:

```bash
npm run test:run -- src/components/Call/CallLayer.test.tsx
```

Expected: tests pass.

---

## Task 7: Chat Integration And One Active Call Behavior

**Files:**
- Modify: `src/components/Chat/ChatWindow.tsx`
- Test: `src/components/Chat/ChatWindow.test.tsx`

- [x] **Step 1: Add failing ChatWindow tests**

Cover:

- Video button starts call for current contact.
- Switching contacts while call is windowed minimizes the active call.
- Clicking mini restores original contact and call.
- Starting call on B while A call exists shows confirmation instead of switching silently.

- [x] **Step 2: Run failing ChatWindow tests**

Run:

```bash
npm run test:run -- src/components/Chat/ChatWindow.test.tsx
```

Expected: fail until integration exists.

- [x] **Step 3: Add video call button**

In chat top bar, add a lucide video icon button next to memory. It calls `startCall` for the current character/timeline. If `canStartCall` returns another active character, open a small confirmation dialog.

- [x] **Step 4: Minimize on contact switch**

In `selectContact`, if call store has a `windowed` active session for another character, call `minimizeCall()` before switching.

- [x] **Step 5: Restore from mini**

When mini is clicked:

- Select the call session character's conversation.
- Restore call mode to `windowed`.

- [x] **Step 6: Reuse send flow**

Call window input should call the existing `sendMessage`. Because call is always tied to the current character when windowed, restoring from mini must switch back before sending.

- [x] **Step 7: Verify ChatWindow tests**

Run:

```bash
npm run test:run -- src/components/Chat/ChatWindow.test.tsx
```

Expected: tests pass.

---

## Task 8: End-To-End Verification And Docs

**Files:**
- Modify: `docs/TESTING.md`
- Modify: `docs/HANDOVER.md`

- [x] **Step 1: Run focused automated tests**

Run:

```bash
npm run test:run -- src/services/phase3/presentation.test.ts src/stores/call.test.ts src/components/Call/CallLayer.test.tsx src/components/Settings/CharacterAppearanceSettings.test.tsx src/components/Chat/ChatWindow.test.tsx src/services/phase2/client.test.ts electron/data/repositories.test.ts
```

Expected: all focused tests pass.

- [x] **Step 2: Run compile/build checks**

Run:

```bash
npm run build
npm run electron:compile
```

Expected: both exit 0.

- [x] **Step 3: Run Electron smoke**

Run:

```bash
npm start
```

Manual expected:

- App opens.
- Upload neutral/happy/worried standing art from contact profile.
- Start video call from chat top bar.
- Send text in call window.
- Assistant response appears as subtitle.
- Standing art changes by emotion when an asset exists.
- Switch to another contact; active call becomes mini.
- Try starting second call; confirmation requires ending current call first.

- [x] **Step 4: Update docs**

Update `docs/TESTING.md` with the smoke checklist above and `docs/HANDOVER.md` with actual implemented Phase 3A notes.

- [x] **Step 5: Final consistency checks**

Run:

```bash
powershell -Command "$patterns = @('AL' + '-1S', 'al' + '-1s', 'D:\\' + 'AL' + '-1S', 'D:/' + 'AL' + '-1S'); foreach ($pattern in $patterns) { rg -n --fixed-strings $pattern README.md README.zh-CN.md docs src electron }"
git diff --check
```

Expected: no stale project/path hits and no whitespace errors.

---

## Self-Review Checklist

- Spec coverage:
  - In-app call host: Tasks 4, 6, 7.
  - `windowed`/`mini` implemented and `fullscreen`/`pip` fallback: Tasks 3, 4, 6.
  - Static standing-art variants and asset metadata: Tasks 1, 2, 3, 5.
  - Subtitle output: Tasks 6, 7.
  - One active call and second-call confirmation: Tasks 4, 7.
  - Contact switch auto-mini and mini restore: Tasks 4, 7.
  - No persistent call state: Task 4.
  - Verification: Task 8.
- Placeholder scan: no unresolved placeholder markers are intended in this plan.
- Type consistency: use `PresentationEmotion`, `CallViewMode`, `CallHost`, `CallSessionState`, and `AssetRecord.metadata` consistently across tasks.

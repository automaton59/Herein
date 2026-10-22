# Phase 3B Presentation Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build Phase 3B presentation profiles so static expression assets have editable default/fallback/emotion mappings that persist through SQLite, IPC, UI, call rendering, and character archives.

**Architecture:** Add a small `character_presentation_profiles` table and repository, expose it through the existing Phase 2 Electron IPC surface, and let React keep a per-character profile map. `selectExpressionAsset` remains the pure presentation boundary and receives an optional profile, so later Live2D or video renderers can reuse the same display intent.

**Tech Stack:** Electron IPC, better-sqlite3 migrations, React, TypeScript, Zustand, Vitest, React Testing Library.

---

## File Structure

### Data And API

- Modify: `electron/data/schema.ts`
  - Add schema version 3 and `character_presentation_profiles`.
- Modify: `electron/data/repositories.ts`
  - Add `CharacterPresentationProfileRecord` and `presentationProfiles.get/upsert`.
- Modify: `electron/data/archive.ts`
  - Include profile in character archive payload and remap asset ids on import.
- Modify: `electron/main.ts`
  - Add `phase2:presentation:get-profile` and `phase2:presentation:upsert-profile` IPC handlers.
- Modify: `electron/preload.ts`
  - Expose presentation profile methods.
- Modify: `src/services/phase2/types.ts`
  - Extend `CharacterPresentationProfile` and `Phase2PreloadAPI`.
- Modify: `src/services/phase2/client.ts`
  - Forward presentation profile calls.

### Presentation And UI

- Modify: `src/services/phase3/presentation.ts`
  - Add profile-aware expression selection.
- Modify: `src/components/Settings/CharacterAppearanceSettings.tsx`
  - Add default/fallback controls and per-asset metadata editing.
- Modify: `src/components/Call/CallLayer.tsx`
  - Receive presentation profiles and pass the active profile to the selector.
- Modify: `src/components/Chat/ChatWindow.tsx`
  - Load/save presentation profiles and wire settings/call layer.

### Tests And Docs

- Modify: `electron/data/repositories.test.ts`
- Modify: `electron/data/archive.test.ts`
- Modify: `src/services/phase2/client.test.ts`
- Modify: `src/services/phase3/presentation.test.ts`
- Modify: `src/components/Settings/CharacterAppearanceSettings.test.tsx`
- Modify: `src/components/Call/CallLayer.test.tsx`
- Modify: `docs/TESTING.md`
- Modify: `docs/HANDOVER.md`

---

## Task 1: Presentation Profile Persistence

- [x] Write failing repository tests for profile get/upsert and default values.
- [x] Run `npm run test:run -- electron/data/repositories.test.ts` and confirm the new tests fail because the table/repository do not exist.
- [x] Add schema version 3 with `character_presentation_profiles`.
- [x] Add repository mapping and `presentationProfiles.get/upsert`.
- [x] Run `npm run test:run -- electron/data/repositories.test.ts`.

## Task 2: IPC And Client API

- [x] Write failing client tests for `client.presentation.getProfile` and `client.presentation.upsertProfile`.
- [x] Run `npm run test:run -- src/services/phase2/client.test.ts` and confirm the new tests fail.
- [x] Extend shared types, preload, main IPC handlers, and renderer client.
- [x] Run `npm run test:run -- src/services/phase2/client.test.ts` and `npm run electron:compile`.

## Task 3: Profile-Aware Selection

- [x] Write failing `selectExpressionAsset` tests for explicit emotion maps, fallback emotion, default asset, and missing referenced assets.
- [x] Run `npm run test:run -- src/services/phase3/presentation.test.ts` and confirm the new tests fail.
- [x] Extend selector implementation with the Phase 3B order from the design doc.
- [x] Run `npm run test:run -- src/services/phase3/presentation.test.ts`.

## Task 4: Appearance Settings UI

- [x] Write failing component tests for saving default asset, fallback emotion, and per-asset label/emotion/priority changes.
- [x] Run `npm run test:run -- src/components/Settings/CharacterAppearanceSettings.test.tsx` and confirm failure.
- [x] Extend `CharacterAppearanceSettings` props and UI.
- [x] Run `npm run test:run -- src/components/Settings/CharacterAppearanceSettings.test.tsx`.

## Task 5: Chat And Call Integration

- [x] Write failing CallLayer tests proving profile explicit mapping wins over automatic priority.
- [x] Run `npm run test:run -- src/components/Call/CallLayer.test.tsx` and confirm failure.
- [x] Load profiles in `ChatWindow`, save updates through the client, and pass profiles into `CallLayer`.
- [x] Run `npm run test:run -- src/components/Call/CallLayer.test.tsx src/components/Chat/ChatWindow.test.tsx`.

## Task 6: Character Archive Support

- [x] Write failing archive tests for exporting/importing a presentation profile with remapped expression asset ids.
- [x] Run `npm run test:run -- electron/data/archive.test.ts` and confirm failure.
- [x] Add profile payload export/import and asset id remapping.
- [x] Run `npm run test:run -- electron/data/archive.test.ts`.

## Task 7: Verification And Docs

- [x] Update `docs/TESTING.md` with Phase 3B automated and smoke coverage.
- [x] Update `docs/HANDOVER.md` with Phase 3B status and remaining Phase 3C/3D work.
- [x] Run focused tests:

```bash
npm run test:run -- electron/data/repositories.test.ts electron/data/archive.test.ts src/services/phase2/client.test.ts src/services/phase3/presentation.test.ts src/components/Settings/CharacterAppearanceSettings.test.tsx src/components/Call/CallLayer.test.tsx src/components/Chat/ChatWindow.test.tsx
```

- [x] Run full verification:

```bash
npm run test:run
npm run build
npm run electron:compile
git diff --check
```

- [x] Run startup smoke with `npm start`, verify Vite and Electron launch, then clean up and rerun `npm run test:run` to restore the Node ABI.

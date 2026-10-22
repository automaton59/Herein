# Phase 3C Dynamic Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Phase 3C dynamic avatar support with video-loop rendering, Live2D package import metadata, profile persistence, and static fallback.

**Architecture:** Keep presentation selection pure in `src/services/phase3/presentation.ts`. Electron imports and stores dynamic assets through the existing assets table. React settings manage profile preferences, while `CallLayer` chooses a dynamic source and `CallWindow` renders video sources or a Live2D adapter placeholder.

**Tech Stack:** Electron IPC, better-sqlite3 migrations, React, TypeScript, Vitest, React Testing Library.

---

## File Structure

- Modify: `electron/data/schema.ts`
- Modify: `electron/data/repositories.ts`
- Modify: `electron/data/archive.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/services/phase2/types.ts`
- Modify: `src/services/phase2/client.ts`
- Modify: `src/services/phase3/presentation.ts`
- Modify: `src/components/Settings/CharacterAppearanceSettings.tsx`
- Modify: `src/components/Call/CallWindow.tsx`
- Modify: `src/components/Call/CallMiniWindow.tsx`
- Modify: `src/components/Call/CallLayer.tsx`
- Modify: `src/components/Chat/ChatWindow.tsx`
- Update tests next to those files.
- Update: `docs/TESTING.md`
- Update: `docs/HANDOVER.md`

## Task 1: Profile Fields

- [x] Write failing repository tests for `dynamicAssetId` and `preferredRenderer`.
- [x] Add schema v4 migration.
- [x] Extend repository mapping and profile upsert.
- [x] Run `npm run test:run -- electron/data/repositories.test.ts`.

## Task 2: Dynamic Asset IPC

- [x] Write failing client tests for `importVideo` and `importLive2D`.
- [x] Add shared types and preload/main handlers.
- [x] Implement video file copy and Live2D directory copy.
- [x] Run `npm run test:run -- src/services/phase2/client.test.ts` and `npm run electron:compile`.

## Task 3: Dynamic Source Selection

- [x] Write failing presentation tests for video/live2d/static fallback selection.
- [x] Implement `selectDynamicAvatarSource`.
- [x] Run `npm run test:run -- src/services/phase3/presentation.test.ts`.

## Task 4: Call Rendering

- [x] Write failing CallWindow/CallLayer tests for video rendering and Live2D adapter placeholder.
- [x] Add `dynamicSource` props and rendering.
- [x] Run `npm run test:run -- src/components/Call/CallLayer.test.tsx`.

## Task 5: Appearance UI And Chat Integration

- [x] Write failing settings tests for dynamic asset controls.
- [x] Add upload/select/delete controls for video/live2d assets.
- [x] Load dynamic asset data URLs in ChatWindow and update profiles.
- [x] Run `npm run test:run -- src/components/Settings/CharacterAppearanceSettings.test.tsx src/components/Chat/ChatWindow.test.tsx`.

## Task 6: Archive And Docs

- [x] Extend archive tests for dynamic profile id remapping.
- [x] Update archive import/export if needed.
- [x] Update `docs/TESTING.md` and `docs/HANDOVER.md`.
- [x] Run focused and full verification:

```bash
npm run test:run -- electron/data/repositories.test.ts electron/data/archive.test.ts src/services/phase2/client.test.ts src/services/phase3/presentation.test.ts src/components/Settings/CharacterAppearanceSettings.test.tsx src/components/Call/CallLayer.test.tsx src/components/Chat/ChatWindow.test.tsx
npm run test:run
npm run build
npm run electron:compile
git diff --check
```

# Testing Guide

## Automated Verification

Current Phase 2/3 verification commands:

```bash
npm run test:run
npm run build
npm run electron:compile
```

Native module note: `npm run test:run` rebuilds `better-sqlite3` for Node before Vitest, while `npm start` rebuilds it for Electron before launching the app. If a command reports `NODE_MODULE_VERSION` mismatch, run the command that matches the target runtime again instead of treating it as an application bug.

Current automated coverage includes:

- SQLite schema initialization, WAL, foreign keys, migrations.
- Repository behavior for settings, API profiles, characters, primary timelines, messages, summaries, memories, and clear-timeline.
- Phase 1 JSON migration into SQLite.
- Phase 2 preload client behavior and browser/Electron split.
- Renderer service mapping for characters, timelines, messages, config, API profiles, and chat history.
- Context assembly and memory runner validation.
- Chat memory trigger and summary/memory writeback.
- Memory panel, memory settings, data backup UI, and character archive controls.
- Backup and character archive zip helpers.
- Phase 3A presentation helpers, expression asset metadata, call store, call layer, appearance settings, and video-call entry behavior.
- Phase 3B presentation profiles, editable expression asset metadata, profile-aware call art selection, and character archive profile remapping.
- Phase 3C dynamic avatar support: video/live2d import APIs, dynamic source selection, call-window video rendering, Live2D adapter fallback, appearance controls, ChatWindow data loading, and archive remapping for dynamic profile references.
- Phase 3D local voice support: system TTS capability detection, subtitle speech playback, optional ASR transcript-to-draft, and call-window voice controls.

## Manual Regression

Run these before release or before large behavior changes.

### Electron Startup

- [ ] Run `npm install`.
- [ ] Run `npm run build`.
- [ ] Run `npm run electron:compile`.
- [ ] Run `npm start`.
- [ ] Electron window opens.
- [ ] App starts without console errors that break normal use.

### API Profiles

- [ ] Create a new API profile.
- [ ] Select provider: OpenAI, DeepSeek, or Custom.
- [ ] Enter API key.
- [ ] Enter model name.
- [ ] For DeepSeek/Custom, enter base URL.
- [ ] Save profile.
- [ ] Test connection.
- [ ] Fetch models if the provider supports it.
- [ ] Restart Electron and confirm profile still loads.
- [ ] Confirm API key is not stored as plain text in normal config.

### Chat Functionality

- [ ] Send a simple message.
- [ ] Verify typing state appears.
- [ ] Verify assistant response appears as a complete message.
- [ ] Verify reasoning/thinking text is not shown in the main chat.
- [ ] Verify emotion tag is removed from message body and saved as metadata when present.
- [ ] Retract a pending user message and confirm request aborts.
- [ ] Edit a user message.
- [ ] Regenerate from a user message.
- [ ] Regenerate from an assistant message.
- [ ] Delete a message and all following messages.

### Characters And Primary Timeline

- [ ] Create a character.
- [ ] Switch contacts from the left contact list.
- [ ] Confirm each character opens one primary timeline.
- [ ] Confirm the UI does not create parallel chats for the same character.
- [ ] Clear a main chat and confirm it remains empty after restart.

### Theme And UI

- [ ] Switch `system`, `light`, and `dark`.
- [ ] Confirm Electron native theme follows app setting.
- [ ] Check custom select menus in light and dark mode.
- [ ] Check narrow window layout for obvious overlap.

### Phase 3A Video Call Presence

- [ ] Open a contact profile and upload neutral/happy/worried standing art.
- [ ] Confirm standing art accepts `png`, `jpg`, `jpeg`, and `webp`; do not rely on animated gif support.
- [ ] Start a video call from the chat top bar.
- [ ] Send text in the call window and confirm the message appears in the main chat timeline.
- [ ] Confirm the assistant reply appears as the call subtitle.
- [ ] Confirm the standing art changes according to assistant `emotion` when a matching asset exists.
- [ ] Minimize to the mini window, then restore the call.
- [ ] Switch to another contact and confirm the active call becomes mini instead of switching silently.
- [ ] Try starting a second contact call and confirm the app requires ending the current call first.
- [ ] Check light, dark, and narrow windows for overlap, broken images, or layout jumps.

### Phase 3B Presentation Profiles

- [ ] In the contact profile, choose a default standing art asset.
- [ ] Change fallback emotion and confirm missing emotion assets fall back through that emotion.
- [ ] Edit a standing art label, emotion, and priority; confirm the list updates after saving.
- [ ] Bind a specific asset to an emotion and confirm the call window uses that asset even if another asset has higher priority.
- [ ] Delete an asset referenced by the profile and confirm the call window falls back without a broken image.
- [ ] Export a full character archive, import it into an app that already has the same character/asset ids, and confirm presentation profile references point to the imported assets.

### Phase 3C Dynamic Avatars

- [ ] Upload a short `mp4` or `webm` loop from the contact profile.
- [ ] Select it as the dynamic avatar and set renderer preference to `video`.
- [ ] Start a video call and confirm the call window renders the loop instead of the static standing art.
- [ ] Switch renderer preference to `static` and confirm the call window falls back to standing art or avatar.
- [ ] Import a Live2D `.model3.json` entry and confirm the asset appears in the dynamic avatar list.
- [ ] Select the Live2D asset and confirm the call window shows the Live2D adapter placeholder with a static fallback image.
- [ ] Delete a selected dynamic asset and confirm the profile reference is cleared and no broken media appears.
- [ ] Export a full character archive with video/live2d assets, import it into an app with colliding ids, and confirm `dynamicAssetId` points to the imported dynamic asset.

### Phase 3D Local Voice

- [ ] Start a video call with an assistant subtitle visible.
- [ ] Click the speaker button and confirm the current subtitle is read through the system voice if the runtime supports TTS.
- [ ] Click stop and confirm current speech stops.
- [ ] Enable auto-read, send a new message, and confirm the next assistant subtitle is read automatically.
- [ ] If the runtime supports speech recognition, click the microphone button and confirm the transcript fills the call input.
- [ ] Send the transcript from the call input and confirm the message appears in the same primary timeline.
- [ ] If TTS or ASR is unavailable, confirm the relevant button is disabled and normal text input still works.

## Phase 2 Release Verification

Before treating a Phase 2 build as release-ready, run or confirm these checks.

### SQLite Data Foundation

- [ ] Fresh Electron launch creates a valid `app.db`.
- [ ] SQLite enables `WAL`.
- [ ] SQLite enables `foreign_keys`.
- [ ] Migrations run once and record their version.
- [ ] Renderer cannot open the database directly; data access goes through IPC.
- [ ] Browser-only mode either remains intentionally limited or clearly explains that Electron is required.

### Phase 1 Migration

- [ ] `config.json` migrates into SQLite.
- [ ] `api-profiles.json` migrates into SQLite.
- [ ] `chat-history.json` migrates into SQLite.
- [ ] Encrypted API keys survive migration and restart.
- [ ] Old JSON files are preserved as backup.
- [ ] Failed migration can be retried without duplicating data.

### Main Timeline

- [ ] Each character gets one primary timeline.
- [ ] Existing same-character conversations migrate into main timeline plus archive according to the migration rule.
- [ ] Archived conversations remain viewable.
- [ ] Archived conversations do not silently affect current context.

### Memory And Summary

- [ ] Automatic summary triggers after configured threshold.
- [ ] Summary update does not block normal chatting.
- [ ] Bad structured output does not overwrite the previous good summary.
- [ ] Structured memory extraction records source message ids or source time.
- [ ] Manual memory can be created.
- [ ] Manual memory can be edited, disabled, pinned, and deleted.
- [ ] Disabled memory is not included in context assembly.
- [ ] State memory supports current value and historical note.
- [ ] Event memory remains on the timeline and is not overwritten by state updates.

### Context Assembly

- [ ] Context includes character identity.
- [ ] Context includes relationship profile.
- [ ] Context includes relevant global user profile facts.
- [ ] Context includes selected memories by type.
- [ ] Context includes current timeline summary.
- [ ] Context includes recent messages.
- [ ] User can inspect "next reply will reference" content.

### Character Archive And Backup

- [ ] Character profile export excludes private relationship memory by default.
- [ ] Full character archive includes profile, assets, relationship state, memories, summaries, and main timeline.
- [ ] Full character archive preserves expression, video, and Live2D package assets and remaps presentation profile asset references after import.
- [ ] Full backup zip includes `manifest.json`, `app.db`, and `assets/`.
- [ ] Backup excludes API keys by default.
- [ ] Restore creates a current-data snapshot before replacement.
- [ ] Restore rolls back cleanly if validation fails.

## Current Implementation Notes

- The actual database path is `%APPDATA%\herein\data\app.db`.
- Phase 1 JSON files are copied under `phase1-json-backup/<timestamp>/` during migration.
- Full backups use `format: "herein-backup"` in `manifest.json`.
- Character archives use `format: "herein-character-archive"` and support `profile` and `full` modes.
- Browser-only mode is intentionally limited for Phase 2 storage; use Electron for real data.
- Phase 3A through 3D now have automated coverage for static standing-art presence, profile-based asset selection, video-loop dynamic avatars, Live2D import metadata, adapter fallback, and local system voice controls. A real Live2D renderer, cloud voice providers, system-level PIP, and Electron independent call windows remain future enhancements.

## Historical Notes

Older test notes and self-check findings may mention browser localStorage, unbounded in-memory chat, or Phase 2 as a generic memory system. Treat those as historical Phase 1 references. Current Phase 2 direction is defined by:

- `docs/PROJECT-BACKGROUND-AND-ROADMAP.md`
- `docs/HANDOVER.md`
- `docs/superpowers/specs/2026-06-19-phase2-personality-relationship-memory-assets-design.md`
- `docs/PHASE3-HANDOVER.md`

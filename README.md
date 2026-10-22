# Herein

Herein is a local-first private IM companion app built with React, TypeScript, and Electron. Its Chinese product name is 此间.

The project is not a roleplay workbench or a SillyTavern clone. The goal is to make opening the app feel like opening a familiar private chat: contacts, messages, local history, stable personality, relationship continuity, and user-controlled memory.

## Current Status

Phase 2 is now at basic wrap-up. The core product loop is implemented; the remaining Phase 2 work is release-style verification, Electron smoke testing, and packaging polish. The app currently supports:

- Electron + Vite development flow.
- OpenAI-compatible API profiles.
- Encrypted API keys in Electron through `safeStorage`, stored in SQLite.
- SQLite-first local data through Electron IPC.
- Phase 1 JSON migration into `app.db`.
- Multi-character chat with one primary timeline per character.
- Message edit, regenerate, retract, and delete-after flows.
- Hidden reasoning/thinking blocks in the main chat.
- Emotion tags parsed as metadata instead of visible text.
- Context assembly from character profile, conversation summary, and active memories.
- Background conversation summary and structured memory extraction.
- A chat-side memory panel and global memory settings.
- Herein character archive export/import.
- Full backup/restore zip with manifest, `app.db`, and assets.
- Light, dark, and system themes.

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
npm install
```

### Run The Electron App

```bash
npm start
```

This is the recommended development and usage path.

### Build Checks

```bash
npm run build
npm run electron:compile
```

`npm run dev` can still start the Vite browser server for limited frontend work, but Phase 2 storage is Electron-first SQLite and browser-only mode is not a full product target.

## Configuration

In the app settings:

1. Create an API profile.
2. Choose an OpenAI-compatible provider.
3. Enter the API key, model, and base URL if needed.
4. Test the connection.
5. Start chatting.

API profiles are provider-neutral. OpenAI, DeepSeek, OpenRouter, AnyRouter, OpenCode, or other OpenAI-compatible endpoints should be handled through profiles and adapters rather than hard-coded UI logic.

## Data And Privacy

Electron data lives under:

```text
%APPDATA%\herein\data\
```

Current long-term data:

- `app.db`
- `assets/`
- `backups/`
- `exports/`

Phase 1 JSON files (`config.json`, `chat-history.json`, `api-profiles.json`) are migration inputs and preserved backups. API keys are encrypted with Electron `safeStorage` when available; full backups exclude API key ciphertext by default.

See [docs/local-data-and-secrets.md](docs/local-data-and-secrets.md) for details.

## Phase 2 Implementation

Phase 2 is implemented around these decisions:

- SQLite-first, Electron-first data foundation using `better-sqlite3`.
- One character maps to one primary chat timeline by default.
- Characters behave like contacts, not branching scenario saves.
- Conversation summaries handle long dialogue continuity.
- Structured memories capture important facts, preferences, state changes, and shared events.
- Memory changes are automatic and visible, not interruptive confirmation popups.
- Users can view, edit, disable, pin, and manually add memories.
- A global memory/summarization API profile can be selected, defaulting to the active chat model.
- Chat, summary, and extraction prompts are internal product logic, not user-editable settings.
- Herein internal character profile import/export is in scope.
- Full backup/restore exports a zip with `manifest.json`, `app.db`, and `assets/`.
- SillyTavern compatibility is not a Phase 2 product goal.

Read the full Phase 2 design:

- [Phase 2 Design](docs/superpowers/specs/2026-06-19-phase2-personality-relationship-memory-assets-design.md)
- [Project Background And Roadmap](docs/PROJECT-BACKGROUND-AND-ROADMAP.md)
- [Handover](docs/HANDOVER.md)
- [Phase 3 Handover](docs/PHASE3-HANDOVER.md)

## Project Structure

```text
electron/
  main.ts
  preload.ts
src/
  components/
    Chat/
    Memory/
    Settings/
  services/
    phase2/
    llm/
    storage/
    config/
  stores/
docs/
```

## Roadmap

- **Phase 1:** Private IM MVP, complete.
- **Phase 2:** Personality, relationship, memory, character assets, SQLite data foundation, basic wrap-up.
- **Phase 3:** Character presence and video-chat direction: presentation state, expression assets, Live2D or equivalent, richer status, optional voice.
- **Phase 4+:** Packaging, mobile evaluation, controlled proactive chat, tools, sync/backup options, plugins if justified.

## License

MIT

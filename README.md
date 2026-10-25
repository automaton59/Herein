# Herein

A local-first private companion app for the desktop. Electron + React + TypeScript, with everything stored on your machine.

It is not a roleplay workbench, and not a lighter SillyTavern. Opening it should feel like opening a familiar presence: one character fixed by a private persona pack, a Live2D figure already on your desktop, and a private conversation that remembers what came before.

---

## What it solves

General-purpose chat resets every turn. Herein makes three things durable state instead:

- **Personality is equipment, not a prompt.** A persona pack defines identity, voice, boundaries and relationship frame, compiled into the system prompt at startup. There is no character picker in the chat.
- **Memory is a data structure, not concatenated history.** Messages, summaries and structured memory are stored in layers and recalled under a token budget. You can inspect, edit, disable and pin each memory.
- **Presence is the default, not a toggle.** The desktop figure lives independently of the chat window. Close the main window and it stays; the tray hosts the Core.

## Capabilities

### Conversation

One fixed character, streamed output. Edit-and-resend, regenerate, retract, delete-and-retry. `thinking` blocks are collapsed rather than shown. Emotion tags are parsed as metadata instead of visible text — they drive the avatar's expression and the voice's tone without leaking into the transcript.

### Memory

Three layers:

| Layer | Content |
|---|---|
| Messages | Raw turns, editable and regenerable |
| Summaries | Rolling narrative versions generated in the background |
| Memory items | Extracted preferences, facts, state changes, shared experiences — with provenance and confidence |

Recall packs sections under a token budget instead of dumping history into context. The memory panel lets you inspect, edit, disable, pin and add items by hand.

### Desktop presence

A transparent Live2D window (Cubism 2 and 4), independent of the main window. Always-on-top optional, draggable, position remembered. Expressions follow conversation emotion; lipsync follows voice amplitude. Hiding the main window to the tray keeps the figure online.

### Voice

Local TTS (Qwen3 family) and ASR run as separate service processes and need your own model weights. A dedicated interaction runtime handles voice conversation and shares the same timeline as text chat.

### Proactive messages

Not scheduled pushes. The initiative layer reads current relationship state, unresolved topics and recent affect, decides whether this is a moment to speak, then says it in the character's own voice — proactive messages and replies share one persona.

### Plugins

Plugins are capability extensions, not script injection. Each declares its `kind`, `permissions` (network hosts, credentials, send, install, filesystem) and a `configSchema`; the settings UI generates the form, validates fields and reports health from that declaration.

| Plugin | Kind | Notes |
|---|---|---|
| Weather | tool | Open-Meteo, no key required |
| Stickers | tool | Picks from local emotion-keyed packs |
| Bilibili | source | Live/dynamic content as context material |
| NetEase | source | Read-only: search, lyrics, public playlists |
| QQ Bot | channel | Direct messages and group @-mentions |
| DSH | agent | Bridges DeepSeek Harness |

All configured by hand, with no model guessing at settings. Per-plugin fields and verification steps: [docs/PLUGIN-SETUP.md](docs/PLUGIN-SETUP.md).

### Multi-device

Desktop is the primary form. The embedded Core is a standalone HTTP service (`npm run core:serve` runs it alone); the Android client reaches it over LAN with token auth. Android is experimental.

## Architecture

```text
┌─ Electron main ──────────────────────────────────┐
│  windows / tray / desktop figure / IPC / singleton│
│  ┌─ embedded Core (HTTP + SSE) ────────────────┐  │
│  │  turn orchestration · context assembly      │  │
│  │  memory read/write · initiative             │  │
│  │  plugin registry · asset routing · secrets  │  │
│  └─────────────────────────────────────────────┘  │
│  adapters (Bilibili / NetEase / QQ / DSH, dynamic) │
└───────────────────────────────────────────────────┘
                    ↕ IPC
┌─ Renderer (React + Zustand + Tailwind) ───────────┐
│  chat · memory panel · settings · system · figure  │
└───────────────────────────────────────────────────┘
```

`src/` cannot import `electron/` internals — only the IPC contract exposed by preload. `npm run check:core` enforces that boundary.

Core is a separate layer because it has to be reusable by the phone, by a second process, and by any future shell, instead of being welded to a BrowserWindow.

## Getting Started

### Prerequisites

Node.js 22+. **Electron is pinned at 42.4.0** — do not upgrade. Newer versions ship no prebuilt `better-sqlite3` binary.

### Install

```bash
npm install
```

`postinstall` rebuilds `better-sqlite3` against Electron's ABI.

### Prepare the private layer

You need to create this yourself. The repository holds the engine, not the persona: `private/` is git-ignored on purpose, because a persona pack, Live2D assets and credentials are personal content rather than source code.

```bash
cp -r examples/persona-minimal private/persona/my-companion
# edit manifest.json and character.json so both `id` fields match
npm run check:persona
```

Without a pack the app refuses to start rather than silently falling back to a built-in character — that is deliberate.

API keys, QQ Bot credentials and the sync server config go in `private/credentials/`. Templates live in [`examples/credentials/`](examples/README.md). The persona pack contract is in [docs/PERSONA.md](docs/PERSONA.md).

### Run

```bash
npm start
```

First launch lands on settings; create an OpenAI-compatible API profile before chatting.

### Build

```bash
npm run build                # boundary check + contrast check + tsc + vite build
npm run electron:compile     # compile the main process
npm run electron:build:dir   # unpacked directory, output to ../Herein-Releases
```

## Data And Privacy

Data lives under `%APPDATA%\herein\data\`:

```text
app.db          # SQLite: messages, memory, relationships, plugin registry
assets/         # imported character assets and sticker packs
backups/        # full backups
exports/        # character archive exports
```

- API keys are encrypted with Electron `safeStorage` before hitting the database — never plaintext on disk.
- Full backups exclude key ciphertext by default.
- Every network request goes through the profile you configured; the project reports nothing on its own.
- Details: [docs/local-data-and-secrets.md](docs/local-data-and-secrets.md).

## Docs

**Using it**

- [Persona pack contract](docs/PERSONA.md) — how a character is defined, which variables exist
- [Plugin setup](docs/PLUGIN-SETUP.md) — per-plugin fields, commands, verification, troubleshooting
- [Testing](docs/TESTING.md)
- [Data and secrets](docs/local-data-and-secrets.md)
- [Example templates](examples/README.md)

**Design**

- [Background and roadmap](docs/PROJECT-BACKGROUND-AND-ROADMAP.md)
- [Architecture and core decisions](docs/HANDOVER.md)
- [Desktop presence](docs/DESKTOP-PRESENCE.md)
- [Live2D](docs/LIVE2D.md)
- [Plugin system](docs/PLUGINS.md)
- [Proactive messages](docs/INITIATIVE.md)
- [TTS](docs/TTS.md) · [Local voice](docs/LOCAL-VOICE.md) · [Interaction port](docs/INTERACTION-PORT.md)

**Other**

- [Contributing](CONTRIBUTING.md)
- [Internal notes](docs/internal/README.md) — phase progress and self-checks, will go stale

## License

MIT, see [LICENSE](LICENSE).

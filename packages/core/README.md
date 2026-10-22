# @herein/core

Public core contracts for Herein. This package is intended to stay open
(MIT/Apache-2.0); the private character packs, prompts, assets and platform
credentials live outside it.

## Boundary

Allowed:

- `node:` built-ins and other public packages.
- Relative imports inside `packages/core/src`.

Forbidden:

- `src/` (the legacy desktop app).
- `apps/` (private clients).
- `adapters/` (platform-specific implementations).
- `private/` (persona, prompts, assets, credentials).
- `electron/` (desktop shell).

Run the boundary check from the repository root:

```bash
npm run check:core
npm run build:core
```

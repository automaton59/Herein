# Weather plugin

First native plugin used to validate the plugin host end-to-end.

- Manifest: `plugin.json`
- Entry: `index.mjs`
- Provider: Open-Meteo (no API key)
- Permissions: `api.open-meteo.com`, `geocoding-api.open-meteo.com`
- Config: `city` or `latitude`/`longitude`, optional `locationName`, `refreshMinutes` (default 15)
- Action: `current`

Example config:

```json
{
  "city": "杭州",
  "refreshMinutes": 15
}
```

The plugin caches the last successful current-weather response for `refreshMinutes`. It reports `degraded` until configured, and `failed` after a network or provider error. It never receives credentials or database access.

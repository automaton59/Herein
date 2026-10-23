# 2026-10-23：三项补丁已应用

以下补丁已按顺序应用到 `apps/interaction` 源码：

1. `sapi-progress/workers.patch`
2. `profile-isolation/main.patch`
3. `stream-failure/failure.patch`

新 buildId：

```text
94cde9da19f4f9df7ffcc9e47d6b4c4dcee8d937940a1fa091dd4c9e3f7b98ca
```

验证结果：

- `tests/*.test.mjs`：27/27
- `sapi-progress/regression.mjs`：4/4
- `stream-failure/regression.mjs`：4/4
- `build.mjs --out-dir tmp/interaction-final-dist`：通过
- `npm run check:core`：10 files 边界通过

保留这些 patch 目录作为历史证据，但不要再重复应用。旧长测属于旧 build，不能替代新 build 的验收。

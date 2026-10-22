# 本地数据与 API Key 安全说明

此间（Herein）的运行数据不会放在仓库目录里。Electron 版本会写入 Electron 的 `userData` 目录：

```text
%APPDATA%\herein\data\
```

## 当前数据底座

Phase 2 已引入 SQLite-first、Electron-first 数据底座：

- `app.db` 是长期主数据源。
- SQLite 只由 Electron main process 打开，renderer 通过受控 IPC 访问。
- 已开启 `WAL` 和 `foreign_keys`。
- schema migrations 记录在 `schema_migrations`。
- API profiles、普通设置、角色、主时间线、消息、会话总结、结构化记忆、记忆任务日志、资产索引进入 SQLite。
- API key 仍使用 Electron `safeStorage` 加密，密文保存在 SQLite 的 API profile 记录中。
- 浏览器模式不再承担完整产品目标；Phase 2 storage 不可用时会提示使用 Electron。

Phase 1 JSON 文件现在是迁移输入和保留备份：

- `config.json`：角色、当前角色、当前 API profile id、主题等应用配置。
- `chat-history.json`：会话和消息记录。
- `api-profiles.json`：API profile。API key 使用 Electron `safeStorage` 加密后以 base64 保存。

首次 Phase 2 启动会迁移这些 JSON 数据到 SQLite，并把旧 JSON 复制到 `phase1-json-backup/<timestamp>/`。

资产文件不应塞进数据库。头像、表情、Live2D、备份包等大文件应保存在文件系统，SQLite 保存稳定引用和 metadata。

## 备份原则

当前全量备份导出 zip 包：

- `manifest.json`
- `app.db`
- `assets/`

默认备份会在临时数据库副本中清空 API key 密文字段。只有用户明确选择“包含 API Key 密文”时才会保留凭据，并且 `safeStorage` 密文可能无法跨机器或跨系统用户解密。

## Git 忽略与提交检查

仓库已在 `.gitignore` 里兜底忽略：

- `data/`
- `secrets/`
- `*.local.json`
- `api-profiles*.json`
- `config.local.json`
- `chat-history.local.json`
- `*.db`
- `*.db-wal`
- `*.db-shm`
- `*.sqlite`
- `*.sqlite3`
- `assets/`
- `backups/`
- `exports/`
- `restore-snapshots/`

提交前仍建议搜索一次自己的 Key 前缀，确认没有把真实 API key 写进源码、文档或测试文件。

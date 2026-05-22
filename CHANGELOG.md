# Changelog

## v0.15.0 (2026-05-22)

### ✨ New
- `/diagnose` 诊断命令：检查 OpenCode/七牛云/Telegram/飞书 配置状态
- `/z` `/expert` 专家评审模式：引用 AGENTS.md 流程，支持自定义 prompt
- `/edit` 编辑消息命令（跨平台）
- `/upload` `/delete` 文件存储命令（七牛云，跨平台）

### 🔧 Changed
- README 命令表同步到 21 个命令
- `sendMessage` 修复：补充 `onTextDelta` 回调，空响应 bug 根因
- `/z` 默认 prompt 改为引用 AGENTS.md，不再硬编码 14 角色
- qiniu 从 weixin/ 迁到 core/，跨平台可用
- memory 系统删除（flush.js / memory-manager.js / init-memory.js）

### 🐛 Fixed
- `sendMessage` limit 10 → 50，减少漏消息概率
- idle 超时从 5s 提到 30s（普通）/ 120s（专家模式）
- 超时/空响应错误提示区分（`race: idle` vs `race: task`）

### 🏗️ Architecture
- cli.js 1018 行拆分为 cli.js(140) + setup.js(330) + bot-runner.js(230)
- feishu/bot.js 拆分为 adapter/commands/handler/bot 4 模块
- 命令数从 32 精简到 21（删除 ls/cat/tree/compact/flush/scope/analyze 等）

---

## v0.14.0 (2026-05-21)

### ✨ New
- 统一命令路由层 core/router.js（三平台共享 COMMAND_ALIASES）
- 飞书补齐 29 个命令 + forwardToOpenCode + tool 跟踪
- Telegram 基础命令 + agent 转发
- 单元测试框架（10 个测试）
- 两阶段 lint（syntax + import 解析）

### 🔧 Changed
- weixin/bot.js 1928 行拆分为 adapter/commands/handler/bot 4 模块
- CLI 名称统一：openchat → opencode-remote
- 七牛云凭据从硬编码改为环境变量
- 配置读取统一为 core/config.js

### 🐛 Fixed
- 空 catch 块清理（多处）
- git.js 注入风险修复
- 中英文错误提示统一

---

## v0.13.0 (2026-04-11)

初始版本。

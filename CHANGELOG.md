# Changelog

## v0.16.2 (2026-05-29)

### 🐛 Fixed
- oc/cx/copilot 指令统一修复错误捕获：所有 agent 非零退出时从 stdout+stderr 提取真实错误，过滤 libuv 崩溃噪音

---

## v0.16.1 (2026-05-29)

### 🐛 Fixed
- cc 指令错误捕获：过滤 libuv 崩溃噪音（Assertion failed/UV_HANDLE_CLOSING），从 stdout 和 stderr 中提取实际 API 错误（如 400 Bad Request）

---

## v0.16.0 (2026-05-23)

### ✨ New
- `/tutorial` 交互式教程命令：8 步引导新用户完成"安装→发送第一条消息→专家评审"的完整工作流
- Telegram inline keyboard 支持：`/help` 和 `/start` 后展示命令按钮，手机端一键触达
- AI 任务完成通知：长任务完成后推送耗时统计（专家评审、AI 对话等）
- `/demo` 沙箱模式：所有命令返回模拟输出，无需配置 OpenCode 即可体验全部功能
- Docker 镜像 + docker-compose.yml：一键部署到服务器，不绑定本地终端
- CI/CD 流水线（GitHub Actions）：lint → test → Docker 构建发布

### 📦 Infra
- Dockerfile (node:20-alpine) + docker-compose.yml + .dockerignore
- .github/workflows/ci.yml：push/PR 自动 lint+test，tag 自动构建 Docker 镜像

### 🏗️ Architecture
- router.js 新增 TUTORIAL_STEPS + getTutorialText() 教程引擎
- router.js 新增 DEMO_RESPONSES 模拟响应表 + 线程级沙箱状态管理
- telegram/adapter.js 新增 sendCommandMenu() inline keyboard 生成器
- notifications.js 新增 formatTaskCompletion() 任务完成通知模板

---

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

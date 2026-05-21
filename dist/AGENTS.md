# 项目开发指南 (AGENTS.md)

> **记忆系统**: 每次会话必须加载 @MEMORY.md 获取项目记忆、技术决策和历史教训。

---

## 技术栈
- **运行环境**: Node.js (CommonJS)
- **核心功能**: 远程控制 OpenCode CLI, 记忆持久化层
- **集成平台**: 微信 (WeChat), 飞书 (Feishu), Telegram

## 关键命令
- **启动**: `npm start` (根据 package.json 确定)
- **部署**: 部署至 `node_modules/opencode-remote-control/dist`

## 核心逻辑与规范
1. **记忆存储**: 所有用户偏好和项目知识必须存储在 `~/.opencode-remote/memory/` (JSON 格式)，严禁存储在代码目录内。
2. **注入机制**: 采用“拦截 -> 检索 -> 注入”流程，在转发指令给 OpenCode 前，由 `memory-manager.js` 检索相关记忆并静默注入 System Prompt。
3. **代码风格**: 保持 CommonJS 风格，禁止在 dist 目录下创建临时测试文件。
4. **纯净度**: 保持 `dist` 目录仅包含生产代码、必要配置文件及 `.md` 指南。

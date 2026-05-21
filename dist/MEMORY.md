# MEMORY.md — 项目记忆

## 核心决策
- **记忆架构**: 采用全自动记忆层，存储路径统一为 `~/.opencode-remote/memory/`。
- **注入流程**: 在 `bot.js` 的 `forwardToOpenCode` 阶段通过 `memory-manager.js` 自动检索并注入上下文。
- **数据格式**: 采用 JSON 格式存储 `user_preferences.json` 和 `project_knowledge.json`。

## 经验教训
- [2026-04-11] 避免在 `dist` 目录下创建临时测试文件或实验性目录（如 `openchat`），确保生产环境纯净。
- [2026-04-11] 记忆存储必须与代码目录分离，防止更新部署时数据丢失。

## 主题文件路由表
| 触发词 | 文件 | 说明 |
|--------|------|------|
| 记忆存储 | `.opencode-remote/memory/*.json` | 用户偏好与项目知识库 |
| 注入逻辑 | `dist/weixin/bot.js` | 指令拦截与 Prompt 注入实现 |
| 记忆管理 | `dist/weixin/memory-manager.js` | JSON 持久化读写逻辑 |

## 待办/开放线程
- [ ] 实现自动反思机制 (Reflection Loop)：任务完成后自动提取规律并写入记忆。
- [ ] 优化 Token 截断与内存压缩逻辑。

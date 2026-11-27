# AGENTS

项目结构与实现见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 技术栈与构建

- **架构**：Vite 6 + React 19 + TypeScript + Tailwind CSS v4 + `@base-ui/react`（coss ui 风格原语），多入口构建（`newtab.html`、`popup.html`、`options.html`）输出至 `dist/`。
- **扩展加载目录**：Edge / Chrome 开发者模式下加载 `dist/` 目录。

## 底线

- **隐私与权限**：默认完全离线，不读取浏览历史。`optional_host_permissions` 仅声明 `https://api.deepseek.com/*`，只在用户显式开启 DeepSeek AI 助手时按需申请并发送当前书签标题、网址与目录名。禁止私自新增其他网络权限或未声明的第三方请求。
- **数据安全**：仅在用户主动操作时修改或删除书签；删除与 AI 批量重命名均须提供显式二次确认 / 对比勾选；禁止使用 `dangerouslySetInnerHTML` 或 `innerHTML` 拼接用户数据。

## 校验

```powershell
# 类型检查与生产构建
npm run build

# 运行分类器与无损导入导出单测
npm test
```

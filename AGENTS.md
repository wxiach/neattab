# AGENTS

规范来源优先级：`docs/PRD.md` > `docs/TDD.md` > `docs/DEVELOPMENT.md`。冲突时先同步文档或确认。

## 硬约束

1. **离线**：禁止 `fetch`、`XMLHttpRequest`、远程脚本/字体/图标、读取浏览历史。
2. **权限**：限定 `bookmarks`、`storage`、`favicon`、`activeTab`、`fontSettings`。
3. **显式写入**：仅在用户显式编辑、拖拽或确认保存时写入书签；删除须二次确认。
4. **安全 DOM**：仅用 `createElement` + `textContent`，禁止 `innerHTML` 拼接用户数据。
5. **样式边界**：色值/阴影引自 `styles/tokens.css`；主题仅走 `dataset.theme`；字号 `≥ 11px`。
6. **无构建**：保持原生 HTML / CSS / 经典 `<script>`（`window.NAV`），同时兼容扩展页与 `file://` 预览。

## 需先确认的变更

- 增减浏览器权限或引入网络请求
- 引入框架、构建链或第三方运行时依赖
- 变更核心信息架构（视图形态、目录深度、核心入口）

## 验收

修改代码后须通过 `node --check js/*.js sw.js` 并更新 `preview/stub-*.html`；未实测项不得声明完成。

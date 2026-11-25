# neattab · 开发与发布

## 1. 编码红线

- **CSS**：色值/阴影/圆角引用 `styles/tokens.css`；通用控件放 `styles/controls.css`；禁止 `@media (prefers-color-scheme)`；字号 `≥ 11px`。
- **JS**：每个文件包在 `'use strict'; (() => { ... })();`；DOM 仅用 `createElement` + `textContent`，禁止 `innerHTML`；所有 `chrome.*` / `localStorage` 调用须 `try/catch` 降级。
- **HTML**：可点击元素仅用 `<button>` 或 `<a>`；纯图标按钮须有 `aria-label` 与 `title`；图标统一内联 Phosphor SVG（`viewBox="0 0 256 256"`）。

## 2. 常用命令

```powershell
# JS 语法检查
Get-ChildItem js\*.js, sw.js | ForEach-Object { node --check $_.FullName }

# 生成离线预览（preview/stub-newtab.html、preview/stub-options.html）
python tools/make_preview.py

# 从本机 Edge 书签重新导出样例（preview/tree.js）
python tools/make_fixture.py
```

## 3. 版本号规范（SemVer）

版本唯一来源为 `manifest.json` 的 `version`（`X.Y.Z`）：

| 段 | 递增条件 | 示例 |
|---|---|---|
| `0.x.y` | 初版打磨阶段（当前 `0.1.0`） | `0.1.0` |
| `Z`（修订） | 修 Bug、样式微调、重构、改文档 | `0.1.0 → 0.1.1` |
| `Y`（次版本） | 新增功能或新增权限 | `0.1.0 → 0.2.0` |
| `X`（主版本） | 首个正式稳定版（`1.0.0`）或不兼容重构 | `0.x → 1.0.0` |

同一轮开发微调不递增版本号，仅在发版或里程碑时更新一次并记入 [CHANGELOG.md](./CHANGELOG.md)。

## 4. 发布检查

- **发布包含**：`manifest.json`、`sw.js`、`*.html`、`styles/`、`js/`、`icons/`。
- **发布排除**：`docs/`、`tools/`、`preview/`。
- **验证项**：`node --check` 全部通过；扩展管理页重载生效；浅/深切换无闪烁、字体搜索浮层对齐、阅读清单排序、工具栏弹窗分类与窄屏（960 / 720）无横向滚动。

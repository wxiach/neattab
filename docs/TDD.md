# neattab · 技术设计（TDD）

## 1. 运行形态与权限

- **清单**：Manifest V3，`minimum_chrome_version: 110`。
- **入口**：`newtab.html`（新标签页）、`popup.html`（工具栏弹窗）、`options.html`（扩展选项）、`sw.js`（安装钩子）。
- **权限**：`bookmarks`、`storage`、`favicon`、`activeTab`、`fontSettings`。无主机权限、无内容脚本、无网络请求。

## 2. 模块边界

| 路径 | 职责 |
|---|---|
| `styles/tokens.css` | 设计变量、主题色板、基础重置、`.theme-switching` 防闪烁 |
| `styles/controls.css` | 跨页共享控件（按钮、下拉、分段、悬浮字体选择器） |
| `styles/{newtab,options,popup}.css` | 各页面布局与响应式样式 |
| `js/shared.js` | 跨页工具、主题/字体缓存与原子切换、图标兜底、目录树工具、`createFontPicker` |
| `js/newtab-edit.js` | 右键菜单、模态框、书签 CRUD 与拖拽状态 |
| `js/newtab-settings.js` | 主页居中设置弹窗控制器 |
| `js/newtab.js` | 单一状态 `state`、`computeView()` 视图派生、DOM 渲染、键盘导航、事件订阅 |
| `js/options.js` | 独立设置页控制器 |
| `js/classifier.js` | 纯函数：URL 解析、锚点检测、站点/内容页识别、本地分类模型 |
| `js/popup.js` | 工具栏收藏弹窗交互、原子建组与纠错样本写入 |

模块间通过全局命名空间 `window.NAV` 通信，不使用 ESM，保证扩展页与 `file://` 离线预览一致运行。

## 3. 存储定义

| 存储 | 键 | 类型 | 说明 |
|---|---|---|---|
| `chrome.storage.local` | `rootId` | `string` | 数据源目录 ID（默认 `"1"`） |
| `chrome.storage.local` | `openMode` | `'same' \| 'tab'` | 默认打开方式 |
| `chrome.storage.local` | `theme` | `'auto' \| 'light' \| 'dark'` | 主题模式 |
| `chrome.storage.local` | `font` | `string` | `'system'` 或 `'sys:<fontId>'` |
| `chrome.storage.local` | `view` / `expanded` | `object / string[]` | 视图与展开记忆 |
| `chrome.storage.local` | `favorites` | `string[]` | 星标书签 ID（最新在前） |
| `chrome.storage.local` | `lastFolderId` | `string` | 弹窗最近保存目录 |
| `chrome.storage.local` | `mlFeedback` | `object[]` | 最近 200 条收藏与纠错样本 |
| `localStorage` | `nav_theme` / `nav_font` | `string` | 首帧同步外观缓存 |

## 4. 核心机制

- **防闪烁**：首帧同步读取 `localStorage` 套用外观；切换主题时临时挂载 `:root.theme-switching` 禁过渡并强制同步重排，实现单帧变色。
- **零叠线网格**：`.grid` 使用 `gap: 0; margin-right: -1px; margin-bottom: -1px`，由外层 `.sheet { border: 1px solid var(--line); overflow: hidden }` 裁切外缘多余边线。
- **本地分类器（`js/classifier.js`）**：以本地书签、分组标题原型及 `mlFeedback`（纠错加权）实时训练 TF-IDF 加权朴素贝叶斯 + 余弦相似度混合模型，输出 Softmax 置信度与 Top-3 候选。
- **DOM 渲染**：全量 `replaceChildren` 更新；书签变更事件 150ms 防抖；500 条内无需虚拟滚动。

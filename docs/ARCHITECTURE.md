# 设计说明

## 1. 目录结构

无构建、不使用 ESM，所有脚本以经典 `<script>` 加载并通过全局 `window.NAV` 通信，确保扩展页与 `file://` 离线预览行为一致。

```text
neattab/
├── manifest.json
├── sw.js                  # 后台安装钩子
├── newtab.html
├── popup.html
├── options.html
├── icons/
├── styles/
│   ├── tokens.css         # 色值、阴影、圆角（0px）与切主题防闪烁规则
│   ├── controls.css       # 跨页复用控件与悬浮字体选择器
│   ├── newtab.css
│   ├── options.css
│   └── popup.css
├── js/
│   ├── shared.js          # 跨页工具、图标兜底、主题/字体缓存与切换
│   ├── newtab.js          # 状态管理、视图派生、渲染、键盘导航与书签监听
│   ├── newtab-edit.js     # 右键菜单、编辑弹窗与拖拽排序
│   ├── newtab-settings.js
│   ├── options.js
│   ├── classifier.js      # 纯函数本地分类器（URL 识别与分组打分）
│   └── popup.js
├── preview/               # 脱离扩展环境的离线预览页与模拟数据
└── tools/
    └── make_preview.py    # 从 newtab.html / options.html 生成 preview/stub-*.html
```

## 2. 本地存储字段

默认存于 `chrome.storage.local`：

| 键名 | 说明 |
|---|---|
| `rootId` | 数据源目录 ID，默认 `"1"`（收藏夹栏） |
| `openMode` | 打开方式：`'same'` 或 `'tab'` |
| `theme` | `'auto'` / `'light'` / `'dark'` |
| `font` | `'system'` 或 `'sys:<字体名>'` |
| `view` / `expanded` | 上次选中的分组与侧栏展开状态 |
| `favorites` | 「我的收藏」书签 ID 列表（最新在前） |
| `lastFolderId` | 工具栏弹窗上次保存的目标目录 ID |
| `mlFeedback` | 分类样本与纠错记录（最多保留最近 200 条） |

另在 `localStorage` 存 `nav_theme`、`nav_font`，供首帧同步恢复外观。

## 3. 关键实现

- **数据流与渲染**（`js/newtab.js`）：按 `getTree() → buildRoot() → computeView() → render()` 单向派生视图；`render()` 用 `replaceChildren()` 整块更新 DOM，外部书签变更经 150ms 防抖后重新拉取。
- **首帧防闪烁**（`js/shared.js`）：首帧同步读 `localStorage` 避免等异步存储闪白；切换主题时临时给 `<html>` 挂 `.theme-switching` 禁过渡并触发同步重排，使全页在同一帧变色。
- **本地分组推荐**（`js/classifier.js`）：结合已有书签的标题、域名、目录名及历史纠错样本（`mlFeedback` 加权），用 TF-IDF 朴素贝叶斯与余弦相似度混合打分，输出前 3 个候选分组。

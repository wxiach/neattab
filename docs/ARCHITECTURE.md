# 设计说明

## 1. 目录结构

无构建，脚本直接通过 `<script>` 加载并挂载在 `window.NAV` 上，以兼容 `file://` 离线预览。

```text
neattab/
├── manifest.json
├── sw.js                  # 后台安装钩子
├── newtab.html
├── popup.html
├── options.html
├── icons/
├── styles/
│   ├── tokens.css         # 颜色、阴影、圆角（0px）与切主题防闪烁
│   ├── controls.css       # 跨页共用控件与字体选择器
│   ├── newtab.css
│   ├── options.css
│   └── popup.css
├── js/
│   ├── shared.js          # 公共工具、图标兜底与外观切换
│   ├── transfer.js        # 书签 JSON 导入导出与顺序保真写回
│   ├── newtab.js          # 状态管理、视图计算、渲染与键盘导航
│   ├── newtab-edit.js     # 编辑对话框、拖拽排序与删除区域
│   ├── newtab-settings.js
│   ├── options.js
│   ├── classifier.js      # 本地分类器（URL 识别与分组打分）
│   └── popup.js
├── preview/               # 离线预览页与模拟数据
└── tools/
    └── make_preview.py    # 根据 HTML 生成 preview/stub-*.html
```

## 2. 本地存储字段

存于 `chrome.storage.local`：

| 键名 | 说明 |
|---|---|
| `rootId` | 数据源目录 ID，默认 `"1"`（收藏夹栏） |
| `openMode` | 点击书签的打开方式：`'tab'`（默认）或 `'same'` |
| `theme` | 外观主题：`'auto'` / `'light'` / `'dark'` |
| `font` | 字体：`'system'` 或 `'sys:<字体名>'` |
| `view` / `expanded` | 上次选中的分组与侧栏展开状态 |
| `favorites` | 「我的收藏」中的书签 ID（最新在前） |
| `lastFolderId` | 工具栏弹窗上次保存的目标目录 ID |
| `mlFeedback` | 分类与纠错样本（最多保留最近 200 条） |

另外在 `localStorage` 中缓存 `nav_theme` 和 `nav_font`，用于首帧同步恢复外观。

## 3. 关键实现

- **数据流与多级目录**（`js/newtab.js`）：按 `getTree() → buildRoot() → computeView() → render()` 单向派生视图；`render()` 通过 `replaceChildren()` 整块更新 DOM，外部书签变更经 150ms 防抖后重新拉取，并在 `onRemoved` 时同步清理失效星标。左侧目录树最多展示到二级，三级分类直接在二级视图内按分段平铺展示，支持拖拽排序、跨组移动、右键直出编辑框与左下角浮动删除区。
- **首帧防闪烁与虚拟滚动字体**（`js/shared.js`）：首帧同步读取 `localStorage` 恢复外观，切主题时通过 `.theme-switching` 禁用过渡并同步重排消除闪烁；本机字体选择器采用固定行高（`32px`）虚拟滚动，仅渲染可视区域节点以避免大量系统字体造成主线程卡顿。
- **本地分组推荐与标题精简**（`js/classifier.js`）：结合多级目录名、书签标题、域名特征及历史纠错样本（`mlFeedback` 加权），使用 TF-IDF 朴素贝叶斯与余弦相似度混合打分返回前 3 候选分组；收藏时同步执行本地标题清洗（`cleanTitle`），并在弹窗内提供一键还原原标题。
- **无损保序导入导出**（`js/transfer.js`）：导出精简多级 JSON；替换导入前自动下载备份，采用临时目录三阶段构建并按 URL 复用原书签节点移动以保留 `dateAdded`、顺序与星标，同时保全非 `http/https` 书签节点不被误删。

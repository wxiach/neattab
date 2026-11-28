# 设计说明

## 1. 目录结构

采用 **Vite + React 19 + TypeScript + Tailwind CSS v4 + `@base-ui/react`（coss ui 风格）** 多入口打包，产物输出到 `dist/` 供浏览器加载：

```text
neattab/
├── package.json
├── tsconfig.json
├── vite.config.ts               # 多入口构建：newtab / popup / options -> dist/
├── newtab.html                  # 新标签页入口（含同步 boot.js 主题/字体防闪烁）
├── popup.html                   # 工具栏快捷收藏入口
├── options.html                 # 独立系统设置页入口
├── public/
│   ├── manifest.json            # MV3 清单（含可选权限 https://api.deepseek.com/*）
│   ├── sw.js                    # 后台安装钩子
│   ├── boot.js                  # 首帧同步恢复主题与系统字体缓存
│   └── icons/
├── src/
│   ├── styles/
│   │   └── globals.css          # Tailwind v4 + coss ui 浅/深色板 + 2K/4K 响应式变量
│   ├── lib/
│   │   ├── cn.ts
│   │   ├── types.ts             # 共享类型定义
│   │   ├── storage.ts           # chrome.storage.local 读写与主题/字体应用
│   │   ├── bookmarks.ts         # 目录树构建、阅读清单分段与拖拽移动
│   │   ├── favSync.ts           # 基于收藏夹栏根目录书签副本的跨设备「我的收藏」机制
│   │   ├── classifier.ts        # 本地 TF-IDF 朴素贝叶斯分类器与标题精简
│   │   ├── transfer.ts          # 无损保序书签 JSON 导入导出
│   │   ├── pageContext.ts       # 通过 activeTab + scripting 提取当前页摘要（meta/h1/正文片段）
│   │   └── ai.ts                # DeepSeek 单页推荐（含新建分类）、批量重命名归类与全局目录体检
│   ├── components/
│   │   ├── ui/                  # 基于 @base-ui/react 与 CVA 的 coss ui 原语
│   │   ├── Favicon.tsx
│   │   ├── FontPicker.tsx       # 32px 固定行高虚拟滚动系统字体选择器
│   │   ├── ImportDialog.tsx
│   │   ├── SettingsContent.tsx  # 4 分类系统设置（外观与常规 / AI 助手 / 数据与备份 / 关于与权限）
│   │   └── BatchRenameDialog.tsx# AI 智能整理弹窗（书签整理 + 全局目录体检，执行前自动备份）
│   └── pages/
│       ├── newtab/              # 新标签页应用
│       ├── popup/               # 快捷收藏弹窗（本地兜底 + DeepSeek 异步优化）
│       └── options/             # 独立系统设置页
└── tests/
    └── run-tests.ts             # 分类器与导入导出单元测试
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
| `favorites` | 旧版遗留字段（首次加载自动迁移复制到收藏夹栏根目录后清空） |
| `lastFolderId` | 工具栏弹窗上次保存的目标目录 ID |
| `mlFeedback` | 分类与纠错样本（最多保留最近 200 条） |
| `ai` | DeepSeek 配置：`{ enabled, apiKey, model }`（默认关闭） |

另外在 `localStorage` 中缓存 `nav_theme` 和 `nav_font`，供 `public/boot.js` 在首帧同步恢复外观，消除深色模式闪白。

## 3. 关键实现

- **数据流与多级目录**（`src/pages/newtab/NewtabApp.tsx`、`src/lib/bookmarks.ts`）：按 `getTree() → buildRootTree() → useMemo(view)` 单向派生；外部书签变更经 150ms 防抖重新拉取，并在 `onRemoved` 时递归清理失效星标。左侧目录树最多展示到二级，三级分类在二级视图内按分段平铺展示，支持拖拽排序、跨组移动、右键编辑与左下角浮动玻璃态删除区。
- **首帧防闪烁与虚拟滚动字体**（`public/boot.js`、`src/components/FontPicker.tsx`）：`boot.js` 在 React 挂载前同步恢复主题与字体；系统字体选择器以 `32px` 行高虚拟滚动渲染可视区域，避免数百款本机字体卡顿主线程。
- **混合智能收藏**（`src/lib/classifier.ts`、`src/lib/pageContext.ts`、`src/lib/ai.ts`、`src/pages/popup/PopupApp.tsx`）：弹窗 0ms 用本地模型预填分组与精简标题；若启用了 DeepSeek，后台并发提取当前标签页摘要（300ms 超时兜底）并请求官方接口（仅在用户尚未手动修改标题或分组时静默更新），支持一键手动重试以及无合适目录时的保守新建分类建议。
- **AI 智能整理（重命名 / 归类 / 目录体检）**（`src/components/BatchRenameDialog.tsx`、`src/lib/ai.ts`）：在系统设置「AI 助手」页签打开。**书签整理**支持按当前分组、我的收藏或全部书签分批（15 条/批）请求 DeepSeek 给出标题精简与可选重归类建议，用户显式确认后写回；**目录体检**基于整棵书签目录摘要给出合并、清理空目录、改名与拆分建议，执行前自动下载完整 JSON 备份，合并时先全量迁出书签与子目录并实时复核为空后才删除旧空目录。
- **收藏夹栏副本收藏**（`src/lib/favSync.ts`）：「我的收藏」以数据源根目录（默认「收藏夹栏」）的真实书签为唯一来源。给分组内书签点星标时在根目录复制一份副本（位于现有散装书签末尾、文件夹之前），取消收藏时移除根目录副本；随浏览器书签 / iCloud 书签天然跨设备与跨浏览器（含 Safari）同步。「我的收藏」视图按书签实际所属分组分段展示且禁用卡片拖拽移动；编辑标题/网址时同步更新副本，全局搜索按 URL 自动去重，首次加载自动迁移旧版本地星标。
- **无损保序导入导出**（`src/lib/transfer.ts`）：导出精简多级 JSON；替换导入前自动下载备份，采用临时目录三阶段构建并复用已有 URL 节点移动以保留 `dateAdded`、顺序与星标，同时保全非 `http/https` 书签节点不被误删。

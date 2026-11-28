# AGENTS

**NeatTab** 是一款 Edge / Chrome Manifest V3 书签新标签页扩展，默认完全离线运行，仅在用户显式启用 DeepSeek AI 助手时按需请求官方接口。

## 技术栈与构建

- **架构**：Vite 6 + React 19 + TypeScript + Tailwind CSS v4 + `@base-ui/react`（coss ui 风格原语，0px 直角设计），多入口构建（`newtab.html`、`popup.html`、`options.html`）输出至 `dist/`。
- **包管理**：统一使用 `pnpm`（Node.js 22+，`pnpm-workspace.yaml` 已配置 `allowBuilds: { esbuild: true }`）。
- **扩展加载目录**：Edge / Chrome 开发者模式下加载 `dist/` 目录。

## 目录结构

```text
neattab/
├── package.json / pnpm-workspace.yaml / tsconfig.json / vite.config.ts
├── newtab.html / popup.html / options.html   # 三个页面入口（均通过 boot.js 首帧恢复主题/字体）
├── public/
│   ├── manifest.json                         # MV3 清单（minimum_chrome_version: 110）
│   ├── sw.js                                 # 后台安装钩子
│   ├── boot.js                               # React 挂载前同步恢复主题与系统字体缓存
│   └── icons/
├── src/
│   ├── styles/globals.css                    # Tailwind v4 + 浅/深色板 + 2K/4K 响应式变量
│   ├── lib/
│   │   ├── types.ts / cn.ts
│   │   ├── storage.ts                        # chrome.storage.local 读写与主题/字体应用
│   │   ├── bookmarks.ts                      # 目录树构建、阅读清单分段与拖拽移动
│   │   ├── favSync.ts                        # 基于收藏夹栏根目录副本的跨设备「我的收藏」
│   │   ├── dedup.ts                          # 重复书签扫描与清理（保留正常收藏副本）
│   │   ├── classifier.ts                     # 本地 TF-IDF 朴素贝叶斯分类器与标题精简
│   │   ├── transfer.ts                       # 无损保序书签 JSON 导入导出
│   │   ├── pageContext.ts                    # activeTab + scripting 提取当前页摘要
│   │   └── ai.ts                             # DeepSeek 单页推荐、批量整理与目录体检
│   ├── components/
│   │   ├── ui/                               # 基于 @base-ui/react 与 CVA 的基础组件
│   │   ├── Favicon.tsx / FontPicker.tsx      # 站点图标 / 32px 行高虚拟滚动本机字体选择器
│   │   ├── SettingsContent.tsx               # 4 分类系统设置（外观与常规 / AI 助手 / 数据与备份 / 关于与权限）
│   │   ├── ImportDialog.tsx                  # JSON 导入弹窗（替换/追加模式与实时校验）
│   │   ├── DedupDialog.tsx                   # 重复书签清理弹窗
│   │   └── BatchRenameDialog.tsx             # AI 智能整理弹窗（书签整理 + 全局目录体检）
│   └── pages/
│       ├── newtab/                           # 新标签页应用（目录导航、搜索、拖拽排序、右键编辑）
│       ├── popup/                            # 工具栏快捷收藏弹窗（0ms 本地推荐 + DeepSeek 异步优化）
│       └── options/                          # 独立系统设置页
└── tests/
    ├── fixture-tree.js                       # 分类器离线 LOO-CV 测试样本
    └── run-tests.ts                          # 核心逻辑单元测试
```

## 本地存储字段

存于 `chrome.storage.local`：

| 键名 | 说明 |
|---|---|
| `rootId` | 数据源目录 ID，默认 `"1"`（收藏夹栏） |
| `openMode` | 点击书签的打开方式：`'tab'`（默认）或 `'same'` |
| `theme` / `font` | 外观主题（`'auto'` / `'light'` / `'dark'`）与字体（`'system'` / `'sys:<字体名>'`） |
| `view` / `expanded` | 上次选中的分组与侧栏展开状态 |
| `favorites` | 旧版遗留字段（首次加载自动迁移复制到收藏夹栏根目录后清空） |
| `lastFolderId` | 工具栏弹窗上次保存的目标目录 ID |
| `mlFeedback` | 本地分类纠错样本（最多保留最近 200 条） |
| `ai` | DeepSeek 配置：`{ enabled, apiKey, model }`（默认关闭，默认模型 `deepseek-flash`，可选 `deepseek-v4-pro`） |

另在 `localStorage` 缓存 `nav_theme` 与 `nav_font`，供 `public/boot.js` 在首帧同步恢复外观，消除深色模式闪白。

## 关键实现与不变量

- **权限与隐私底线**：`permissions` 为 `bookmarks`、`storage`、`favicon`、`activeTab`、`fontSettings`、`scripting`；`optional_host_permissions` 仅声明 `https://api.deepseek.com/*`，只在用户显式开启 DeepSeek AI 助手时申请并发送书签标题、网址、目录名与当前页摘要（不读输入框、不读浏览历史）。禁止私自新增其他网络权限或未声明的第三方请求。
- **数据安全与渲染底线**：仅在用户主动操作时修改或删除书签；删除、去重清理、替换导入与 AI 批量整理均须提供显式确认或勾选预览；禁止使用 `dangerouslySetInnerHTML` 或 `innerHTML` 拼接用户数据。
- **新标签页数据流（`NewtabApp.tsx`、`bookmarks.ts`）**：按 `getTree() → buildRootTree() → useMemo(view)` 单向派生；外部书签变更经 150ms 防抖重新拉取。左侧展示一级与二级分组，三级分组在二级视图内按分段平铺展示；快捷键包括 `/` 搜索、`Tab` 切结果、`Enter` 打开。
- **收藏副本机制（`favSync.ts`）**：「我的收藏」以数据源根目录（默认「收藏夹栏」）的真实书签副本为唯一来源，新副本插入在现有散装书签末尾、所有子文件夹之前，从而随浏览器原生同步与 iCloud 书签自动同步到多设备及 Safari。「我的收藏」视图按书签所属实际分组分段展示且禁用卡片拖拽移动；编辑标题/网址时须同步更新所有匹配 URL 的副本；全局搜索按 URL 去重。
- **智能收藏（`popup/PopupApp.tsx`、`classifier.ts`、`pageContext.ts`、`ai.ts`）**：弹窗 0ms 用本地 TF-IDF 朴素贝叶斯分类器与标题精简预填；启用 DeepSeek 时并发提取当前页 `meta description`、`h1` 与正文前 400 字（300ms 超时兜底），且默认关闭思考模式降低延迟；若用户已手动编辑标题或目录则不覆盖，无合适分组时仅以虚线标签建议新建分组，保存时才创建。
- **AI 批量整理与目录体检（`BatchRenameDialog.tsx`、`ai.ts`）**：书签整理按 15 条/批请求，**必须跳过根目录收藏副本**（只对实际分组原件与纯未分组项操作，重命名时同步更新对应副本），严禁将收藏副本移出根目录。目录体检执行前自动下载完整 JSON 备份，合并目录时先全量迁出书签与子目录并实时复核为空后才删除旧目录。
- **重复书签清理（`dedup.ts`、`DedupDialog.tsx`）**：按完整 URL 精确扫描当前数据源，**必须豁免「根目录 1 份 + 子分组 1 份」的正常收藏副本**；同组默认按更早 `dateAdded` 保留原件，支持切换保留项、删除多余副本，或将未在根目录的多余副本移回根目录恢复「我的收藏」，可选执行前下载 JSON 备份。
- **无损保序导入导出（`transfer.ts`）**：替换导入前自动下载备份，采用临时目录三阶段构建并复用已有 URL 节点移动，以保留 `dateAdded`、顺序与星标，同时保全非 `http/https` 书签节点不被误删。

## 命令与校验

```powershell
# 开发预览
pnpm run dev

# 仅类型检查
pnpm run typecheck

# 类型检查与生产构建（输出到 dist/）
pnpm run build

# 运行核心逻辑单元测试（分类器、导入导出、收藏同步、去重）
pnpm test
```

## 发版约定

- 采用语义化版本 `0.x.y`：新增完整功能块升中间位（`0.2.0`），修 bug 与打磨细节升末尾位（`0.1.1`）。
- 发版时同步修改 `package.json` 与 `public/manifest.json` 的 `version`，执行 `pnpm run build && pnpm test` 通过后提交、打 `vX.Y.Z` tag 并推送，将 `dist/` 内容打包为 `neattab-vX.Y.Z.zip` 上传至对应 GitHub Release。

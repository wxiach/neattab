# AGENTS.md

## 产品与界面约束

| 领域 | 约束 |
|---|---|
| 隐私与权限 | 默认离线、不读浏览历史；新增外部接口须声明在 `public/manifest.json` 的 `optional_host_permissions` 中，且仅在用户开启后按需申请 |
| 书签安全 | 批量修改或删除书签必须提供显式确认或预览，禁止静默改动 |
| 收藏副本 | `我的收藏` 基于根目录真实书签副本实现（见 `src/lib/favSync.ts`），不要误判为重复书签或自动移出根目录 |
| 界面与文案 | 保持 0px 直角设计，基础控件复用 `src/components/ui/`，颜色使用 `globals.css` 语义变量并配合 `cn()`，辅助说明文字尽量精简 |

## 编码规范

| 维度 | 要求 |
|---|---|
| 拆分与抽象 | 避免单文件或单函数过度堆积：核心业务逻辑抽到 `src/lib/`，独立弹窗与可复用区域拆分为独立组件 |
| 导入路径 | `src/lib/` 内部互导须用相对路径并带 `.ts` 后缀（供 Node 单测直接执行）；组件与页面使用 `@/` 别名 |
| 语法风格 | 优先使用常规 `if/else`、`for...of` 和具名函数，避免多层嵌套三元、复杂链式 `reduce` 或炫技式泛型 |
| 分段与注释 | 函数内按逻辑步骤适当留空行；用中文为非显而易见的意图和边界条件写简短注释（只说明“为什么”） |

## 命令与验证

统一使用 `pnpm`（不要使用 `npm`），所有命令在仓库根目录执行。

| 命令 | 作用 | 执行时机 |
|---|---|---|
| `pnpm run dev` | 启动本地开发预览 | 调试界面时 |
| `pnpm run build` | 类型检查并构建至 `dist/`（浏览器开发者模式加载此目录） | 每次改动代码后 |
| `pnpm test` | 运行 `tests/run-tests.ts` | 改动 `src/lib/` 后（同步补测） |

## Git 与发版

未经用户明确要求，不要自动执行 `commit`、`push`、打 `tag` 或发布 Release。

仅在用户明确要求发版时按顺序执行：

1. 同步更新 `package.json` 和 `public/manifest.json` 的 `version`。
2. 运行 `pnpm run build` 与 `pnpm test` 确认全部通过。
3. 提交改动并推送 `main` 与 `vX.Y.Z` tag，将 `dist/*` 打包为 `neattab-vX.Y.Z.zip` 上传至对应 GitHub Release。

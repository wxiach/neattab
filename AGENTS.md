# AGENTS.md

## 常用命令

在仓库根目录执行，统一使用 `pnpm`（不要使用 `npm`）。浏览器开发者模式加载 `dist/` 目录。

- 构建与类型检查：`pnpm run build`
- 运行单元测试：`pnpm test`

改动代码后运行 `pnpm run build`；改动 `src/lib/` 时在 `tests/run-tests.ts` 补齐测试并运行 `pnpm test`。

## 代码风格

- 写法保持直白，优先使用常规 `if/else`、`for...of` 和具名函数，避免多层嵌套三元、复杂链式 `reduce` 或炫技式泛型。
- 函数内按逻辑步骤适当留空行，不要把所有代码挤在一起。
- 用中文为非显而易见的意图和边界条件写简短注释，只解释“为什么”，不复述代码本身。
- 独立弹窗、可复用区域拆分为单独组件，核心业务逻辑抽到 `src/lib/`，避免单文件或单函数过度堆积。
- `src/lib/` 内部互导必须使用相对路径并带 `.ts` 后缀（供 `pnpm test` 的 Node 直接运行）；组件与页面使用 `@/` 别名。
- 界面保持 0px 直角风格，基础控件复用 `src/components/ui/`，颜色使用 `globals.css` 语义变量并配合 `cn()`；界面辅助文字尽量精简。

## 边界与禁止事项

- 默认保持离线，不读取浏览历史；新增外部接口必须在 `public/manifest.json` 的 `optional_host_permissions` 中声明，且仅在用户开启后按需申请。
- 批量修改或删除用户书签必须提供显式确认或预览，禁止静默改动。
- `我的收藏` 以数据源根目录的真实书签副本实现（见 `src/lib/favSync.ts`），不要将其误判为重复书签，也不要自动移出根目录。
- 未经用户明确要求，不要自动执行 `commit`、`push`、打 `tag` 或发布 Release。

## 发版

仅在用户明确要求发版时执行：

1. 同步更新 `package.json` 和 `public/manifest.json` 的 `version`。
2. 运行 `pnpm run build` 和 `pnpm test` 确认全部通过。
3. 提交并推送 `vX.Y.Z` tag，将 `dist/*` 打包为 `neattab-vX.Y.Z.zip` 上传至对应 GitHub Release。

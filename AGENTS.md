# AGENTS

项目说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 底线

- 不联网，不增减 `manifest.json` 权限，不引入框架、构建工具或第三方依赖。
- 仅在用户主动操作时修改书签，删除需二次确认；禁止用 `innerHTML` 拼接数据。

## 校验

- 修改 JS 后检查语法：`Get-ChildItem js\*.js, sw.js | ForEach-Object { node --check $_.FullName }`
- 修改 `newtab.html` / `options.html` 后同步预览页：`python tools/make_preview.py`

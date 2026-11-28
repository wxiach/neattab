# NeatTab — 书签导航

![Version](https://img.shields.io/github/package-json/v/wxiach/neattab?style=flat-square&label=version&color=111827)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-2563eb?style=flat-square)
![Browser](https://img.shields.io/badge/Browser-Edge%20%7C%20Chrome-0078d4?style=flat-square)
![Offline First](https://img.shields.io/badge/Privacy-Offline%20First-10b981?style=flat-square)

把浏览器收藏夹直接变成干净、顺手的新标签页，支持 Edge 与 Chrome，默认完全离线运行。

## 功能介绍

### 书签浏览与跨设备收藏

直接读取浏览器的「收藏夹栏」（可在设置里更换目录）：左侧是一、二级目录，三级目录在右侧按块平铺展示。日常找书签可以直接搜索，整理时支持拖拽排序、跨组移动、右键编辑，或者直接拖到左下角删除。

常用网站点一下星标即可加入「我的收藏」。它的做法很直接：在「收藏夹栏」最外层放一份书签副本，取消收藏时只删这份副本，原分组里的书签不受影响。这样不需要额外注册账号或配置云服务，只要开了浏览器自带同步或 iCloud 书签，就能自动同步到其他电脑和 Safari；回到 NeatTab 的「我的收藏」页面，书签依然会按原来的分组整齐展示。

### 智能收藏与 AI 整理

点击工具栏图标收藏当前网页时，内置的本地模型会立刻推荐分类并精简标题，也支持一键加入「阅读清单」，平时你改过的分类它都会记住，越用越准。

如果觉得手动整理麻烦，可以在「系统设置 → AI 助手」里填入 DeepSeek API Key 按需开启（默认关闭，不开启时完全离线）：

- **收藏更准确**：收藏网页时会结合页面内容优化标题与分类；实在没有合适目录时，还会建议新建分类，确认保存时才真正创建。
- **批量整理书签**：按分组或全量批量生成精简标题和归类建议，每一条都可以先勾选、修改，确认后才会写回收藏夹。
- **全局目录体检**：通盘检查现有目录结构，给出合并零散分类、清理空目录、规范命名和拆分臃肿目录的建议，执行前会自动下载备份。

### 清理、备份与外观

- **重复书签清理**：在设置中扫描重复网址，自动保留正常的收藏副本，多余的可以删除或直接移回「我的收藏」。
- **JSON 备份导入**：支持导出精简 JSON 备份；替换导入前自动备份，保留原有的排列顺序与收藏时间。
- **外观与字体**：支持浅色 / 深色跟随系统、2K / 4K 屏幕适配，以及切换电脑里已安装的任意系统字体。

## 安装与更新

### 方式一：下载安装包（推荐，无需 Node 环境）

1. 前往 [Releases](https://github.com/wxiach/neattab/releases) 下载最新版本的 `neattab-v*.zip` 并解压。
2. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`），开启 **开发人员模式**。
3. 点击 **加载解压缩的扩展**，选择解压后的目录即可。

### 方式二：从源码构建

前置环境：Node.js 22+、`pnpm`。

1. 克隆仓库并构建：

   ```bash
   git clone https://github.com/wxiach/neattab.git
   cd neattab
   pnpm install
   pnpm run build
   ```

2. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`），开启 **开发人员模式**。
3. 点击 **加载解压缩的扩展**，选择生成的 **`dist/`** 目录。

拉取源码更新后，重新执行 `pnpm run build`，在扩展管理页点击 **重新加载** 即可。

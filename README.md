# NeatTab — 书签导航

![Version](https://img.shields.io/github/package-json/v/wxiach/neattab?style=flat-square&label=version&color=111827)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-2563eb?style=flat-square)
![Browser](https://img.shields.io/badge/Browser-Edge%20%7C%20Chrome-0078d4?style=flat-square)
![Offline First](https://img.shields.io/badge/Privacy-Offline%20First-10b981?style=flat-square)

将浏览器收藏夹直接变成简洁的新标签页。

## 功能介绍

### 新标签页

不用再从狭窄的收藏夹栏里一层层翻找——打开新标签页就能直接浏览多级书签目录，拖拽排序、右键编辑都更顺手，所有数据依然留在浏览器原生收藏夹中。

### 书签搜索

打开新标签页直接输入即可全量检索书签，支持离线即时匹配与按需语义检索：

| 方式 | 说明 |
|---|---|
| 本地即时搜索 | 默认完全离线，支持关键词、中文拼音与首字母、英文缩写、拼写容错及分组路径匹配 |
| AI 语义搜索 | 记不清标题、只记得用途时，按语义联想找回相关书签（需启用 AI） |

### 智能整理

书签攒久了难免杂乱、重复，支持按需进行批量整理与去重（前两项需启用 AI）：

| 功能 | 说明 |
|---|---|
| 批量重命名与归类 | 按分组或全量整理冗长标题并重新归类 |
| 目录体检 | 找出零散、空目录与过载目录，给出合并、改名或拆分建议 |
| 重复书签清理 | 找出重复网址，按需清理多余条目 |

### 快捷收藏

浏览器自带收藏常要手动改标题、翻目录。点击工具栏图标即可收藏当前页；未开启 AI 时原样保留网页标题，启用 AI 后会结合页面内容给出合适的名称与分类（无合适目录时建议新建），确认一下就能收好。

### 稍后阅读

看到想留着慢慢看的文章或帖子，不必和常用网站混在一起——收藏时会自动识别并归入「阅读清单」，按来源站点归类、按收藏时间倒序排列，回头翻看更清晰。

### 书签备份

大整理或迁移前可以一键导出精简 JSON 留底；替换导入时自动保留原有的排列顺序与收藏时间。

## 安装与更新

1. 前往 [Releases](https://github.com/wxiach/neattab/releases) 下载最新 `neattab-v*.zip` 并解压。
2. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`），开启 **开发人员模式**。
3. 点击 **加载解压缩的扩展**，选择解压后的目录。

更新时下载新版覆盖原目录，在扩展管理页点击 **重新加载** 即可。

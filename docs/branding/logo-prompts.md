# LOGO 生成提示词（ip-as-logo 规范）

> **状态：暂缓（2026-11-23）。** 用户决定先不做 LOGO，扩展继续使用 icons/ 下的占位图标。本文档保留，等需要时直接复用。

> 依据 [ip-as-logo](https://github.com/s1dashu/ip-as-logo-skill) 整理。产品名已定为「书签」，吉祥物方向从动物改为**书签本体**——一条有表情的纸签，比任何动物都更容易在 16px 下辨认。
> 提示词里**不出现 logo / brand / icon / app** 等字样（规范要求），只说“一张方形角色图”。
> 生成后放到 `docs/branding/candidates/`，命名 `a1.png` … `c2.png`。

## 产品简报

「书签」是一个接管新标签页的浏览器扩展：把收藏夹栏变成可扫读、可搜索的索引页。只读、不联网、中性灰 + 一个蓝（`#2563EB`）。气质是安静、可靠、随手可用。

产品名就是它的吉祥物：**一张纸签**。它天然带两个特征——顶部的缺口和垂下来的尾端，正好可以做眼睛和身体。

## 三个方向

| 方向 | IP | 产品连接 | 剪影 |
|---|---|---|---|
| A | 书签带 | 从书页里垂下来的一条纸签，最像“书签”本体 | 竖长条 + 底端 V 形缺口 + 两只眼睛 |
| B | 折角 | 一页纸的右下角折起来，极简几何 | 方块 + 一个圆角折角，折角上有两只眼睛 |
| C | 索引签 | 图书馆卡片露头的标签，对应“分组/索引” | 横向短签 + 圆头 + 顶部一条露出线 |

## 通用约束（已写进每条提示词）

- 1:1 方图，满幅，纯色背景，四个角直角
- 角色从左下角探入，占画面 85–95%，不居中
- 4–7 个大色块组成一个连续剪影，圆钝、无尖角、无细线
- 恰好三种语义色：两种 IP 主体色 + 一种背景色
- 32×32 仍可辨认；只保留两只眼睛，必要时加一张小嘴
- 不要文字、水印、边框、卡片、场景、投影、材质感

---

## A1 · 书签带 / 深蓝

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid deep navy. Keep deep navy visible in every open area and in the corners not occupied by the character; the lower-left corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing bookmark-ribbon IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature: a long bookmark strip hanging down with a blunt rounded V-shaped notch at its bottom end.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, fold line, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: warm off-white and muted blue as the two IP base colors, plus the deep navy background. Organize the two IP colors into broad purposeful masses, and reuse them for the facial marks. Keep clear separation between the character, the face, and the background.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Add an extremely, extremely subtle, almost imperceptible sense of depth.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

## A2 · 书签带 / 墨绿蓝

同 A1，替换两行：

```text
Background: solid muted deep teal-navy. IP base colors: bone white and steel blue.
```

## B1 · 折角 / 靛蓝

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid muted indigo. Keep it visible in every open area and in the corners not occupied by the character; the lower-left corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing folded-page IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature: a thick rounded page corner folded over at the lower-right of the shape.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes on the flat page face and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, text line, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: soft paper white and muted blue as the two IP base colors, plus the muted indigo background. Organize the two IP colors into broad purposeful masses, and reuse them for the facial marks.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Add an extremely, extremely subtle, almost imperceptible sense of depth.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

## B2 · 折角 / 紫灰

同 B1，替换：

```text
Background: solid muted plum. IP base colors: warm cream and dusty blue.
```

## C1 · 索引签 / 深灰蓝

```text
Create one complete full-bleed 1:1 square image.
Background: fill the entire square with solid dark slate blue. Keep it visible in every open area and in the corners not occupied by the character; the lower-left corner must be occupied by the character.
Subject: place one extremely simplified, cute, endearing index-tab IP character on the background, reduced to one soft rounded continuous silhouette and one defining feature: a short wide card tab with a blunt rounded head sticking up.
Complexity: use only 4–7 large basic shapes and at most two broad internal color regions. Use two simple eyes on the tab face and add one tiny mouth only when it helps the expression. Remove every nonessential line, outline, ruling, texture, and decoration. Keep the character readable at 32 × 32.
Color behavior: use exactly three semantic colors in the complete image: warm off-white and muted blue as the two IP base colors, plus the dark slate blue background. Organize the two IP colors into broad purposeful masses, and reuse them for the facial marks.
Composition: keep the character upright and emerging from the lower-left corner, filling about 85–95% of the square so it remains visually dominant. Cropping at the bottom or left side is welcome. Preserve both paired identifying features. Never center or bottom-center the character.
Style: make simplification, cuteness, and lovable baby-like appeal the strongest qualities. Use large soft forms, compact proportions, thick rounded contours, and an ultra-clean graphic treatment. Add an extremely, extremely subtle, almost imperceptible sense of depth.
Finish: show only the character on the full-canvas background, with clean surfaces and normal square outer corners.
Constraints: Use no text or watermark. Add no borders, frames, cards, or presentation masks. Include one character only, with no extra subjects or scenery. Use no fragile lines, sharp tips, unnecessary outlines, tiny details, or decorative marks. Add no photorealistic material, dramatic bevel, glossy hotspot, extrusion, strong three-dimensional rendering, or external cast shadow. Keep the background solid and uniform, with no texture, vignette, or lighting variation.
```

## C2 · 索引签 / 橄榄

同 C1，替换：

```text
Background: solid muted olive. IP base colors: sage white and slate blue.
```

---

## 生成后的加工

1. 六张人眼筛，保留 1–2 张
2. 用角色主体裁出正方形安全区（保留顶部的书签缺口或折角），作为图标底图
3. 输出扩展图标：`icons/icon16/32/48/128.png`
4. 顶栏左侧加 20px 图标（现在标签页标题是数据源名，图标是唯一的品牌痕迹）
5. 浅色 / 深色各检查一次 16px 下的可辨认度


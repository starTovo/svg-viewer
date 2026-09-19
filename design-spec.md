# SVG Studio · 前端页面设计规格（MVP）

> 目标设备：安卓手机（360–430px）为主，平板（768–1280px）次之
> 设计系统：Lumen UI（`E:\uiux\ui素材`）—— 极简中性 / Linear 风
> 交付形态：`index.html` 单文件自包含，零外部依赖，可离线

---

## 1. 交互设计选型

### Selected Interaction

```
主模式：07 · Apple Feedback for Related Switches（开关联动反馈）
叠加质感特效：T5 · Liquid Tab Indicator（液态 Tab 指示器）
辅助入场：03 · Staggered Reveal（交错渐显）
强度：标准
时长：Tab 指示条 220ms · 内容切换 160ms · 入场 280ms
```

### Why This Fits

这个 MVP 的本质是**同一份 SVG 数据的三种观察与操作视角**（预览 / 代码 / 元素），三者互斥且共享状态——
用户切换的不是"页面"，而是"看待同一份数据的方式"。这正是 07 开关联动反馈定义的场景：一组互斥开关，
切换带即时反馈且状态联动（改代码 → 预览重渲染 → 元素列表刷新，形成闭环）。

排除的候选：
- **10 标签展开**——它服务于"多选项筛选"，而这里的三个视图是单选互斥，用标签展开会让用户误以为可以多选。
- **02 拖拽阅读**——适用于长列表扫读，本页面的画布是**缩放平移**（跟手实时变换），不是列表扫读，行为骨架不匹配。

叠加 **T5 液态 Tab**：07 只规定了"状态互斥 + 即时反馈"这个骨架，本身不含空间位移的过渡语言。
三个 Tab 的文字宽度不等（"预览"/"代码"/"元素" 都是 2 字，但加图标后视觉宽度有差），
一条跟随文字宽度、以 spring 曲线流动的水银指示条，正好补足"我从哪里来、到哪里去"的空间连续性，
且实现只用 `translateX + scaleX`，不触发重排。

---

## 2. 信息架构

```
SVG Studio
├── 顶栏（52px + safe-area）
│   ├── 应用名 + 文件名（可点击重命名）
│   └── 图标按钮组：打开 / 保存 / 复制源码 / 导出 PNG / 深浅色
├── 主区
│   ├── 预览视图  ── 画布 + 缩放平移 + 背景切换 + 元素点选
│   ├── 代码视图  ── textarea 源码编辑（防抖 300ms 实时渲染）
│   └── 元素视图  ── 元素列表 + 属性编辑 + 层级操作 + 删除
└── 状态条（32px）── 校验状态 · 元素数 · 缩放比
```

### 响应式策略（同一份 DOM，媒体查询切换）

| 断点 | 布局 |
|------|------|
| **手机** `< 768px` | 底部 Tab 栏（56px + 安全区），三视图**全屏互斥**切换 |
| **平板** `≥ 768px` | **预览常驻左侧**（55–60% 宽），右侧上下分栏，内部 Tab 切换 代码 / 元素 |

手机上**禁止**切到代码视图时自动 focus 弹软键盘——手写 SVG 语法时键盘遮挡 60% 屏幕，体验极差。
平板无此问题，可自动聚焦。

---

## 3. 视图细节

### 3.1 预览

| 项 | 规格 |
|----|------|
| 手势 | Pointer Events（非 touch+mouse 拼接），`touch-action: none` |
| 缩放 | 0.1x – 8x；双击在 1x ↔ 2x 间切换 |
| 平移 | 单指拖动；边界阻尼（超出后回弹，回弹 ≤ 2 次、幅度 ≤ 25%） |
| 背景 | 棋盘格（12px，表现透明，默认）/ 纯白 / 纯黑 |
| 工具条 | 悬浮：`缩小 · 百分比 · 放大 · 1:1 · 适应屏幕` |
| 元素点选 | 点击图形 → bbox 覆盖层高亮（accent 1.5px 虚线）→ 手机自动跳"元素"视图 |
| 元信息 | 右下角显示 SVG 原始尺寸 |

### 3.2 代码

- 等宽 `textarea`，**不做语法高亮**（MVP 不引入 CodeMirror）
- 输入防抖 **300ms** 重新渲染；解析失败时**保留上一次成功渲染**，底部出错误提示条，不清空画布
- 顶部：字符数 / 行数
- 快捷插入条（横向滚动）：矩形 / 圆 / 椭圆 / 直线 / 折线 / 多边形 / 路径 / 文字

### 3.3 元素

- **元素列表**：`<rect> <circle> <ellipse> <line> <polyline> <polygon> <path> <text> <g>`
- **属性编辑**：`fill` / `stroke`（color input + 文本，可留空 = none）、`stroke-width`（0–20）、`opacity`（0–1，步进 0.05）
- **层级操作**：置顶 / 上移 / 下移 / 置底（改 DOM 顺序）
- **删除**
- 双向同步：`代码 ↔ 预览 ↔ 元素` 三向闭环，用 `isSyncing` 标志位防循环触发
- 空状态：内联 SVG 插画 + "点击预览中的图形，或从上方列表选择" + 主按钮"跳到代码"

---

## 4. 组件映射（Lumen UI 24 组件）

| 本页用到的位置 | Lumen 组件 |
|----------------|-----------|
| 视图切换 | 09 Segmented 分段控件 / 20 Tabs 选项卡 |
| 顶栏图标按钮 | 02 Icon Button 图标按钮 |
| 打开 / 保存 / 导出 | 01 Button 按钮（md 32px） |
| 文件名重命名 | 03 Input 输入框 |
| fill / stroke | 03 Input + 自定义取色器 |
| stroke-width / opacity | 08 Slider 滑块 |
| 元素列表项 | 10 Tag 标签 / 14 Card 卡片 |
| 解析错误提示 | 15 Alert 提示条（danger） |
| 恢复上次编辑 | 16 Toast 轻提示 |
| 元素空状态 | 24 Empty State 空状态 |
| 代码/元素分栏 | 13 Divider 分割线 |

---

## 5. 设计 Token（节选，完整见 `design-system/tokens/tokens.css`）

```css
/* 浅色 */
--bg-canvas:#F9FAFB;  --bg-surface:#FFFFFF;  --bg-subtle:#F2F4F7;
--border-default:#E4E7EC; --border-strong:#D0D5DD;
--text-primary:#101828; --text-secondary:#475467; --text-tertiary:#667085;
--accent:#5E6AD2; --accent-hover:#4B55B8;
--success:#0FA968; --warning:#DC6803; --danger:#D92D20;

/* 深色 */
--bg-canvas:#0D0E10; --bg-surface:#131417; --bg-subtle:#1A1C1F;
--border-default:#24262B; --border-strong:#31343A;
--text-primary:#F5F6F7; --text-secondary:#A9AFB8; --text-tertiary:#8A9099;
--accent:#6E79E8; --accent-hover:#8A93F0;

/* 尺寸 */ 控件 sm 28 / md 32 / lg 40px；圆角 控件 6 · 卡片 12 · 圆钮 full
/* 栅格 */ 4px 基准 / 8px 节奏
/* 缓动 */ --ease-out:cubic-bezier(.25,1,.5,1) · --ease-spring:cubic-bezier(.34,1.56,.64,1)
/* 时长 */ 120 / 160 / 200 / 280 / 400ms
```

---

## 6. 动效规范

| 场景 | 属性 | 时长 | 缓动 |
|------|------|------|------|
| Tab 指示条流动 | `translateX` + `scaleX` | 220ms | `--ease-spring` |
| 视图内容切换 | `opacity` + `translateY(8px)` | 160ms | `--ease-out` |
| 首屏交错入场 | `opacity` + `translateY(8px)`，每项延迟 40ms | 280ms | `--ease-out` |
| 按钮/图标反馈 | `scale(0.96)` + 背景色 | 120ms | `--ease-out` |
| 元素选中高亮 | `opacity` | 120ms | `--ease-out` |
| 手势跟手 | `translate3d() scale()` 实时写入 | 无过渡 | — |
| 松手惯性/回弹 | 同上 + transition | 200ms | `--ease-out` |

**红线**
- 只动画 `transform` / `opacity` / `clip-path` / `filter`；禁止动画 `width`/`height`/`top`/`left`/`margin`
- 同时动画元素 ≤ 20 个
- 页面级过渡 ≤ 400ms

---

## 7. 降级与可访问性

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- JS 侧 `window.matchMedia('(prefers-reduced-motion: reduce)').matches` 跳过交错入场与 spring
- Tab 语义：`role="tablist"` / `role="tab"` / `aria-selected`，面板 `role="tabpanel"`
- 键盘 Tab / Enter / Esc 全可达；`:focus-visible` 2px accent outline，offset 2px
- 触控热区 ≥ 44×44px；文本对比度 ≥ 4.5:1，非文本 ≥ 3:1
- 动画不作为唯一信息载体

---

## 8. 安全

渲染用户输入的 SVG 前必须 `sanitizeSvg()`：
- 移除所有 `<script>` 元素
- 移除所有 `on*` 事件属性（`onload` / `onclick` / …）
- 移除 `javascript:` 协议的 `href` / `xlink:href`

---

## 9. 持久化

| 能力 | 实现 |
|------|------|
| 自动保存 | `localStorage['svg-studio:doc']`，重开自动恢复 + toast 提示 |
| 导入 | `<input type="file" accept=".svg,image/svg+xml">` + FileReader |
| 导出 SVG | Blob + `createObjectURL` + `<a download>` |
| 复制源码 | `navigator.clipboard.writeText`，降级 `execCommand('copy')` |
| 导出 PNG | 序列化 → `Image` → canvas 2x → `toBlob` 下载（无宽高时从 viewBox 推断） |

---

## 10. 兼容性

目标内核最低 **Chromium 86**（微信 X5）：不用顶层 await、不用 `:has()`、不用 `structuredClone`、
避免提案级语法。ES2017 写法为主。

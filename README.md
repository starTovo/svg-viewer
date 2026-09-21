# SVG 查看器

> 安卓手机 / 平板上的 SVG 查看与编辑工具。
> 打开 → 改代码 → 看效果 → 导出 PNG，**全程离线可用**。

<p>
  <img alt="单文件" src="https://img.shields.io/badge/单文件-零依赖-blue">
  <img alt="Android" src="https://img.shields.io/badge/Android-8.0%2B-green">
  <img alt="版本" src="https://img.shields.io/badge/版本-1.2.1-orange">
  <img alt="AI 辅助" src="https://img.shields.io/badge/AI-辅助开发-purple">
</p>

## 在线演示

手机与平板的**真实可交互界面**（不是截图，能点能缩放能改代码）：

👉 **https://starTovo.github.io/svg-viewer/**

---

## 它是干嘛的

手机上想看一个 SVG 文件、想改两笔代码、想导出成 PNG，通常要么得开电脑，要么得装个臃肿的在线工具。这个 App 就是为了解决这几件小事：

| 你要做什么 | App 里怎么做 |
|---|---|
| 打开一个 SVG | 在 App 内选文件，或在文件管理器里长按 →「用其他应用打开」→ 选它 |
| 改一改 | 切到代码页直接改源码，300ms 后自动重渲染 |
| 写错了 | 画面**保留上一次成功渲染**，下方直接报出**第几行第几列**错了，点一下光标跳过去 |
| 看清细节 | 双指缩放（0.1x–8x）、单指拖动、双击快速放大 |
| 看透明区域 | 背景切换：棋盘格 / 纯白 / 纯黑 |
| 存成图片 | 一键导出 PNG（2x 清晰度），也能存 SVG |
| 存到指定位置 | 设置里选导出目录，之后都存那儿 |

**几个让人省心的细节**

- **清空不慌**：一键清空有撤销兜底，支持多步撤销/重做（Ctrl+Z / Ctrl+Y）
- **改错不白屏**：语法有问题时保留上次成功画面，不会一片空白
- **没网也能用**：整个界面就是一个 HTML 文件，零外部请求
- **手机平板两套布局**：手机底部标签栏全屏切换，平板预览常驻左侧、右侧编辑

---

## 下载安装

到 [Releases](../../releases/latest) 下载最新版的 `svg-viewer-<版本>.apk`，装到安卓 8.0+ 的手机上即可。
安装步骤与常见问题见 [安装说明.md](安装说明.md)。

> 自签名应用，安装时需要在系统设置里给「安装未知应用」授权。
> **App 未申请任何权限，也不需要联网** —— 界面就是一个 HTML 文件，功能全在本机完成。

---

## 项目结构

```
app/
  index.html        主界面 —— 整个 App 的 UI，单文件零依赖
  qa.cjs            回归验证（100 项）
  qa-v5.cjs         1.2.0 新增功能验证（21 项）
  qa-pinch.cjs      手势抖动量化探针
android/
  build.sh          一键打包（无 Android SDK 路线）
  setup-tools.sh    首次构建前下载工具链
  src/              原生源码：Manifest / res / Java
docs/
  index.html        GitHub Pages 展示页（由 make-pages.cjs 生成）
make-review.cjs     生成双设备 UI 走查台
make-pages.cjs      生成 Pages 展示页
```

---

## 本地构建

```bash
# 1) 首次：下载构建工具链（aapt2 / d8 / android.jar / 签名器，约 150MB）
cd android && bash setup-tools.sh

# 2) 打包 APK（产物在 android/out/）
bash build.sh

# 3) 跑验证（需要本机有 Chrome）
cd ../app && npm i playwright-core && node qa.cjs

# 4) 重新生成在线演示页
cd .. && node make-pages.cjs
```

> 构建工具链默认下载到仓库根目录下的 `android/.tools/`（已被 `.gitignore` 忽略），首次 `bash setup-tools.sh` 会自动创建；
> 也可以用环境变量 `SVGVIEW_TOOLS` 指向已有的工具链目录。
> 验证脚本的截图与结果默认写到 `app/shots/` 与 `app/`，可用 `SVGVIEW_SHOTS` / `SVGVIEW_OUT` 覆盖。

改界面只需编辑 `app/index.html`，`build.sh` 会自动同步到打包目录，**不需要动 Java**。

> ⚠️ 走查台与 `docs/index.html` 都是**内嵌快照**，改完 `app/index.html` 必须重新生成，否则看到的是旧界面。

---

## 技术实现

整个 App 就是一个 HTML 文件（162KB），跑在 Android WebView 里；原生侧只负责 WebView 容器、文件选择、保存与导出目录。

**没有 Android SDK / Gradle / Android Studio** —— 靠 JDK + 四个工具直接产出 APK：

| 工具 | 用途 |
|---|---|
| `aapt2` | 编译资源、生成 R.java、打包 |
| `r8.jar`（内含 D8） | class → dex |
| `android.jar` | 编译用桩（用 Robolectric `android-all` 替代官方源，后者常 403） |
| `uber-apk-signer.jar` | 对齐 + 签名 |

流程：`aapt2 compile+link → javac --release 11 → d8 → 塞 classes.dex → 签名`

**踩过的坑（改构建脚本前先看）**
- 传给 aapt2/javac/java 的路径必须 `cygpath -m` 转成 `盘符:/...` 前向斜杠形式，用 `/e/...` 原生工具会报"找不到文件"
- javac 必须 `--release 11`，默认高版本字节码 d8 拒绝解析
- 用 `DocumentsContract` 而非 `DocumentFile`（项目无 androidx）；tree Uri 不能直接当 CREATE_DOCUMENT 的 parent
- 多点触控手势的锚点必须在手势开始时冻结，不能读被 transform 改过的元素尺寸，否则双指缩放会抖

---

## 🤖 关于 AI 参与（Vibe Coding）

本项目采用 **Vibe Coding** 方式开发：**需求判断与最终验收由人负责，界面实现、构建脚本与自动化验证由 AI 完成。**

| 环节 | 谁负责 |
|---|---|
| 需求定义、取舍决策、界面验收 | **人** |
| 界面实现（HTML/CSS/JS） | AI |
| 安卓原生代码（Java） | AI |
| 无 SDK 构建管线（aapt2 / d8 / 签名） | AI |
| 自动化测试与验证 | AI |
| 关键决策复核（是否修复、是否接受取舍） | **人** |

**AI 具体做了什么**

- 编写 `app/index.html`（162KB 单文件应用）与 `android/src` 下的原生代码
- 搭建无 Android SDK 的 APK 构建管线，并写了可重跑的 `setup-tools.sh`
- 建立了 **121 项自动化验证**（真实 Chrome，覆盖手机 390×844 与平板 820×1180、浅色与深色），控制台零报错
- 定位并修复了一个不易察觉的手势缺陷：双指缩放时锚点在两指间逐帧翻转，导致画面单帧跳动 335px；改为手势开始时冻结基准后降到 4.4px

**人做了什么**

- 提出需求、试用后指出问题（"适应按钮不居中""顶栏和底栏分不清""双指缩放会抽搐"）
- 对 AI 的判断做取舍：例如推翻了"窄屏隐藏标题"的方案、要求导出路径在原生不支持时必须**诚实告知**而不是假装生效
- 决定何时发布、版本号如何对齐

**说明**：这是一个以实用为目的的小工具项目，不是 AI 能力演示。AI 加速了实现过程，但功能取舍与质量标准由人把关。

---

## 许可证

[MIT](LICENSE) —— 允许自由使用、修改与分发，请保留版权声明。

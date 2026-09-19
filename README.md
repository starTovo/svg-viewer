# SVG 查看器（SVG Studio）

安卓手机 / 平板上的 **SVG 查看器 + 编辑器**，单文件 WebView 应用。

打开 / 编辑 SVG → 查看渲染 → 双指缩放 → 导出 PNG，全部离线可用。

- **包名**：`com.svgview.app`
- **当前版本**：1.2.0（versionCode 3）
- **要求**：Android 8.0+（API 26），目标 API 34

---

## 目录结构

```
app/
  index.html        主界面 —— 整个 App 的 UI，单文件零依赖
  qa.cjs            回归验证（100 项）
  qa-v5.cjs         1.2.0 新增功能验证（21 项）
  qa-pinch.cjs      手势抖动量化探针
android/
  build.sh          一键打包（无 Android SDK 路线）
  setup-tools.sh    重新下载构建工具链（_tools/ 不入库）
  src/              原生源码：Manifest / res / Java
  _tools/           构建工具（gitignored，见 setup-tools.sh）
  out/              产物 APK（gitignored）
make-review.cjs     生成双设备走查台
安装说明.md         面向用户的安装与使用说明
design-spec.md      设计规格（Lumen UI 规范）
overview.md         交付总览
```

---

## 快速开始

### 预览界面（改界面时用）

```bash
node make-review.cjs      # 生成 ui-review.html（手机+平板并排，可交互）
```
然后用浏览器打开 `ui-review.html`。

> ⚠️ `ui-review.html` 是**内嵌快照**，改完 `app/index.html` 必须重新生成，否则看到的是旧版。
> 它已被 gitignore（生成物不入库）。

### 打包 APK

```bash
cd android
bash setup-tools.sh       # 首次：下载工具链（~153MB）
bash build.sh             # 出包到 android/out/
```

改界面只需替换 `android/src/assets/index.html`（即 `app/index.html`）后重跑 `build.sh`，**不需要动 Java**。

### 跑验证

```bash
cd app
npm --prefix ../qa i      # 首次：装 playwright-core
NODE_PATH=../qa/node_modules node qa.cjs
NODE_PATH=../qa/node_modules node qa-v5.cjs
```

---

## 构建方式说明（无 Android SDK）

本机没有 Android SDK / Gradle / Android Studio，靠 JDK + 以下四个工具直接产出 APK：

| 工具 | 用途 |
|---|---|
| `aapt2` | 编译资源、生成 R.java、打包 |
| `r8.jar`（内含 D8） | class → dex |
| `android.jar` | 编译用桩（用 Robolectric `android-all` 替代官方源，后者常 403） |
| `uber-apk-signer.jar` | 对齐 + 签名 |

流程：`aapt2 compile+link → javac --release 11 → d8 → 塞 classes.dex → 签名`

**坑（改构建脚本前先看）**
- 传给 aapt2/javac/java 的路径必须 `cygpath -m` 转成 `E:/...`，用 `/e/...` 原生工具会报"找不到文件"
- javac 必须 `--release 11`，默认高版本字节码 d8 拒绝解析
- `aapt2.exe` 必须在构建时的当前工作目录（Windows ProcessBuilder 搜索顺序）
- 用 `DocumentsContract` 而非 `DocumentFile`（项目无 androidx）；tree Uri 不能直接当 CREATE_DOCUMENT 的 parent

---

## ⚠️ 签名密钥

`android/_tools/svgview.keystore`（alias `svgview`）**不在 git 里**，但极其重要：

**丢了它，就无法给已安装用户推送覆盖更新** —— Android 拒绝用不同密钥签名的同名包覆盖安装，用户只能卸载重装并丢失数据。

请自行备份到安全的地方（网盘 / U 盘）。

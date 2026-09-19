package com.svgview.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 注入到 WebView 的 JS 桥接对象，在页面中通过 <code>window.SvgViewNative</code> 访问。
 *
 * <p>页面侧约定的回调入口为 <code>window.SvgViewBridge</code>（文件选择）与
 * <code>window.SvgApp</code>（生命周期 / 导出目录）：
 * <ul>
 *   <li><code>onFilePicked(name, base64)</code>、<code>onPickFailed(reason)</code></li>
 *   <li><code>onExportDirPicked(type, displayPath)</code>、<code>onExportDirFailed(type, reason)</code></li>
 * </ul>
 *
 * <p>导出目录使用 SAF（Storage Access Framework）目录树授权：
 * 通过 <code>ACTION_OPEN_DOCUMENT_TREE</code> 取得 tree Uri 并
 * {@link ContentResolver#takePersistableUriPermission(Uri, int)} 持久化，
 * 之后用 {@link DocumentsContract#createDocument(ContentResolver, Uri, String, String)}
 * 在目录内建文件写入（等价于 androidx 的 DocumentFile，但不引入外部依赖）。
 */
public class WebAppInterface {

    private static final String TAG = "SvgViewBridge";

    /** 导出目录设置的 SharedPreferences 文件名。 */
    public static final String PREF_FILE = "svgview_prefs";

    /** SVG 导出目录的持久化 Uri 键。 */
    public static final String PREF_KEY_EXPORT_DIR_SVG = "export_dir_svg";

    /** PNG 导出目录的持久化 Uri 键。 */
    public static final String PREF_KEY_EXPORT_DIR_PNG = "export_dir_png";

    /** 导出类型：SVG。 */
    public static final String TYPE_SVG = "svg";

    /** 导出类型：PNG。 */
    public static final String TYPE_PNG = "png";

    /** URI 授权读写位掩码，选目录与恢复写权限时都要用。 */
    private static final int RW_FLAGS =
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    /** 列出目录子项时允许的最大条目数，防止异常 provider 返回海量列表。 */
    private static final int MAX_CHILD_SCAN = 4096;

    private final Activity activity;
    private final WebView webView;

    /**
     * 导出目录不可用时抛出，调用方据此回退到默认下载目录。
     */
    private static final class ExportDirUnavailableException extends Exception {

        /** 机器可读的原因代码。 */
        final String reason;

        /** 是否属于「授权失效」类问题（决定要不要清掉已存的设置）。 */
        final boolean permissionLost;

        ExportDirUnavailableException(String reason, boolean permissionLost) {
            super(reason);
            this.reason = reason;
            this.permissionLost = permissionLost;
        }
    }

    /**
     * @param activity 宿主 Activity，用于权限/文件/Toast 等上下文
     * @param webView  目标 WebView，用于回调 JS
     */
    public WebAppInterface(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
    }

    // ------------------------------------------------------------------
    // 基础桥接能力
    // ------------------------------------------------------------------

    /**
     * 弹出原生 Toast。
     *
     * @param message 提示文本
     */
    @JavascriptInterface
    public void toast(final String message) {
        runOnUi(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(activity, message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    /**
     * 返回应用版本名（读取 manifest 中的真实 versionName，便于页面做能力判断）。
     *
     * @return 版本名，取不到时返回 "unknown"
     */
    @JavascriptInterface
    public String getAppVersion() {
        try {
            PackageManager pm = activity.getPackageManager();
            PackageInfo info = pm.getPackageInfo(activity.getPackageName(), 0);
            return info.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            Log.w(TAG, "cannot read version name", e);
            return "unknown";
        }
    }

    /**
     * 打开系统文件选择器，选择结果通过 JS 回调返回。
     */
    @JavascriptInterface
    public void openFile() {
        runOnUi(new Runnable() {
            @Override
            public void run() {
                if (activity instanceof MainActivity) {
                    ((MainActivity) activity).launchFilePicker();
                }
            }
        });
    }

    /**
     * 控制屏幕常亮。
     *
     * @param on true 保持常亮
     */
    @JavascriptInterface
    public void keepScreenOn(boolean on) {
        if (activity instanceof MainActivity) {
            ((MainActivity) activity).keepScreenOn(on);
        }
    }

    // ------------------------------------------------------------------
    // 导出目录（需求：让「导出路径」设置真正生效）
    // ------------------------------------------------------------------

    /**
     * 返回当前导出目录的人类可读路径；未设置（或授权已失效）时返回空串。
     *
     * @param type 导出类型，取值 "svg" | "png"，其他值按 svg 处理
     * @return 可读路径（如 {@code 内部存储/Download/SVGStudio}），未设置返回 ""
     */
    @JavascriptInterface
    public String getExportDir(String type) {
        final String t = normalizeType(type);
        SharedPreferences prefs = safePrefs();
        if (prefs == null) {
            return "";
        }
        String raw = prefs.getString(prefKey(t), "");
        if (raw == null || raw.length() == 0) {
            return "";
        }
        Uri treeUri;
        try {
            treeUri = Uri.parse(raw);
        } catch (RuntimeException e) {
            Log.w(TAG, "broken export dir uri", e);
            clearExportDir(t);
            return "";
        }
        if (!hasPersistedPermission(treeUri)) {
            Log.w(TAG, "export dir permission lost: " + t);
            clearExportDir(t);
            return "";
        }
        String display = describeTreeUri(treeUri);
        return display == null ? "" : display;
    }

    /**
     * 打开系统文件夹选择器（SAF），用户选完后把结果回调给 JS。
     *
     * @param type 导出类型，取值 "svg" | "png"
     */
    @JavascriptInterface
    public void pickExportDir(String type) {
        final String t = normalizeType(type);
        runOnUi(new Runnable() {
            @Override
            public void run() {
                if (activity instanceof MainActivity) {
                    ((MainActivity) activity).launchExportDirPicker(t);
                } else {
                    deliverExportDirFailed(t, "unsupported_host");
                }
            }
        });
    }

    /**
     * 处理 <code>ACTION_OPEN_DOCUMENT_TREE</code> 的返回结果：持久化授权、存入
     * SharedPreferences，并把可读路径回调给 JS。
     *
     * <p>由 {@link MainActivity#onActivityResult} 调用。
     *
     * @param type       导出类型 "svg" | "png"
     * @param resultCode Activity 结果码
     * @param data       结果 Intent，可能为 null
     */
    public void handleExportDirResult(String type, int resultCode, Intent data) {
        final String t = normalizeType(type);
        if (resultCode != Activity.RESULT_OK) {
            deliverExportDirFailed(t, "cancelled");
            return;
        }
        if (data == null || data.getData() == null) {
            deliverExportDirFailed(t, "no_result");
            return;
        }
        final Uri treeUri = data.getData();
        boolean persisted = persistPermission(treeUri, data);
        SharedPreferences prefs = safePrefs();
        if (prefs == null) {
            deliverExportDirFailed(t, "storage_error");
            return;
        }
        prefs.edit().putString(prefKey(t), treeUri.toString()).apply();
        Log.i(TAG, "export dir saved: " + t + "=" + treeUri + " persisted=" + persisted);
        deliverExportDirPicked(t, describeTreeUri(treeUri));
    }

    /**
     * 把 <code>onExportDirPicked</code> 结果投递给 JS。
     *
     * @param type    导出类型
     * @param display 可读目录路径
     */
    private void deliverExportDirPicked(String type, String display) {
        final String js = "(function(){try{"
                + "if(window.SvgApp&&window.SvgApp.onExportDirPicked){"
                + "window.SvgApp.onExportDirPicked(" + jsString(type) + ","
                + jsString(display) + ");}}catch(e){}})()";
        eval(js);
    }

    /**
     * 把 <code>onExportDirFailed</code> 结果投递给 JS。
     *
     * @param type   导出类型
     * @param reason 失败原因代码
     */
    private void deliverExportDirFailed(String type, String reason) {
        final String js = "(function(){try{"
                + "if(window.SvgApp&&window.SvgApp.onExportDirFailed){"
                + "window.SvgApp.onExportDirFailed(" + jsString(type) + ","
                + jsString(reason) + ");}}catch(e){}})()";
        eval(js);
    }

    /**
     * 保存 SVG：优先写入用户指定的导出目录，失败/未设置时回退到下载目录。
     *
     * @param text     SVG 源码文本
     * @param fileName 目标文件名，为空时使用时间戳命名
     */
    @JavascriptInterface
    public void saveSvg(String text, String fileName) {
        if (text == null || text.length() == 0) {
            toast("没有可保存的内容");
            return;
        }
        String name = resolveName(fileName, "svg");
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        String saved;
        try {
            saved = writeToExportDir(bytes, TYPE_SVG, name, "image/svg+xml");
        } catch (ExportDirUnavailableException e) {
            saved = fallbackSave(e, TYPE_SVG, bytes, name, "image/svg+xml");
            if (saved == null) {
                toast("保存失败：默认目录也不可写");
                return;
            }
        } catch (Exception e) {
            Log.e(TAG, "write svg failed", e);
            toast("保存失败：" + e.getMessage());
            return;
        }
        Log.i(TAG, "svg saved: " + saved);
        toast("已保存到 " + saved);
    }

    /**
     * 保存 PNG：优先写入用户指定的导出目录，失败/未设置时回退到下载目录。
     *
     * @param base64Data 图片数据，允许带 <code>data:image/png;base64,</code> 前缀
     * @param fileName   目标文件名，为空时使用时间戳命名
     * @return 写入后的可读路径描述，失败返回空串
     */
    @JavascriptInterface
    public String savePng(String base64Data, String fileName) {
        if (base64Data == null || base64Data.length() == 0) {
            toast("没有可保存的图片数据");
            return "";
        }
        String payload = base64Data;
        int comma = payload.indexOf(',');
        if (comma >= 0 && comma < 64) {
            payload = payload.substring(comma + 1);
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(payload, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            Log.e(TAG, "invalid base64 png", e);
            toast("图片数据解析失败");
            return "";
        }
        String name = resolveName(fileName, "png");
        String saved;
        try {
            saved = writeToExportDir(bytes, TYPE_PNG, name, "image/png");
        } catch (ExportDirUnavailableException e) {
            saved = fallbackSave(e, TYPE_PNG, bytes, name, "image/png");
            if (saved == null) {
                // 页面会把空串渲染成「PNG 保存失败」，这里不再重复提示
                return "";
            }
        } catch (Exception e) {
            Log.e(TAG, "write png failed", e);
            return "";
        }
        Log.i(TAG, "png saved: " + saved);
        return saved;
    }

    /**
     * 导出目录不可用时的统一降级：写默认目录 + 明确告知用户。
     *
     * @param cause 触发降级的原因
     * @param type  导出类型
     * @param bytes 文件内容
     * @param name  文件名
     * @param mime  MIME 类型
     * @return 默认目录内的可读写位置描述，彻底失败返回 null
     */
    private String fallbackSave(ExportDirUnavailableException cause, String type,
                                byte[] bytes, String name, String mime) {
        boolean unset = !cause.permissionLost && "not_set".equals(cause.reason);
        if (cause.permissionLost) {
            // 授权已被回收：清掉记录，让 UI 下次查询时回到「未设置」状态
            clearExportDir(type);
        }
        Log.w(TAG, "export dir unavailable (" + cause.reason + "), fallback to default");
        String saved;
        try {
            saved = writeToDownloads(bytes, name, mime);
        } catch (Exception e) {
            Log.e(TAG, "fallback write failed", e);
            return null;
        }
        if (!unset) {
            toast("导出目录不可用（" + describeReason(cause.reason) + "），已改存到 " + saved);
        }
        return saved;
    }

    // ------------------------------------------------------------------
    // 文件读取 / 回调
    // ------------------------------------------------------------------

    /**
     * 读取 Uri 内容并以 base64 形式回调给 JS。在后台线程执行读取以免阻塞 UI。
     *
     * @param uri 用户选择的文件 Uri
     */
    public void readUriAndDeliver(final Uri uri) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String name = queryDisplayName(uri);
                byte[] bytes = readAllBytes(uri);
                if (bytes == null) {
                    deliverPickFailure("read_error");
                    return;
                }
                String encoded = Base64.encodeToString(bytes, Base64.NO_WRAP);
                final String js = "javascript:(function(){"
                        + "if(window.SvgViewBridge&&window.SvgViewBridge.onFilePicked){"
                        + "window.SvgViewBridge.onFilePicked(" + jsString(name) + ","
                        + jsString(encoded) + ");}})()";
                runOnUi(new Runnable() {
                    @Override
                    public void run() {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                            webView.evaluateJavascript(js.replaceFirst("^javascript:", ""), null);
                        } else {
                            webView.loadUrl(js);
                        }
                    }
                });
            }
        }).start();
    }

    /**
     * 通知 JS 文件选择失败。
     *
     * @param reason 失败原因代码
     */
    public void deliverPickFailure(String reason) {
        final String js = "javascript:(function(){"
                + "if(window.SvgViewBridge&&window.SvgViewBridge.onPickFailed){"
                + "window.SvgViewBridge.onPickFailed(" + jsString(reason) + ");}})()";
        runOnUi(new Runnable() {
            @Override
            public void run() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    webView.evaluateJavascript(js.replaceFirst("^javascript:", ""), null);
                } else {
                    webView.loadUrl(js);
                }
            }
        });
    }

    // ------------------------------------------------------------------
    // 导出目录内部实现
    // ------------------------------------------------------------------

    /**
     * 归一化导出类型：只有 "png" 会被识别为 PNG，其余（含 null）按 SVG 处理。
     *
     * @param type 页面传入的类型串
     * @return {@link #TYPE_SVG} 或 {@link #TYPE_PNG}
     */
    private static String normalizeType(String type) {
        if (type != null && TYPE_PNG.equalsIgnoreCase(type.trim())) {
            return TYPE_PNG;
        }
        return TYPE_SVG;
    }

    /**
     * @param type 已归一化的导出类型
     * @return 对应的 SharedPreferences 键
     */
    private static String prefKey(String type) {
        return TYPE_PNG.equals(type) ? PREF_KEY_EXPORT_DIR_PNG : PREF_KEY_EXPORT_DIR_SVG;
    }

    /**
     * 取 SharedPreferences，失败返回 null（不应发生，但保持防御式写法）。
     *
     * @return prefs 实例或 null
     */
    private SharedPreferences safePrefs() {
        try {
            return activity.getSharedPreferences(PREF_FILE, Activity.MODE_PRIVATE);
        } catch (Exception e) {
            Log.w(TAG, "cannot open prefs", e);
            return null;
        }
    }

    /**
     * 清除某种类型的导出目录设置。
     *
     * @param type 已归一化的导出类型
     */
    private void clearExportDir(String type) {
        SharedPreferences prefs = safePrefs();
        if (prefs != null) {
            prefs.edit().remove(prefKey(type)).apply();
        }
    }

    /**
     * 从保存的 Uri 取出偏好设置中的树 Uri。未设置时返回 null。
     *
     * @param type 已归一化的导出类型
     * @return tree Uri 或 null
     */
    private Uri loadExportDirUri(String type) {
        SharedPreferences prefs = safePrefs();
        if (prefs == null) {
            return null;
        }
        String raw = prefs.getString(prefKey(type), "");
        if (raw == null || raw.length() == 0) {
            return null;
        }
        try {
            return Uri.parse(raw);
        } catch (RuntimeException e) {
            Log.w(TAG, "broken export dir uri", e);
            return null;
        }
    }

    /**
     * 对 tree Uri 申请持久化授权。
     *
     * <p>优先请求读写双权限；若系统只授予了其中一部分（部分文件管理器行为不一致），
     * 退而求其次持久化实际拿到的那一部分，避免整次设置失败。
     *
     * @param treeUri 用户选择的目录树 Uri
     * @param result  选择器回传的 Intent，可能为 null
     * @return true 表示持久化成功
     */
    private boolean persistPermission(Uri treeUri, Intent result) {
        int granted = 0;
        if (result != null) {
            granted = result.getFlags() & RW_FLAGS;
        }
        ContentResolver resolver = activity.getContentResolver();
        try {
            resolver.takePersistableUriPermission(treeUri, RW_FLAGS);
            return true;
        } catch (SecurityException fullError) {
            Log.w(TAG, "persist RW rejected, retry with granted subset=" + granted, fullError);
            if (granted != 0 && granted != RW_FLAGS) {
                try {
                    resolver.takePersistableUriPermission(treeUri, granted);
                    return true;
                } catch (SecurityException partialError) {
                    Log.w(TAG, "persist subset rejected", partialError);
                }
            }
            return false;
        } catch (RuntimeException e) {
            Log.w(TAG, "takePersistableUriPermission failed", e);
            return false;
        }
    }

    /**
     * 判断某个 tree Uri 的写权限是否仍在持久化列表中。
     *
     * @param treeUri 目录树 Uri
     * @return true 表示仍有可写授权
     */
    private boolean hasPersistedPermission(Uri treeUri) {
        if (treeUri == null) {
            return false;
        }
        try {
            List<UriPermission> perms = activity.getContentResolver().getPersistedUriPermissions();
            if (perms == null || perms.isEmpty()) {
                return false;
            }
            for (int i = 0; i < perms.size(); i++) {
                UriPermission p = perms.get(i);
                if (p != null && treeUri.equals(p.getUri()) && p.isWritePermission()) {
                    return true;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "cannot read persisted permissions", e);
        }
        return false;
    }

    /**
     * 把 tree Uri 转成人能认出来的路径。绝不返回 <code>content://</code> 原始串。
     *
     * @param treeUri 目录树 Uri
     * @return 可读路径描述
     */
    private String describeTreeUri(Uri treeUri) {
        String display = queryDisplayName(treeUri);
        if (display == null || display.length() == 0 || "unknown".equals(display)) {
            display = "";
        }
        String authority = treeUri.getAuthority();
        String docId = "";
        try {
            String id = DocumentsContract.getTreeDocumentId(treeUri);
            if (id != null) {
                docId = id;
            }
        } catch (Exception e) {
            Log.w(TAG, "cannot read tree document id", e);
        }

        if ("com.android.externalstorage.documents".equals(authority) && docId.indexOf(':') > 0) {
            int colon = docId.indexOf(':');
            String storage = docId.substring(0, colon);
            String rel = docId.substring(colon + 1);
            String root = "primary".equals(storage) ? "内部存储" : storage;
            if (rel.length() > 0) {
                return root + "/" + rel;
            }
            if (display.length() > 0) {
                return root + "/" + display;
            }
            return root;
        }
        if (authority != null && authority.startsWith("com.android.providers.downloads")) {
            if (display.length() > 0 && !"downloads".equalsIgnoreCase(display)) {
                return "下载目录/" + display;
            }
            return "下载目录";
        }
        if (display.length() > 0) {
            return display;
        }
        if (docId.length() > 0) {
            return docId;
        }
        return "已选择的导出目录";
    }

    /**
     * 写入用户指定的导出目录。任何一步不可用都以
     * {@link ExportDirUnavailableException} 抛出，交由调用方降级。
     *
     * @param bytes 文件内容
     * @param type  导出类型
     * @param name  文件名
     * @param mime  MIME 类型
     * @return 可读的落盘位置描述
     * @throws ExportDirUnavailableException 目录未设置 / 授权失效 / 写入失败
     */
    private String writeToExportDir(byte[] bytes, String type, String name, String mime)
            throws ExportDirUnavailableException {
        Uri treeUri = loadExportDirUri(type);
        if (treeUri == null) {
            throw new ExportDirUnavailableException("not_set", false);
        }
        if (!hasPersistedPermission(treeUri)) {
            throw new ExportDirUnavailableException("permission_lost", true);
        }
        ContentResolver resolver = activity.getContentResolver();
        OutputStream out = null;
        Uri created = null;
        boolean ok = false;
        try {
            String finalName = resolveUniqueName(resolver, treeUri, name);
            created = DocumentsContract.createDocument(resolver, treeUri, mime, finalName);
            if (created == null) {
                throw new IOException("createDocument returned null");
            }
            out = resolver.openOutputStream(created);
            if (out == null) {
                throw new IOException("openOutputStream returned null");
            }
            out.write(bytes);
            out.flush();
            ok = true;
            return describeTreeUri(treeUri) + "/" + finalName;
        } catch (SecurityException e) {
            Log.w(TAG, "export dir security error", e);
            throw new ExportDirUnavailableException("permission_lost", true);
        } catch (IOException e) {
            Log.w(TAG, "export dir io error", e);
            throw new ExportDirUnavailableException("io_error", false);
        } catch (IllegalArgumentException e) {
            Log.w(TAG, "export dir uri rejected", e);
            throw new ExportDirUnavailableException("bad_uri", true);
        } catch (IllegalStateException e) {
            Log.w(TAG, "export dir state error", e);
            throw new ExportDirUnavailableException("provider_error", false);
        } catch (UnsupportedOperationException e) {
            Log.w(TAG, "export dir unsupported", e);
            throw new ExportDirUnavailableException("unsupported", false);
        } finally {
            if (out != null) {
                try {
                    out.close();
                } catch (Exception ignored) {
                    // 关闭失败无需处理
                }
            }
            if (!ok && created != null) {
                // 写了一半失败：把半成品删掉，避免留垃圾文件
                try {
                    DocumentsContract.deleteDocument(resolver, created);
                } catch (Exception ignored) {
                    // 删除失败无需处理
                }
            }
        }
    }

    /**
     * 列出目录内已有文件名，用于冲突检测。列表失败时返回空集合（等价于「当作不存在」）。
     *
     * @param resolver ContentResolver
     * @param treeUri  目录树 Uri
     * @return 已有文件名集合
     */
    private Set<String> listChildNames(ContentResolver resolver, Uri treeUri) {
        Set<String> names = new HashSet<String>();
        Cursor cursor = null;
        try {
            String docId = DocumentsContract.getTreeDocumentId(treeUri);
            Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId);
            cursor = resolver.query(children,
                    new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},
                    null, null, null);
            if (cursor == null) {
                return names;
            }
            int idx = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME);
            if (idx < 0) {
                return names;
            }
            int count = 0;
            while (cursor.moveToNext() && count < MAX_CHILD_SCAN) {
                String value = cursor.getString(idx);
                if (value != null && value.length() > 0) {
                    names.add(value);
                }
                count++;
            }
        } catch (Exception e) {
            Log.w(TAG, "cannot list export dir children", e);
        } finally {
            if (cursor != null) {
                try {
                    cursor.close();
                } catch (Exception ignored) {
                    // 关闭失败无需处理
                }
            }
        }
        return names;
    }

    /**
     * 处理同名冲突：已存在则返回 <code>name (1).ext</code> 形式的下一个可用名。
     *
     * @param resolver ContentResolver
     * @param treeUri  目录树 Uri
     * @param name     期望文件名
     * @return 不冲突的文件名
     */
    private String resolveUniqueName(ContentResolver resolver, Uri treeUri, String name) {
        Set<String> existing = listChildNames(resolver, treeUri);
        if (existing.isEmpty() || !containsIgnoreCase(existing, name)) {
            return name;
        }
        String base = name;
        String ext = "";
        int dot = name.lastIndexOf('.');
        if (dot > 0) {
            base = name.substring(0, dot);
            ext = name.substring(dot);
        }
        for (int i = 1; i < 1000; i++) {
            String candidate = base + " (" + i + ")" + ext;
            if (!containsIgnoreCase(existing, candidate)) {
                return candidate;
            }
        }
        return base + " (" + System.currentTimeMillis() + ")" + ext;
    }

    /**
     * 忽略大小写判断集合是否包含目标串（文件系统同名判定不区分大小写）。
     *
     * @param set   文件名集合
     * @param value 目标文件名
     * @return true 表示已存在
     */
    private static boolean containsIgnoreCase(Set<String> set, String value) {
        if (set == null || value == null) {
            return false;
        }
        String target = value.toLowerCase(Locale.US);
        java.util.Iterator<String> it = set.iterator();
        while (it.hasNext()) {
            String item = it.next();
            if (item != null && target.equals(item.toLowerCase(Locale.US))) {
                return true;
            }
        }
        return false;
    }

    /**
     * 把原因代码翻译成中文，用于降级 toast。
     *
     * @param reason 机器可读原因
     * @return 说明文本
     */
    private static String describeReason(String reason) {
        if ("permission_lost".equals(reason)) {
            return "目录授权已失效";
        }
        if ("bad_uri".equals(reason)) {
            return "目录已不可用";
        }
        if ("provider_error".equals(reason)) {
            return "文件管理器异常";
        }
        if ("unsupported".equals(reason)) {
            return "该目录不支持写入";
        }
        if ("io_error".equals(reason)) {
            return "写入被拒绝";
        }
        return "目录不可用";
    }

    // ------------------------------------------------------------------
    // 默认目录写入（保持原有行为）
    // ------------------------------------------------------------------

    /**
     * 把字节写入下载目录：Android 10+ 走 MediaStore，旧版本走应用专属外部目录。
     *
     * @param bytes 文件内容
     * @param name  文件名
     * @return 写入位置描述
     */
    private String writeToDownloads(byte[] bytes, String name, String mime) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            ContentResolver resolver = activity.getContentResolver();
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new IllegalStateException("MediaStore insert returned null");
            }
            OutputStream out = resolver.openOutputStream(uri);
            if (out == null) {
                throw new IllegalStateException("MediaStream openOutputStream returned null");
            }
            try {
                out.write(bytes);
            } finally {
                out.close();
            }
            ContentValues done = new ContentValues();
            done.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, done, null, null);
            return "下载目录/" + name;
        }
        File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("cannot create download dir");
        }
        File target = new File(dir, name);
        FileOutputStream out = new FileOutputStream(target);
        try {
            out.write(bytes);
        } finally {
            out.close();
        }
        return "下载目录/" + name;
    }

    /**
     * 规范化导出文件名：补齐扩展名，空名字用时间戳兜底。
     *
     * @param fileName 页面传入的文件名
     * @param ext      期望扩展名（不含点）
     * @return 规范后的文件名
     */
    private String resolveName(String fileName, String ext) {
        String name = (fileName == null || fileName.trim().length() == 0)
                ? "svgview_" + System.currentTimeMillis() + "." + ext
                : fileName.trim();
        // 文件名里不能出现路径分隔符，否则 DocumentsContract 会拒绝
        name = name.replace('/', '_').replace('\\', '_');
        String suffix = "." + ext;
        if (!name.toLowerCase(Locale.US).endsWith(suffix)) {
            name = name + suffix;
        }
        return name;
    }

    // ------------------------------------------------------------------
    // 工具方法
    // ------------------------------------------------------------------

    /**
     * 查询 Uri 对应的展示文件名。
     *
     * @param uri 文件 / 目录 Uri
     * @return 文件名，取不到时返回 "unknown"
     */
    private String queryDisplayName(Uri uri) {
        String name = "unknown";
        Cursor cursor = null;
        try {
            cursor = activity.getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String value = cursor.getString(idx);
                    if (value != null && value.length() > 0) {
                        name = value;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "cannot query display name", e);
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return name;
    }

    /**
     * 完整读取 Uri 内容。
     *
     * @param uri 文件 Uri
     * @return 字节数组，失败返回 null
     */
    private byte[] readAllBytes(Uri uri) {
        java.io.InputStream in = null;
        try {
            in = activity.getContentResolver().openInputStream(uri);
            if (in == null) {
                return null;
            }
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = in.read(chunk)) != -1) {
                buffer.write(chunk, 0, read);
            }
            return buffer.toByteArray();
        } catch (Exception e) {
            Log.e(TAG, "read uri failed", e);
            return null;
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Exception ignored) {
                    // 关闭失败无需处理
                }
            }
        }
    }

    /**
     * 在 WebView 里执行一段 JS（主线程）。
     *
     * @param js 已构造好的脚本（不带 javascript: 前缀）
     */
    private void eval(final String js) {
        if (webView == null) {
            return;
        }
        runOnUi(new Runnable() {
            @Override
            public void run() {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    webView.evaluateJavascript(js, null);
                } else {
                    webView.loadUrl("javascript:" + js);
                }
            }
        });
    }

    /**
     * 在 UI 线程执行任务。
     *
     * @param task 待执行任务
     */
    private void runOnUi(Runnable task) {
        activity.runOnUiThread(task);
    }

    /**
     * 把任意字符串转成带引号的 JS 字符串字面量。
     *
     * <p>完整 JSON 风格转义。路径里可能有中文、空格、引号与换行，
     * 漏转义会直接导致 evaluateJavascript 抛 SyntaxError。
     *
     * @param value 原始字符串
     * @return 可安全嵌入 JS 的字面量
     */
    private static String jsString(String value) {
        if (value == null) {
            return "\"\"";
        }
        StringBuilder sb = new StringBuilder(value.length() + 16);
        sb.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '\\':
                    sb.append("\\\\");
                    break;
                case '"':
                    sb.append("\\\"");
                    break;
                case '/':
                    // 防止内容里出现 "</script>" 提前闭合宿主脚本上下文
                    sb.append("\\/");
                    break;
                case '\b':
                    sb.append("\\b");
                    break;
                case '\f':
                    sb.append("\\f");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else if (c == '\u2028') {
                        // 行分隔符：JSON 合法但 JS 源码里会断行
                        sb.append("\\u2028");
                    } else if (c == '\u2029') {
                        sb.append("\\u2029");
                    } else {
                        sb.append(c);
                    }
                    break;
            }
        }
        sb.append('"');
        return sb.toString();
    }

    /**
     * 工具方法：把 UTF-8 字节还原为字符串，供调试与后续扩展使用。
     *
     * @param bytes 输入字节
     * @return 解码后的字符串
     */
    public static String utf8(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }
}

package com.svgview.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.Locale;

/**
 * SVG 查看器的唯一 Activity。
 *
 * <p>职责：
 * <ul>
 *   <li>托管一个全屏 {@link WebView}，加载 assets 下的单文件 HTML 应用；</li>
 *   <li>开启 JS / DOM Storage，供页面内部使用；</li>
 *   <li>关闭 WebView 自带缩放控件（页面自己做手势缩放）；</li>
 *   <li>通过 {@link WebAppInterface} 向 JS 暴露原生能力；</li>
 *   <li>拦截外部跳转，保证应用始终停留在本地页面内；</li>
 *   <li>返回键优先回退 WebView 历史栈，无历史才退出。</li>
 * </ul>
 */
public class MainActivity extends Activity {

    private static final String TAG = "SvgView";

    /** assets 中的应用入口页面。 */
    public static final String ASSET_URL = "file:///android_asset/index.html";

    /** 文件选择请求码，回调在 {@link #onActivityResult} 中处理。 */
    public static final int REQUEST_PICK_FILE = 1001;

    /** SVG 导出目录选择请求码（SAF ACTION_OPEN_DOCUMENT_TREE）。 */
    public static final int REQUEST_PICK_DIR_SVG = 1002;

    /** PNG 导出目录选择请求码（SAF ACTION_OPEN_DOCUMENT_TREE）。 */
    public static final int REQUEST_PICK_DIR_PNG = 1003;

    private WebView webView;
    private WebAppInterface jsBridge;

    /** 页面是否已完成首次加载（boot 完成，window.SvgViewBridge 可用）。 */
    private boolean pageReady = false;

    /** 页面就绪前收到的外部文档 Uri，就绪后补投。 */
    private Uri pendingIncomingUri = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = (WebView) findViewById(R.id.webview);

        // 调试期开启远程调试，正式发行可置 false
        WebView.setWebContentsDebuggingEnabled(true);

        configureSettings(webView.getSettings());
        configureClient(webView);

        jsBridge = new WebAppInterface(this, webView);
        // UI 侧按 SvgViewNative -> Android 顺序探测宿主，两个名字都注入同一个对象，
        // 保证走的是首选分支（SvgViewNative），同时兼容只认 Android 的调用方。
        webView.addJavascriptInterface(jsBridge, "SvgViewNative");
        webView.addJavascriptInterface(jsBridge, "Android");

        webView.loadUrl(ASSET_URL);

        // 支持从文件管理器「用其他应用打开」直接把 .svg 交给本应用
        handleIncomingIntent(getIntent());
    }

    /**
     * 处理启动/新建 Intent：若携带 content:// 或 file:// 数据，直接喂给 JS。
     *
     * @param intent 可能为 null
     */
    private void handleIncomingIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        // VIEW 动作才处理，避免 MAIN 启动被误判
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) {
            return;
        }
        Uri uri = intent.getData();
        if (uri == null) {
            return;
        }
        Log.i(TAG, "incoming document: " + uri);
        if (jsBridge == null) {
            return;
        }
        // 等页面 boot 完成再投递，否则 window.SvgViewBridge 尚未挂上
        pendingIncomingUri = uri;
        webView.post(new Runnable() {
            @Override
            public void run() {
                if (pageReady && pendingIncomingUri != null) {
                    jsBridge.readUriAndDeliver(pendingIncomingUri);
                    pendingIncomingUri = null;
                }
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    /**
     * 配置 WebView 设置项：开启 JS 与 DOM 存储，关闭系统缩放控件。
     *
     * @param settings WebView 的设置对象，非 null
     */
    private void configureSettings(WebSettings settings) {
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // 页面自行实现手势缩放，隐藏系统缩放按钮
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setDefaultTextEncodingName("UTF-8");
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
    }

    /**
     * 配置 WebViewClient：把外部跳转拦在应用内。
     *
     * @param view 目标 WebView，非 null
     */
    private void configureClient(WebView view) {
        view.setWebViewClient(new WebViewClient() {

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return shouldStayInsideApp(url);
            }

            @Override
            public void onPageFinished(WebView v, String url) {
                Log.i(TAG, "page finished: " + url);
                pageReady = true;

                // WebView 本身就从状态栏下方开始布局，Push 0 避免二次留白。
                // 若页面尚未定义 window.SvgApp，evaluateJavascript 结果被忽略即可。
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    v.evaluateJavascript(
                            "(function(){try{"
                                    + "if(window.SvgApp&&window.SvgApp.setStatusBarHeight){"
                                    + "window.SvgApp.setStatusBarHeight(0);}"
                                    + "return true;}catch(e){return false;}})()",
                            null);
                }

                // 页面就绪，补投启动前收到的外部文档
                if (pendingIncomingUri != null && jsBridge != null) {
                    Uri uri = pendingIncomingUri;
                    pendingIncomingUri = null;
                    jsBridge.readUriAndDeliver(uri);
                }
            }
        });
    }

    /**
     * 判断 URL 是否应被拦截（返回 true 表示已消费，WebView 不再加载）。
     * 本应用纯离线运行，因此除本地资源外一律拦截。
     *
     * @param url 待加载的地址，可能为 null
     * @return true 表示拦截该跳转
     */
    private boolean shouldStayInsideApp(String url) {
        if (url == null || url.length() == 0) {
            return false;
        }
        String lower = url.toLowerCase(Locale.US);
        boolean isLocal = lower.startsWith("file:///android_asset/")
                || lower.startsWith("file:///android_res/")
                || lower.startsWith("about:blank")
                || lower.startsWith("javascript:")
                || lower.startsWith("data:")
                || lower.startsWith("blob:");
        if (isLocal) {
            return false;
        }
        Log.w(TAG, "blocked external navigation: " + url);
        Toast.makeText(this, "本应用为离线应用，已阻止外部跳转", Toast.LENGTH_SHORT).show();
        return true;
    }

    /**
     * 供 {@link WebAppInterface} 调用，打开文件选择器。
     * 结果在 {@link #onActivityResult} 中回到 JS。
     */
    void launchFilePicker() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        // 国产文件管理器对 .svg 的 MIME 映射常常缺失，放宽后用后缀兜底
        intent.putExtra(Intent.EXTRA_MIME_TYPES,
                new String[]{
                        "image/svg+xml",
                        "application/xml",
                        "text/xml",
                        "text/plain",
                        "application/octet-stream"});
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
        try {
            startActivityForResult(Intent.createChooser(intent, "选择 SVG 文件"), REQUEST_PICK_FILE);
        } catch (ActivityNotFoundException e) {
            Log.e(TAG, "no file manager available", e);
            Toast.makeText(this, "未找到文件管理器", Toast.LENGTH_SHORT).show();
            if (jsBridge != null) {
                jsBridge.deliverPickFailure("no_file_manager");
            }
        }
    }

    /**
     * 打开系统文件夹选择器（SAF），让用户为指定类型的导出挑选目录。
     * 结果在 {@link #onActivityResult} 中交由 {@link WebAppInterface} 持久化并回调 JS。
     *
     * @param type "svg" | "png"
     */
    void launchExportDirPicker(String type) {
        boolean isPng = WebAppInterface.TYPE_PNG.equals(type);
        int requestCode = isPng ? REQUEST_PICK_DIR_PNG : REQUEST_PICK_DIR_SVG;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        // 读写 + 可持久化，三者缺一会导致重启后无法再写入该目录
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            String title = isPng ? "选择 PNG 导出目录" : "选择 SVG 导出目录";
            startActivityForResult(Intent.createChooser(intent, title), requestCode);
        } catch (ActivityNotFoundException e) {
            Log.e(TAG, "no document manager available", e);
            Toast.makeText(this, "未找到可用的文件管理器", Toast.LENGTH_SHORT).show();
            if (jsBridge != null) {
                jsBridge.handleExportDirResult(type, RESULT_CANCELED, null);
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (jsBridge == null) {
            return;
        }
        switch (requestCode) {
            case REQUEST_PICK_DIR_SVG:
                // 授权持久化与 SharedPreferences 落盘都在 Bridge 里完成
                jsBridge.handleExportDirResult(WebAppInterface.TYPE_SVG, resultCode, data);
                return;
            case REQUEST_PICK_DIR_PNG:
                jsBridge.handleExportDirResult(WebAppInterface.TYPE_PNG, resultCode, data);
                return;
            case REQUEST_PICK_FILE:
                if (resultCode != RESULT_OK || data == null || data.getData() == null) {
                    jsBridge.deliverPickFailure("cancelled");
                    return;
                }
                jsBridge.readUriAndDeliver(data.getData());
                return;
            default:
                Log.w(TAG, "unknown activity result: " + requestCode);
        }
    }

    @Override
    public void onBackPressed() {
        // 先问页面：返回 true 表示界面自己消费了（例如收起浮层、退出编辑态）
        if (webView != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webView.evaluateJavascript(
                    "(function(){try{return !!(window.SvgApp&&window.SvgApp.onBackPressed"
                            + "&&window.SvgApp.onBackPressed());}catch(e){return false;}})()",
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            runOnUiThread(new Runnable() {
                                @Override
                                public void run() {
                                    if (!"true".equals(value)) {
                                        doGoBack();
                                    }
                                }
                            });
                        }
                    });
            return;
        }
        doGoBack();
    }

    /**
     * 页面未消费返回键时的兜底：WebView 有历史就回退，否则真正退出。
     */
    private void doGoBack() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            ViewGroup parent = (ViewGroup) webView.getParent();
            if (parent != null) {
                parent.removeView(webView);
            }
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /**
     * 保持屏幕常亮，方便长时间查看图形。
     */
    void keepScreenOn(boolean on) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (on) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            }
        });
    }
}

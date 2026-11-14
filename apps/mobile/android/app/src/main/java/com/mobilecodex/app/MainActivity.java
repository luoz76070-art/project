package com.mobilecodex.app;

import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.ServerPath;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HotUpdatePlugin.class);
        registerPlugin(ApkUpdatePlugin.class);
        registerPlugin(SecureCredentialsPlugin.class);
        registerPlugin(VoiceRecorderPlugin.class);
        registerPlugin(ClipboardPlugin.class);
        registerPlugin(DiagnosticExportPlugin.class);
        registerPlugin(ProductWindowPlugin.class);
        registerPlugin(AttentionPlugin.class);
        super.onCreate(savedInstanceState);
        boolean dark = ProductWindow.systemDark(this);
        ProductWindow.apply(this, dark, ProductWindow.lastBackground(this, dark));
        WebView webView = getBridge().getWebView();
        webView.getSettings().setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        if (Build.VERSION.SDK_INT >= 35) ProductWindow.installInsets(webView);
        // Sheets and the thread drawer close first; otherwise leave the app running in the background.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                webView.evaluateJavascript("window.dispatchEvent(new Event('product-back', {cancelable:true}))",
                    allowed -> { if (!"false".equals(allowed)) moveTaskToBack(true); });
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PluginHandle handle = getBridge() == null ? null : getBridge().getPlugin("Attention");
        if (handle != null && handle.getInstance() instanceof AttentionPlugin) ((AttentionPlugin) handle.getInstance()).handleIntent(intent);
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        // uiMode is handled in place (see the manifest), so the page is told directly.
        PluginHandle handle = getBridge() == null ? null : getBridge().getPlugin("ProductWindow");
        if (handle != null && handle.getInstance() instanceof ProductWindowPlugin) {
            ((ProductWindowPlugin) handle.getInstance()).systemAppearanceChanged(ProductWindow.systemDark(this));
        }
    }

    @Override
    protected void load() {
        String bundlePath = HotUpdateStore.startupBundlePath(this);
        if (bundlePath != null) {
            bridgeBuilder.setServerPath(new ServerPath(ServerPath.PathType.BASE_PATH, bundlePath));
        }
        super.load();
    }
}

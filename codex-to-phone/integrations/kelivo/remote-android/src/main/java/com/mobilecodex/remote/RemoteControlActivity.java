package com.mobilecodex.remote;

import android.content.res.Resources;
import android.os.Bundle;
import android.os.Build;
import androidx.activity.OnBackPressedCallback;

import com.mobilecodex.app.MainActivity;

/** Reuses the remote's bridge, startup bundle policy and six plugin registrations. */
public final class RemoteControlActivity extends MainActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        Resources.Theme applicationTheme = getResources().newTheme();
        applicationTheme.setTo(getApplication().getTheme());
        registerPlugin(ProductHostPlugin.class);
        try {
            super.onCreate(savedInstanceState);
            try { ProductWindowAppearance.apply(this, ProductNavigation.appearance(this)); }
            catch (org.json.JSONException ignored) { /* Keep the launch theme if preferences are unreadable. */ }
            getBridge().getWebView().getSettings().setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
            // Edge-to-edge is enforced on the current Android target. Capacitor's
            // default margins exclude the IME, leaving the composer underneath it.
            if (Build.VERSION.SDK_INT >= 35) ProductWindowInsets.install(getBridge().getWebView());
            getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
                @Override public void handleOnBackPressed() {
                    getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new Event('product-back', {cancelable:true})) && window.dispatchEvent(new Event('product-before-navigate', {cancelable:true}))",
                        allowed -> { if ("true".equals(allowed)) ProductNavigation.showHost(RemoteControlActivity.this, "ai"); }
                    );
                }
            });
        } finally {
            // BridgeActivity sets the Application theme as well as its own.
            getApplication().getTheme().setTo(applicationTheme);
        }
    }

}

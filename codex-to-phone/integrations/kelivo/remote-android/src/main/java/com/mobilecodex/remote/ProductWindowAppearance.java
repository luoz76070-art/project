package com.mobilecodex.remote;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import org.json.JSONObject;

/** Flutter owns the palette, including the native area outside the WebView. */
public final class ProductWindowAppearance {
    private ProductWindowAppearance() {}

    @SuppressWarnings("deprecation")
    public static void apply(Activity activity, JSONObject appearance) {
        boolean dark = appearance.optBoolean("dark", "dark".equals(appearance.optString("mode")));
        JSONObject colors = appearance.optJSONObject("colors");
        String background = colors == null ? "" : colors.optString("background");
        // Accept the same opaque RGB contract as the Web palette.
        int color = background.matches("#[0-9a-fA-F]{6}") ? Color.parseColor(background)
            : Color.parseColor(dark ? "#121213" : "#f7f7f7");
        Window window = activity.getWindow();
        window.getDecorView().setBackgroundColor(color);
        window.setStatusBarColor(Build.VERSION.SDK_INT >= 35 ? Color.TRANSPARENT : color);
        // Android24/25 cannot draw dark navigation icons on a light background.
        window.setNavigationBarColor(Build.VERSION.SDK_INT >= 35 ? Color.TRANSPARENT
            : Build.VERSION.SDK_INT >= 26 ? color : Color.BLACK);
        if (Build.VERSION.SDK_INT >= 28) window.setNavigationBarDividerColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
}

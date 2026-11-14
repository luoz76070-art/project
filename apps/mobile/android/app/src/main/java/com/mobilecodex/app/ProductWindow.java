package com.mobilecodex.app;

import android.app.Activity;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/** The page owns the palette; the Activity paints the system bars to match it. */
final class ProductWindow {
    static final String LIGHT_BACKGROUND = "#f6f4ef";
    static final String DARK_BACKGROUND = "#111317";

    private ProductWindow() {}

    static boolean systemDark(Context context) {
        return (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    @SuppressWarnings("deprecation")
    static void apply(Activity activity, boolean dark, String background) {
        int color = background != null && background.matches("#[0-9a-fA-F]{6}") ? Color.parseColor(background)
            : Color.parseColor(dark ? DARK_BACKGROUND : LIGHT_BACKGROUND);
        Window window = activity.getWindow();
        window.getDecorView().setBackgroundColor(color);
        window.setStatusBarColor(Build.VERSION.SDK_INT >= 35 ? Color.TRANSPARENT : color);
        // Android 24/25 cannot draw dark navigation icons on a light background.
        window.setNavigationBarColor(Build.VERSION.SDK_INT >= 35 ? Color.TRANSPARENT
            : Build.VERSION.SDK_INT >= 26 ? color : Color.BLACK);
        if (Build.VERSION.SDK_INT >= 28) window.setNavigationBarDividerColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark || Build.VERSION.SDK_INT < 26);
    }

    /** Edge-to-edge is enforced on Android 15; keep the page, and its composer, clear of bars and IME. */
    static void installInsets(View webView) {
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            ViewGroup.MarginLayoutParams margins = (ViewGroup.MarginLayoutParams) view.getLayoutParams();
            if (margins.leftMargin != insets.left || margins.topMargin != insets.top
                || margins.rightMargin != insets.right || margins.bottomMargin != insets.bottom) {
                margins.setMargins(insets.left, insets.top, insets.right, insets.bottom);
                view.setLayoutParams(margins);
            }
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(webView);
    }
}

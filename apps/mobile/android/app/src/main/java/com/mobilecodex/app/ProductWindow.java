package com.mobilecodex.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.content.res.Resources;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;

import androidx.annotation.RequiresApi;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** The page owns the palette; the Activity paints the system bars to match it. */
final class ProductWindow {
    static final String LIGHT_BACKGROUND = "#f6f4ef";
    static final String DARK_BACKGROUND = "#111317";

    // Android 12 devices that Material's DynamicColors.isDynamicColorAvailable() accepts;
    // the former Kelivo host (Flutter dynamic_color) used that check. Android 13+ always qualifies.
    private static final Set<String> DYNAMIC_COLOR_MANUFACTURERS = new HashSet<>(Arrays.asList(
        "fcnt", "google", "hmd global", "infinix", "infinix mobility limited", "itel", "kyocera", "lenovo", "lge",
        "motorola", "nothing", "oneplus", "oppo", "realme", "samsung", "sharp", "sony", "tcl", "tecno",
        "tecno mobile limited", "vivo", "xiaomi"));
    private static final Set<String> DYNAMIC_COLOR_BRANDS = new HashSet<>(Arrays.asList("asus", "jio"));
    private static final String PREFS = "MobiCodexWindow";

    private ProductWindow() {}

    static boolean dynamicColorAvailable() {
        if (Build.VERSION.SDK_INT >= 33) return true;
        if (Build.VERSION.SDK_INT < 31) return false;
        return DYNAMIC_COLOR_MANUFACTURERS.contains(Build.MANUFACTURER.toLowerCase(Locale.ROOT))
            || DYNAMIC_COLOR_BRANDS.contains(Build.BRAND.toLowerCase(Locale.ROOT));
    }

    /**
     * The system's tonal palettes in dynamic_color's order: accent1, accent2, accent3, neutral1,
     * neutral2, each at tones 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100. Null when the
     * device has no dynamic colour.
     */
    static String[] systemPalette(Context context) {
        return Build.VERSION.SDK_INT >= 31 && dynamicColorAvailable() ? palette(context.getResources()) : null;
    }

    @RequiresApi(31)
    private static String[] palette(Resources resources) {
        int[] ids = {
            android.R.color.system_accent1_1000, android.R.color.system_accent1_900, android.R.color.system_accent1_800,
            android.R.color.system_accent1_700, android.R.color.system_accent1_600, android.R.color.system_accent1_500,
            android.R.color.system_accent1_400, android.R.color.system_accent1_300, android.R.color.system_accent1_200,
            android.R.color.system_accent1_100, android.R.color.system_accent1_50, android.R.color.system_accent1_10,
            android.R.color.system_accent1_0,
            android.R.color.system_accent2_1000, android.R.color.system_accent2_900, android.R.color.system_accent2_800,
            android.R.color.system_accent2_700, android.R.color.system_accent2_600, android.R.color.system_accent2_500,
            android.R.color.system_accent2_400, android.R.color.system_accent2_300, android.R.color.system_accent2_200,
            android.R.color.system_accent2_100, android.R.color.system_accent2_50, android.R.color.system_accent2_10,
            android.R.color.system_accent2_0,
            android.R.color.system_accent3_1000, android.R.color.system_accent3_900, android.R.color.system_accent3_800,
            android.R.color.system_accent3_700, android.R.color.system_accent3_600, android.R.color.system_accent3_500,
            android.R.color.system_accent3_400, android.R.color.system_accent3_300, android.R.color.system_accent3_200,
            android.R.color.system_accent3_100, android.R.color.system_accent3_50, android.R.color.system_accent3_10,
            android.R.color.system_accent3_0,
            android.R.color.system_neutral1_1000, android.R.color.system_neutral1_900, android.R.color.system_neutral1_800,
            android.R.color.system_neutral1_700, android.R.color.system_neutral1_600, android.R.color.system_neutral1_500,
            android.R.color.system_neutral1_400, android.R.color.system_neutral1_300, android.R.color.system_neutral1_200,
            android.R.color.system_neutral1_100, android.R.color.system_neutral1_50, android.R.color.system_neutral1_10,
            android.R.color.system_neutral1_0,
            android.R.color.system_neutral2_1000, android.R.color.system_neutral2_900, android.R.color.system_neutral2_800,
            android.R.color.system_neutral2_700, android.R.color.system_neutral2_600, android.R.color.system_neutral2_500,
            android.R.color.system_neutral2_400, android.R.color.system_neutral2_300, android.R.color.system_neutral2_200,
            android.R.color.system_neutral2_100, android.R.color.system_neutral2_50, android.R.color.system_neutral2_10,
            android.R.color.system_neutral2_0,
        };
        String[] colors = new String[ids.length];
        for (int i = 0; i < ids.length; i++) colors[i] = String.format(Locale.ROOT, "#%06x", resources.getColor(ids[i], null) & 0xFFFFFF);
        return colors;
    }

    /** The background the page last painted, so the next launch starts in the same colour. */
    static String lastBackground(Context context, boolean dark) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(dark ? "darkBackground" : "lightBackground", dark ? DARK_BACKGROUND : LIGHT_BACKGROUND);
    }

    static void rememberBackground(Context context, boolean dark, String background) {
        if (background == null || !background.matches("#[0-9a-fA-F]{6}")) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(dark ? "darkBackground" : "lightBackground", background).apply();
    }

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

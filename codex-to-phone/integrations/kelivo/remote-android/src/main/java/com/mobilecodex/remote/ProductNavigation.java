package com.mobilecodex.remote;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import org.json.JSONException;
import org.json.JSONObject;

/** Local navigation/appearance only. Does not access either task transport. */
public final class ProductNavigation {
    public static final String TAB_EXTRA = "com.mobilecodex.product.tab";
    private ProductNavigation() {}
    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("product-shell-v1", Context.MODE_PRIVATE);
    }
    public static String tab(Context context) {
        return preferences(context).getString("tab", "ai");
    }
    public static boolean setTab(Context context, String tab) {
        if (!"ai".equals(tab) && !"settings".equals(tab)) return false;
        preferences(context).edit().putString("tab", tab).apply();
        return true;
    }
    public static void appearance(Context context, JSONObject appearance) {
        preferences(context).edit().putString("appearance", appearance.toString()).apply();
    }
    public static JSONObject appearance(Context context) throws JSONException {
        JSONObject appearance = new JSONObject(preferences(context).getString("appearance", "{}"));
        JSONObject palettes = appearance.optJSONObject("palettes");
        if ("system".equals(appearance.optString("mode")) && palettes != null) {
            boolean dark = (context.getResources().getConfiguration().uiMode
                & android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES;
            JSONObject colors = palettes.optJSONObject(dark ? "dark" : "light");
            if (colors != null) appearance.put("dark", dark).put("colors", colors);
        }
        return appearance;
    }
    public static void openSettings(Context context, boolean value) {
        preferences(context).edit().putBoolean("openSettings", value).remove("openUpdates").apply();
    }
    public static void openUpdates(Context context) {
        preferences(context).edit().putBoolean("openUpdates", true).remove("openSettings").apply();
    }
    public static boolean takeOpenUpdates(Context context) {
        boolean value = preferences(context).getBoolean("openUpdates", false);
        preferences(context).edit().remove("openUpdates").apply();
        return value;
    }
    public static boolean takeOpenSettings(Context context) {
        boolean value = preferences(context).getBoolean("openSettings", false);
        preferences(context).edit().remove("openSettings").apply();
        return value;
    }
    public static void showHost(Activity activity, String tab) {
        if (!setTab(activity, tab)) throw new IllegalArgumentException("Unknown product tab");
        Intent intent = new Intent().setClassName(activity.getPackageName(), "com.psyche.kelivo.MainActivity");
        intent.putExtra(TAB_EXTRA, tab);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        activity.startActivity(intent);
        activity.finish();
    }
}

package com.mobilecodex.remote;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ProductHost")
public final class ProductHostPlugin extends Plugin {
    private android.content.SharedPreferences appearancePreferences;
    private android.content.SharedPreferences.OnSharedPreferenceChangeListener appearanceListener;
    @Override public void load() {
        appearancePreferences = getContext().getSharedPreferences("product-shell-v1", android.content.Context.MODE_PRIVATE);
        appearanceListener = (preferences, key) -> {
            if (!"appearance".equals(key)) return;
            publishAppearance();
        };
        appearancePreferences.registerOnSharedPreferenceChangeListener(appearanceListener);
    }
    private void publishAppearance() {
        try {
            // Capacitor copies event data onto Event; wrap it explicitly so
            // the Web listener receives the same detail contract as tests.
            org.json.JSONObject event = new org.json.JSONObject().put("detail", ProductNavigation.appearance(getContext()));
            getActivity().runOnUiThread(() -> ProductWindowAppearance.apply(getActivity(), event.optJSONObject("detail")));
            getBridge().triggerWindowJSEvent("product-appearance-changed", event.toString());
        } catch (org.json.JSONException ignored) { /* Keep the last valid appearance. */ }
    }
    @Override protected void handleOnConfigurationChanged(android.content.res.Configuration configuration) {
        publishAppearance();
    }
    @Override protected void handleOnResume() { publishAppearance(); }
    @Override protected void handleOnDestroy() {
        if (appearancePreferences != null && appearanceListener != null) {
            appearancePreferences.unregisterOnSharedPreferenceChangeListener(appearanceListener);
        }
        super.handleOnDestroy();
    }
    @PluginMethod public void getState(PluginCall call) {
        try {
            JSObject state = new JSObject();
            state.put("revision", 1);
            state.put("openSettings", ProductNavigation.takeOpenSettings(getContext()));
            state.put("openUpdates", ProductNavigation.takeOpenUpdates(getContext()));
            state.put("appearance", ProductNavigation.appearance(getContext()));
            org.json.JSONObject migration = ProductHandoffStore.migrationState(getContext());
            state.put("handoff", migration.get("handoff"));
            state.put("handoffMigration", migration.get("handoffMigration"));
            call.resolve(state);
        } catch (Exception error) { call.reject("Unable to read product appearance", error); }
    }
    @PluginMethod public void handoff(PluginCall call) {
        try {
            String id = call.getString("id");
            String action = call.getString("action");
            org.json.JSONObject state;
            if ("submit".equals(action)) state = ProductHandoffStore.begin(getContext(), id, call.getData());
            else if ("confirm".equals(action)) state = ProductHandoffStore.confirm(getContext(), id, call.getString("clientMessageId"), call.getString("acceptance"));
            else if ("close".equals(action)) { ProductHandoffStore.close(getContext(), id); state = null; }
            else if ("ackMigration".equals(action)) state = ProductHandoffStore.ackMigration(getContext(), id,
                call.getString("expectedDigest"), call.getString("storeId"), call.getString("workItemUid"));
            else throw new IllegalArgumentException("Unknown handoff action");
            JSObject result = new JSObject();
            result.put("handoff", state == null ? org.json.JSONObject.NULL : state);
            call.resolve(result);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }
    @PluginMethod public void navigate(PluginCall call) {
        String tab = call.getString("tab");
        if (!"ai".equals(tab) && !"settings".equals(tab)) {
            call.reject("Unknown product tab"); return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                ProductNavigation.showHost(getActivity(), tab);
                call.resolve();
            } catch (Exception error) { call.reject("Unable to open product tab", error); }
        });
    }
}

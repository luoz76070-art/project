package com.mobilecodex.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ProductWindow")
public class ProductWindowPlugin extends Plugin {
    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(state(ProductWindow.systemDark(getContext())));
    }

    @PluginMethod
    public void apply(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        String background = call.getString("background", "");
        getActivity().runOnUiThread(() -> {
            ProductWindow.apply(getActivity(), dark, background);
            call.resolve();
        });
    }

    void systemAppearanceChanged(boolean dark) {
        notifyListeners("systemAppearance", state(dark), true);
    }

    private static JSObject state(boolean dark) {
        JSObject result = new JSObject();
        result.put("dark", dark);
        return result;
    }
}

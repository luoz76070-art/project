package com.mobilecodex.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Arrays;

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
        ProductWindow.rememberBackground(getContext(), dark, background);
        getActivity().runOnUiThread(() -> {
            ProductWindow.apply(getActivity(), dark, background);
            call.resolve();
        });
    }

    void systemAppearanceChanged(boolean dark) {
        notifyListeners("systemAppearance", state(dark), true);
    }

    private JSObject state(boolean dark) {
        JSObject result = new JSObject();
        result.put("dark", dark);
        String[] palette = ProductWindow.systemPalette(getContext());
        if (palette != null) result.put("palette", new JSArray(Arrays.asList(palette)));
        return result;
    }
}

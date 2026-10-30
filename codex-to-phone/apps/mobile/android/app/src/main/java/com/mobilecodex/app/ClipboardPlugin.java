package com.mobilecodex.app;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Clipboard")
public class ClipboardPlugin extends Plugin {
    @PluginMethod
    public void write(PluginCall call) {
        String text = call.getString("string");
        if (text == null) { call.reject("clipboard_text_required"); return; }
        bridge.executeOnMainThread(() -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard == null) { call.reject("clipboard_unavailable"); return; }
                clipboard.setPrimaryClip(ClipData.newPlainText("Mobile Codex", text));
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("clipboard_unavailable");
            }
        });
    }
}

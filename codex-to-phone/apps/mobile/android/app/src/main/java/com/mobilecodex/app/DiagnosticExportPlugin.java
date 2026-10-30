package com.mobilecodex.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "DiagnosticExport")
public class DiagnosticExportPlugin extends Plugin {
    private static final int MAX_BYTES = 65536;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private boolean pending = false;

    private static byte[] reportBytes(String text) throws Exception {
        if (text == null || text.length() > MAX_BYTES) throw new IllegalArgumentException();
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES || !"mobile-codex-message-diagnostics-v2".equals(new JSONObject(text).optString("schema"))) {
            throw new IllegalArgumentException();
        }
        return bytes;
    }

    @PluginMethod
    public synchronized void save(PluginCall call) {
        if (pending) { call.reject("diagnostic_export_busy"); return; }
        try { reportBytes(call.getString("text")); }
        catch (Exception error) { call.reject("diagnostic_file_invalid"); return; }
        pending = true;
        bridge.executeOnMainThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, "mobile-codex-diagnostics-" + System.currentTimeMillis() + ".json");
                startActivityForResult(call, intent, "documentSelected");
            } catch (RuntimeException error) { finish(); call.reject("diagnostic_export_unavailable"); }
        });
    }

    @ActivityCallback
    private void documentSelected(PluginCall call, ActivityResult result) {
        if (call == null) { finish(); return; }
        if (result.getResultCode() != Activity.RESULT_OK) {
            finish(); JSObject response = new JSObject(); response.put("status", "cancelled"); call.resolve(response); return;
        }
        Intent data = result.getData();
        if (data == null || data.getData() == null) { finish(); call.reject("diagnostic_export_failed"); return; }
        executor.execute(() -> {
            try {
                byte[] bytes = reportBytes(call.getString("text"));
                try (OutputStream output = getContext().getContentResolver().openOutputStream(data.getData(), "wt")) {
                    if (output == null) throw new IllegalStateException();
                    output.write(bytes);
                }
                JSObject response = new JSObject(); response.put("status", "saved"); call.resolve(response);
            } catch (Exception error) { call.reject("diagnostic_export_failed"); }
            finally { finish(); }
        });
    }

    private synchronized void finish() { pending = false; }

    @Override
    protected void handleOnDestroy() { executor.shutdown(); super.handleOnDestroy(); }
}

package com.mobilecodex.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Objects;

/** F1 bridge: the page configures and starts the notification service and hears which thread a tap opened. */
@CapacitorPlugin(name = "Attention", permissions = {
    @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
})
public class AttentionPlugin extends Plugin {
    @Override
    public void load() {
        AttentionConfig.appVisible = true;
        handleIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnResume() { AttentionConfig.appVisible = true; }

    @Override
    protected void handleOnPause() { AttentionConfig.appVisible = false; }

    @PluginMethod
    public void configure(PluginCall call) {
        String endpoint = call.getString("endpoint", ""), token = call.getString("token", "");
        boolean changed = !Objects.equals(endpoint, AttentionConfig.endpoint) || !Objects.equals(token, AttentionConfig.token);
        AttentionConfig.endpoint = endpoint;
        AttentionConfig.token = token;
        AttentionConfig.finished = Boolean.TRUE.equals(call.getBoolean("finished", true));
        AttentionConfig.approvals = Boolean.TRUE.equals(call.getBoolean("approvals", true));
        if (!AttentionConfig.ready() || (!AttentionConfig.finished && !AttentionConfig.approvals)) AttentionService.stop();
        else if (changed) AttentionService.reconnect();
        call.resolve(state());
    }

    @PluginMethod
    public void start(PluginCall call) {
        JSObject result = state();
        if (!AttentionConfig.ready() || (!AttentionConfig.finished && !AttentionConfig.approvals)) {
            result.put("started", false);
            call.resolve(result);
            return;
        }
        try {
            AttentionService.start(getContext());
            result.put("started", true);
        } catch (IllegalStateException | SecurityException error) {
            // Android 12+ refuses foreground services started from the background; the next send retries.
            result.put("started", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        AttentionService.stop();
        call.resolve();
    }

    @PluginMethod
    public void setViewing(PluginCall call) {
        AttentionConfig.viewingKey = call.getString("key", null);
        call.resolve();
    }

    @PluginMethod
    public void permission(PluginCall call) { call.resolve(state()); }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) { call.resolve(state()); return; }
        requestPermissionForAlias("notifications", call, "permissionResult");
    }

    @PermissionCallback
    private void permissionResult(PluginCall call) { call.resolve(state()); }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = Build.VERSION.SDK_INT >= 26
            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve();
    }

    /** A notification tap: the page opens the thread; retained until a listener is attached. */
    void handleIntent(Intent intent) {
        if (intent == null || !AttentionNotifications.OPEN_ACTION.equals(intent.getAction())) return;
        String key = intent.getStringExtra(AttentionNotifications.EXTRA_KEY);
        if (key == null) return;
        JSObject open = new JSObject();
        open.put("key", key);
        open.put("title", intent.getStringExtra(AttentionNotifications.EXTRA_TITLE));
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(AttentionNotifications.EXTRA_KEY);
        notifyListeners("open", open, true);
    }

    private JSObject state() {
        JSObject result = new JSObject();
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        String permission;
        if (Build.VERSION.SDK_INT < 33) permission = enabled ? "granted" : "denied";
        else {
            PermissionState value = getPermissionState("notifications");
            permission = value == PermissionState.GRANTED ? (enabled ? "granted" : "denied") : value == PermissionState.DENIED ? "denied" : "prompt";
        }
        result.put("permission", permission);
        result.put("running", AttentionService.running());
        return result;
    }
}

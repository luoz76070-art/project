package com.mobilecodex.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/** "允许一次" / "拒绝" on an approval notification: one POST to the gateway, then show what happened. */
public class AttentionActionReceiver extends BroadcastReceiver {
    private static final Set<Integer> ANSWERED = Collections.synchronizedSet(new HashSet<>());

    static boolean consumeAnswered(int notificationId) { return ANSWERED.remove(notificationId); }

    @Override
    public void onReceive(Context context, Intent intent) {
        String key = intent.getStringExtra("key"), request = intent.getStringExtra("request");
        String decision = intent.getStringExtra("decision"), title = intent.getStringExtra("title");
        int notificationId = intent.getIntExtra("notification", 0);
        if (key == null || request == null || decision == null) return;
        String heading = title == null ? "MobiCodex" : title;
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            String text;
            try {
                int code = AttentionConfig.ready() ? respond(key, request, decision) : -1;
                text = code == 200 ? ("allow".equals(decision) ? "已允许，任务继续" : "已拒绝")
                    : code == 410 ? "这一项已经处理过了"
                    : code == 409 ? "这一项要在 App 里处理"
                    : code == -1 ? "请打开 App 处理" : "没发出去，请打开 App 处理";
            } catch (IOException | JSONException error) {
                text = "没发出去，请打开 App 处理";
            }
            ANSWERED.add(notificationId);
            AttentionNotifications.outcome(app, notificationId, key, heading, text);
            pending.finish();
        }, "mobicodex-attention-action").start();
    }

    private static int respond(String key, String request, String decision) throws IOException, JSONException {
        HttpURLConnection http = (HttpURLConnection) new URL(AttentionConfig.url("/api/attention/respond")).openConnection();
        try {
            http.setRequestMethod("POST");
            http.setConnectTimeout(10_000);
            http.setReadTimeout(15_000);
            http.setDoOutput(true);
            http.setRequestProperty("Authorization", "Bearer " + AttentionConfig.token);
            http.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            byte[] body = new JSONObject().put("key", key).put("requestId", request).put("decision", decision).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = http.getOutputStream()) { out.write(body); }
            return http.getResponseCode();
        } finally {
            http.disconnect();
        }
    }
}

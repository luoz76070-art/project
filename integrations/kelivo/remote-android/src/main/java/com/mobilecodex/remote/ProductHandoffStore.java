package com.mobilecodex.remote;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** One private handoff. A durable unknown result is reserved before any network write. */
public final class ProductHandoffStore {
    private static final String KEY = "handoff";
    private ProductHandoffStore() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("product-handoff-v1", Context.MODE_PRIVATE);
    }

    public static synchronized JSONObject read(Context context) throws JSONException {
        String value = preferences(context).getString(KEY, null);
        return value == null ? null : new JSONObject(value);
    }

    private static void write(Context context, JSONObject value) {
        String json = value.toString();
        if (json.getBytes(StandardCharsets.UTF_8).length > 128 * 1024) {
            throw new IllegalArgumentException("交接内容过大，请缩短任务说明。");
        }
        if (!preferences(context).edit().putString(KEY, json).commit()) {
            throw new IllegalStateException("交接状态未能保存，请释放空间后重试。");
        }
    }

    private static String text(JSONObject value, String key, int maxBytes) throws JSONException {
        Object raw = value.get(key);
        if (!(raw instanceof String)) throw new IllegalArgumentException("Invalid handoff " + key);
        String result = (String) raw;
        if (result.isEmpty() || result.getBytes(StandardCharsets.UTF_8).length > maxBytes) {
            throw new IllegalArgumentException("Invalid handoff " + key);
        }
        return result;
    }

    private static JSONObject require(Context context, String id) throws JSONException {
        JSONObject current = read(context);
        if (current == null || !current.getString("id").equals(id)) {
            throw new IllegalStateException("交接已改变，请重新打开任务卡。");
        }
        return current;
    }

    public static synchronized JSONObject prepare(Context context, String body) throws JSONException {
        JSONObject input = new JSONObject().put("text", body);
        text(input, "text", 64 * 1024);
        if (body.trim().isEmpty()) throw new IllegalArgumentException("请选择任务说明。");
        JSONObject existing = read(context);
        if (existing != null) {
            // Repeated taps restore the same draft, never overwrite an edited or submitted handoff.
            if (existing.getString("status").equals("draft") && existing.getString("text").equals(body)) return existing;
            throw new IllegalStateException("电脑中已有交接，请先处理该任务卡。");
        }
        JSONObject draft = new JSONObject().put("revision", 1).put("id", UUID.randomUUID().toString())
            .put("status", "draft").put("text", body).put("createdAt", System.currentTimeMillis());
        write(context, draft);
        return draft;
    }

    public static synchronized JSONObject begin(Context context, String id, JSONObject input) throws JSONException {
        JSONObject current = require(context, id);
        if (!current.getString("status").equals("draft")) {
            throw new IllegalStateException("交接已提交或结果待确认，请勿重复发送。");
        }
        JSONObject supplied = input.getJSONObject("target");
        String threadId = text(supplied, "threadId", 128);
        if (!UUID.fromString(threadId).toString().equals(threadId)) throw new IllegalArgumentException("Invalid Desktop thread");
        JSONObject target = new JSONObject().put("scope", text(supplied, "scope", 4096))
            .put("threadId", threadId).put("title", text(supplied, "title", 4096));
        if (!supplied.isNull("cwd")) target.put("cwd", text(supplied, "cwd", 4096));
        String message = text(input, "message", 96 * 1024);
        if (message.trim().isEmpty()) throw new IllegalArgumentException("请选择任务说明或附件。");
        current.put("status", "uncertain").put("target", target).put("message", message).put("clientMessageId", id);
        // commit() must succeed before the caller is allowed to send. No token is copied here.
        write(context, current);
        return current;
    }

    public static synchronized JSONObject confirm(Context context, String id, String clientMessageId, String acceptance) throws JSONException {
        JSONObject current = require(context, id);
        if (!id.equals(clientMessageId) || !id.equals(current.optString("clientMessageId"))
            || current.getString("status").equals("draft")) throw new IllegalStateException("交接确认身份不匹配。");
        if (!"desktop".equals(acceptance) && !"queue".equals(acceptance)) throw new IllegalArgumentException("Invalid handoff receipt");
        if ("confirmed".equals(current.getString("status")) && "desktop".equals(current.optString("acceptance"))) return current;
        current.put("status", "confirmed").put("acceptance", acceptance);
        write(context, current);
        return current;
    }

    public static synchronized void close(Context context, String id) throws JSONException {
        JSONObject current = require(context, id);
        if (current.getString("status").equals("uncertain")) {
            throw new IllegalStateException("结果待确认，不能把关闭任务卡当作撤回或重新发送。");
        }
        if (!preferences(context).edit().remove(KEY).commit()) throw new IllegalStateException("交接状态未能保存。");
    }
}

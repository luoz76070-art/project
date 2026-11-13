package com.mobilecodex.remote;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

/** One private handoff. A durable unknown result is reserved before any network write. */
public final class ProductHandoffStore {
    private static final String KEY = "handoff";
    private static final String MIGRATION_BACKUP = "migration-backup";
    private ProductHandoffStore() {}

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("product-handoff-v1", Context.MODE_PRIVATE);
    }

    public static synchronized JSONObject read(Context context) throws JSONException {
        String value = preferences(context).getString(KEY, null);
        return value == null ? null : new JSONObject(value);
    }

    private static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte b : bytes) result.append(Character.forDigit((b & 255) >>> 4, 16)).append(Character.forDigit(b & 15, 16));
            return result.toString();
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }

    /** Snapshot and opaque digest must describe the same stored bytes. No credentials are included. */
    public static synchronized JSONObject migrationState(Context context) throws JSONException {
        String raw = preferences(context).getString(KEY, null);
        JSONObject handoff = raw == null ? null : new JSONObject(raw);
        JSONObject info = raw == null ? null : new JSONObject().put("version", 1)
            .put("id", handoff.getString("id")).put("digest", digest(raw));
        return new JSONObject().put("handoff", handoff == null ? JSONObject.NULL : handoff)
            .put("handoffMigration", info == null ? JSONObject.NULL : info);
    }

    private static void requireUuid(String value) {
        if (value == null || !UUID.fromString(value).toString().equals(value)) throw new IllegalArgumentException("Invalid migration identity");
    }

    /** Archive only after Relay import + read-back; unlike close this safely retains uncertain sends. */
    public static synchronized JSONObject ackMigration(Context context, String id, String expectedDigest, String storeId, String workItemUid) throws JSONException {
        requireUuid(id); requireUuid(storeId); requireUuid(workItemUid);
        if (expectedDigest == null || !expectedDigest.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid migration digest");
        SharedPreferences prefs = preferences(context);
        String previousBackup = prefs.getString(MIGRATION_BACKUP, null);
        if (previousBackup != null) {
            JSONObject previous = new JSONObject(previousBackup);
            if (id.equals(previous.optString("id"))) {
                if (!expectedDigest.equals(previous.optString("digest")) || !storeId.equals(previous.optString("storeId"))
                    || !workItemUid.equals(previous.optString("workItemUid"))) throw new IllegalStateException("迁移回执不匹配，旧记录已保留。");
                return read(context); // Lost ACK response: never remove a newer active handoff.
            }
        }
        String raw = prefs.getString(KEY, null);
        if (raw == null || !id.equals(new JSONObject(raw).optString("id")) || !expectedDigest.equals(digest(raw))) {
            throw new IllegalStateException("交接已改变，请保留原记录并重新核对迁移。");
        }
        String backup = new JSONObject().put("version", 1).put("id", id).put("digest", expectedDigest)
            .put("storeId", storeId).put("workItemUid", workItemUid).put("raw", raw).toString();
        if (backup.getBytes(StandardCharsets.UTF_8).length > 256 * 1024) throw new IllegalArgumentException("迁移备份过大，旧记录已保留。");
        if (!prefs.edit().putString(MIGRATION_BACKUP, backup).remove(KEY).commit()) {
            // Android can update memory before reporting a failed disk commit. Restore the active value too.
            SharedPreferences.Editor restore = prefs.edit().putString(KEY, raw);
            if (previousBackup == null) restore.remove(MIGRATION_BACKUP); else restore.putString(MIGRATION_BACKUP, previousBackup);
            restore.commit();
            throw new IllegalStateException("迁移确认未能保存，旧记录已保留，请重试。");
        }
        return read(context);
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

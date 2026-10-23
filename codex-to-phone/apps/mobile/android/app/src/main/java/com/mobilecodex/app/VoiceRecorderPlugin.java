package com.mobilecodex.app;

import android.Manifest;
import android.content.Context;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;

@CapacitorPlugin(name = "VoiceRecorder", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class VoiceRecorderPlugin extends Plugin {
    private static final int MAX_BYTES = 2 * 1024 * 1024;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaRecorder recorder;
    private File audio;
    private String sessionId;
    private String pendingId;
    private long started;
    private AudioManager audioManager;
    private AudioManager.OnAudioFocusChangeListener focusListener;
    private final Runnable limit = () -> finish(true, "");

    @Override
    public void load() {
        File directory = new File(getContext().getCacheDir(), "voice-input");
        File[] leftovers = directory.listFiles();
        if (leftovers != null) for (File file : leftovers) if (file.isFile()) file.delete();
    }

    @PluginMethod
    public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = call.getString("sessionId", "");
            if (!id.matches("[0-9a-f-]{36}") || recorder != null || pendingId != null) { call.reject("voice_recording_busy"); return; }
            pendingId = id;
            if (getPermissionState("microphone") != PermissionState.GRANTED) requestPermissionForAlias("microphone", call, "microphoneResult");
            else begin(call);
        });
    }

    @PermissionCallback
    private void microphoneResult(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                pendingId = null; call.reject("voice_microphone_denied"); return;
            }
            begin(call);
        });
    }

    @SuppressWarnings("deprecation") // Legacy constructor/focus API preserves Android 6 support.
    private void begin(PluginCall call) {
        String id = call.getString("sessionId", "");
        if (!id.equals(pendingId) || getActivity().isFinishing()) { call.reject("voice_cancelled"); return; }
        pendingId = null; sessionId = id;
        try {
            audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            focusListener = change -> { if (change < 0) handler.post(() -> { if (id.equals(sessionId)) finish(false, "voice_interrupted"); }); };
            if (audioManager == null || audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw new IllegalStateException();
            File directory = new File(getContext().getCacheDir(), "voice-input");
            if (!directory.isDirectory() && !directory.mkdir()) throw new IllegalStateException();
            audio = File.createTempFile("voice-", ".aac", directory);
            recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.AAC_ADTS);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);
            recorder.setAudioSamplingRate(16000);
            recorder.setAudioEncodingBitRate(48000);
            recorder.setOutputFile(audio.getAbsolutePath());
            recorder.setMaxDuration(120000);
            recorder.setMaxFileSize(MAX_BYTES);
            recorder.setOnInfoListener((source, what, extra) -> {
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) handler.post(() -> { if (source == recorder) finish(true, ""); });
            });
            recorder.setOnErrorListener((source, what, extra) -> handler.post(() -> { if (source == recorder) finish(false, "voice_recording_failed"); }));
            recorder.prepare(); recorder.start(); started = SystemClock.elapsedRealtime();
            handler.postDelayed(limit, 120000);
            call.resolve();
        } catch (Exception error) {
            cleanup(); call.reject("voice_recording_failed");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (sessionId != null && sessionId.equals(call.getString("sessionId"))) finish(true, "");
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = call.getString("sessionId");
            if (id != null && id.equals(pendingId)) pendingId = null;
            if (id != null && id.equals(sessionId)) finish(false, "voice_cancelled");
            call.resolve();
        });
    }

    private void finish(boolean keep, String error) {
        if (recorder == null) return;
        JSObject result = new JSObject(); result.put("sessionId", sessionId);
        try {
            recorder.stop();
            long duration = SystemClock.elapsedRealtime() - started;
            if (keep) {
                if (duration < 300 || audio == null || audio.length() < 16 || audio.length() > MAX_BYTES) throw new IllegalStateException();
                try (FileInputStream input = new FileInputStream(audio); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] chunk = new byte[8192]; int count;
                    while ((count = input.read(chunk)) != -1) {
                        if (output.size() + count > MAX_BYTES) throw new IllegalStateException();
                        output.write(chunk, 0, count);
                    }
                    result.put("dataBase64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                    result.put("durationMs", Math.min(duration, 121000));
                }
            }
        } catch (Exception failure) { error = keep ? "voice_recording_too_short" : error; }
        finally { cleanup(); }
        if (!error.isEmpty()) result.put("error", error);
        notifyListeners("finished", result);
    }

    @SuppressWarnings("deprecation")
    private void cleanup() {
        handler.removeCallbacks(limit);
        if (recorder != null) { try { recorder.release(); } catch (RuntimeException ignored) { } recorder = null; }
        if (audioManager != null) { audioManager.abandonAudioFocus(focusListener); audioManager = null; }
        if (audio != null) { audio.delete(); audio = null; }
        sessionId = null;
    }

    @Override
    protected void handleOnPause() {
        handler.post(() -> finish(false, "voice_interrupted"));
    }

    @Override
    protected void handleOnStop() {
        handler.post(() -> { pendingId = null; finish(false, "voice_interrupted"); });
    }

    @Override
    protected void handleOnDestroy() {
        handler.post(() -> { pendingId = null; cleanup(); });
    }
}

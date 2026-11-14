package com.mobilecodex.app;

import android.Manifest;
import android.content.Context;
import android.media.AudioManager;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.WindowManager;
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
import java.io.RandomAccessFile;

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
    // V5: a long recording goes out in pieces of about 30 s while it runs, so only a piece has to fit a request.
    private static final int SEGMENTED_MAX_BYTES = 8 * 1024 * 1024;
    private static final int MAX_PIECE_BYTES = 1024 * 1024;
    private static final int SAMPLE_RATE = 16000;
    private static final long TICK_MS = 100;
    private static final long MAX_SEGMENTED_MS = 600000;
    private boolean segmented;
    private long maxMs = 120000, shortestMs, longestMs;
    private long readOffset, framesSent, pieceStart;
    private int pieces;
    private final long[] tickTimes = new long[512];
    private final int[] tickAmps = new int[512];
    private int ticks;
    private final Runnable sampler = this::sample;

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
        int pieceMs = call.getInt("segmentMs", 0);
        segmented = pieceMs >= 10000 && pieceMs <= 60000;
        maxMs = segmented ? Math.max(30000, Math.min(call.getInt("maxMs", (int) MAX_SEGMENTED_MS), MAX_SEGMENTED_MS)) : 120000;
        shortestMs = pieceMs - 5000; longestMs = pieceMs + 5000;
        readOffset = 0; framesSent = 0; pieceStart = 0; pieces = 0; ticks = 0;
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
            recorder.setAudioSamplingRate(SAMPLE_RATE);
            recorder.setAudioEncodingBitRate(48000);
            recorder.setOutputFile(audio.getAbsolutePath());
            recorder.setMaxDuration((int) maxMs);
            recorder.setMaxFileSize(segmented ? SEGMENTED_MAX_BYTES : MAX_BYTES);
            recorder.setOnInfoListener((source, what, extra) -> {
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) handler.post(() -> { if (source == recorder) finish(true, ""); });
            });
            recorder.setOnErrorListener((source, what, extra) -> handler.post(() -> { if (source == recorder) finish(false, "voice_recording_failed"); }));
            recorder.prepare(); recorder.start(); started = SystemClock.elapsedRealtime();
            handler.postDelayed(limit, maxMs);
            JSObject begun = new JSObject();
            if (segmented) {
                handler.postDelayed(sampler, TICK_MS);
                // A long recording should not end because the screen went dark.
                getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                begun.put("segmented", true); begun.put("maxMs", maxMs);
            }
            call.resolve(begun);
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
        // A segmented recording that is interrupted keeps what was said so far instead of discarding minutes.
        boolean interrupted = segmented && "voice_interrupted".equals(error);
        if (interrupted) keep = true;
        try {
            recorder.stop();
            long duration = SystemClock.elapsedRealtime() - started;
            if (keep && segmented) {
                if (duration < 300) throw new IllegalStateException();
                int sent;
                do { sent = sendPiece(Long.MAX_VALUE, true); } while (sent > 0);
                if (sent < 0 || pieces == 0) throw new IllegalStateException();
                result.put("segments", pieces);
                result.put("durationMs", Math.min(duration, maxMs + 1000));
                if (interrupted) { result.put("interrupted", true); error = ""; }
            } else if (keep) {
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
        } catch (Exception failure) { error = interrupted ? "voice_interrupted" : keep ? "voice_recording_too_short" : error; }
        finally { cleanup(); }
        if (!error.isEmpty()) result.put("error", error);
        notifyListeners("finished", result);
    }

    // Every 100 ms: note how loud it was and, once a piece is long enough, send it at a quiet moment.
    private void sample() {
        if (recorder == null || !segmented) return;
        long now = SystemClock.elapsedRealtime() - started;
        int amp;
        try { amp = recorder.getMaxAmplitude(); } catch (RuntimeException failure) { amp = 0; }
        if (ticks == tickTimes.length) dropTicksBefore(tickTimes[ticks / 2]);
        tickTimes[ticks] = now; tickAmps[ticks++] = amp;
        long cut = AdtsSegments.cutAt(tickTimes, tickAmps, ticks, pieceStart, now, shortestMs, longestMs, TICK_MS);
        if (cut >= 0 && sendPiece(AdtsSegments.framesAt(cut, SAMPLE_RATE), false) < 0) { finish(false, "voice_recording_failed"); return; }
        handler.postDelayed(sampler, TICK_MS);
    }

    private void dropTicksBefore(long time) {
        int kept = 0;
        for (int i = 0; i < ticks; i++) if (tickTimes[i] >= time) { tickTimes[kept] = tickTimes[i]; tickAmps[kept++] = tickAmps[i]; }
        ticks = kept;
    }

    /**
     * Sends the whole frames recorded since the last piece, up to frame {@code untilFrame}, or all of them for
     * the last piece. Returns how many frames went out, 0 when none were ready, -1 when the file is unreadable.
     */
    private int sendPiece(long untilFrame, boolean last) {
        long wanted = last ? Integer.MAX_VALUE : untilFrame - framesSent;
        if (wanted <= 0 || audio == null) return 0;
        byte[] data;
        try (RandomAccessFile file = new RandomAccessFile(audio, "r")) {
            long available = file.length() - readOffset;
            if (available <= 0) return 0;
            data = new byte[(int) Math.min(available, MAX_PIECE_BYTES)];
            file.seek(readOffset); file.readFully(data);
        } catch (Exception failure) { return -1; }
        int[] whole;
        try { whole = AdtsSegments.whole(data, data.length, (int) Math.min(wanted, Integer.MAX_VALUE)); }
        catch (IllegalStateException broken) { return -1; }
        if (whole[0] == 0) return 0;
        long startMs = AdtsSegments.durationOf(framesSent, SAMPLE_RATE);
        readOffset += whole[1]; framesSent += whole[0];
        pieceStart = AdtsSegments.durationOf(framesSent, SAMPLE_RATE);
        dropTicksBefore(pieceStart);
        // A sliver after the last pause (under 0.3 s) carries no speech the provider would accept.
        if (last && pieces > 0 && AdtsSegments.durationOf(whole[0], SAMPLE_RATE) < 300) return 0;
        JSObject piece = new JSObject();
        piece.put("sessionId", sessionId);
        piece.put("index", pieces++);
        piece.put("startMs", startMs);
        piece.put("durationMs", AdtsSegments.durationOf(whole[0], SAMPLE_RATE));
        piece.put("dataBase64", Base64.encodeToString(data, 0, whole[1], Base64.NO_WRAP));
        notifyListeners("segment", piece);
        return whole[0];
    }

    @SuppressWarnings("deprecation")
    private void cleanup() {
        handler.removeCallbacks(limit);
        handler.removeCallbacks(sampler);
        if (segmented) {
            try { getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); } catch (RuntimeException ignored) { }
            segmented = false;
        }
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

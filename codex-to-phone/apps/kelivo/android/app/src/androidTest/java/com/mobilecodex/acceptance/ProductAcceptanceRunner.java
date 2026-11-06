package com.mobilecodex.acceptance;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.UiAutomation;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityWindowInfo;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Offline, emulator-only acceptance. Never included in the product APK. No send buttons are used. */
public final class ProductAcceptanceRunner extends Instrumentation {
    private final JSONArray steps = new JSONArray();
    private UiAutomation ui;
    private File evidence;
    private String scenario;

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        scenario = arguments.getString("scenario", "offline-navigation");
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        JSONObject report = new JSONObject();
        int code = Activity.RESULT_CANCELED;
        try {
            if (!("offline-navigation".equals(scenario) || "offline-device".equals(scenario) || "offline-recovery".equals(scenario) || "update-entry".equals(scenario)) || !"com.mobilecodex.kelivo.preview".equals(getTargetContext().getPackageName())
                || !(Build.FINGERPRINT.contains("generic") || Build.FINGERPRINT.contains("emulator") || "ranchu".equals(Build.HARDWARE))) {
                throw new IllegalStateException("Run only against the isolated preview emulator with an offline scenario");
            }
            File storage = getTargetContext().getExternalFilesDir(null);
            if (storage == null) throw new IllegalStateException("Emulator external storage unavailable");
            evidence = new File(storage, "product-acceptance/" + scenario + "-" + System.currentTimeMillis());
            if (!evidence.mkdirs() && !evidence.isDirectory()) throw new IllegalStateException("Evidence directory unavailable");
            ui = getUiAutomation();
            AccessibilityServiceInfo service = ui.getServiceInfo();
            service.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;
            ui.setServiceInfo(service);
            Intent launch = new Intent().setClassName(getTargetContext(), "com.psyche.kelivo.MainActivity")
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity main = startActivitySync(launch);
            awaitText("电脑");
            if ("update-entry".equals(scenario)) {
                click("设置");
                awaitText("电脑连接与控制");
                snapshot("updates-global-settings");
                ActivityMonitor updateMonitor = addMonitor("com.mobilecodex.remote.RemoteControlActivity", null, false);
                click("应用更新");
                Activity updates = waitForMonitorWithTimeout(updateMonitor, 10000);
                removeMonitor(updateMonitor);
                if (updates == null) throw new AssertionError("App update Activity did not open");
                awaitText("检查更新");
                awaitText("下载并安装");
                snapshot("updates-independent-page");
                pass("Flutter global settings opens the actual app update page without pairing a computer or configuring a model");
                sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                awaitText("电脑连接与控制");
                snapshot("updates-back-to-settings");
                pass("Android hardware back returns from app updates to the mounted global settings");
                report.put("status", "passed").put("systemInstaller", "not exercised");
                code = Activity.RESULT_OK;
                return;
            }
            click("AI");
            if ("offline-recovery".equals(scenario)) {
                awaitText("AI-offline-draft");
                snapshot("process-ai-restored");
                openRemote();
                awaitText("computer-offline-draft");
                snapshot("process-computer-restored");
                click("AI");
                awaitText("AI-offline-draft");
                pass("Both existing offline drafts recover in a fresh process without re-entering or sending text");
                report.put("status", "passed");
                code = Activity.RESULT_OK;
                return;
            }
            snapshot("01-ai-offline");
            pass("AI and computer entries are accessible without a configured model or Mac");

            setDraft("AI-offline-draft");
            snapshot("02-ai-draft");
            ActivityMonitor remoteMonitor = addMonitor("com.mobilecodex.remote.RemoteControlActivity", null, false);
            click("电脑");
            awaitText("切换 Agent");
            Activity remote = waitForMonitorWithTimeout(remoteMonitor, 10000);
            if (remote == null) throw new AssertionError("Remote Activity did not open");
            removeMonitor(remoteMonitor);
            JSONObject webState = new JSONObject(new org.json.JSONTokener(inspectWeb(remote)).nextValue().toString());
            JSONObject appearance = new JSONObject(getTargetContext()
                .getSharedPreferences("product-shell-v1", 0).getString("appearance", "{}"));
            report.put("remoteWeb", webState).put("remoteAppearance", appearance);
            if (!(appearance.getBoolean("dark") ? "dark" : "light").equals(webState.getString("theme"))) {
                throw new AssertionError("Computer appearance differs from Flutter");
            }
            // Synthetic host payload only, on this isolated emulator. This checks
            // the native preference -> bridge event -> live Web palette path.
            android.content.SharedPreferences preferences = getTargetContext().getSharedPreferences("product-shell-v1", 0);
            try {
                JSONObject changed = new JSONObject(appearance.toString()).put("dark", !appearance.getBoolean("dark"))
                    .put("mode", appearance.getBoolean("dark") ? "light" : "dark")
                    .put("colors", new JSONObject());
                if (!preferences.edit().putString("appearance", changed.toString()).commit()) throw new AssertionError("Cannot store test palette");
                awaitWebTheme(remote, changed.getBoolean("dark") ? "dark" : "light");
            } finally {
                if (!preferences.edit().putString("appearance", appearance.toString()).commit()) throw new AssertionError("Cannot restore test palette");
            }
            awaitWebTheme(remote, appearance.getBoolean("dark") ? "dark" : "light");
            pass("Computer appearance matches Flutter and live native appearance events restore correctly");
            // This only opens the local unsent composer; the runner never presses Send.
            if (find(ui.getRootInActiveWindow(), "关闭线程列表") == null) click("打开线程列表");
            click("新线程");
            awaitGone("关闭线程列表");
            setDraft("computer-offline-draft");
            snapshot("03-computer-draft");
            pass("Real Flutter to Capacitor Activity transition and separate offline computer editor");

            click("AI");
            awaitFocus(main);
            awaitText("AI-offline-draft");
            if (main.isFinishing() || main.isDestroyed()) {
                throw new AssertionError("Original Main Activity was destroyed");
            }
            snapshot("04-ai-restored");
            pass("Returning from the computer preserves AI draft and the original live Main Activity");

            click("设置");
            awaitText("电脑连接与控制");
            snapshot("05-settings");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitText("AI-offline-draft");
            pass("Global settings opens independently and Android back returns to the AI draft");

            click("电脑");
            awaitText("computer-offline-draft");
            snapshot("06-computer-restored");
            pass("Computer draft survives WebView destruction and Activity recreation");
            click("AI");
            awaitText("AI-offline-draft");
            if ("offline-device".equals(scenario)) {
                if (Build.VERSION.SDK_INT < 30) throw new IllegalStateException("Extended device scenario needs Android30+; use offline-navigation below that");
                deviceChecks(report);
            }
            code = Activity.RESULT_OK;
            report.put("status", "passed");
        } catch (Throwable error) {
            try { report.put("status", "failed").put("error", error.toString()); snapshot("failure"); }
            catch (Exception ignored) { /* Keep the original failure. */ }
            result.putString("failure", error.toString());
        } finally {
            try {
                report.put("steps", steps).put("sdk", Build.VERSION.SDK_INT).put("fingerprint", Build.FINGERPRINT)
                    .put("scenario", scenario).put("package", getTargetContext().getPackageName());
                if (evidence != null) write("result.json", report.toString(2));
                result.putString("report", report.toString());
                result.putString("evidence", evidence == null ? "unavailable" : evidence.getAbsolutePath());
            } catch (Exception error) { result.putString("reportError", error.toString()); code = Activity.RESULT_CANCELED; }
            finish(code, result);
        }
    }

    private void pass(String value) { steps.put(value); }

    @androidx.annotation.RequiresApi(30)
    private void deviceChecks(JSONObject report) throws Exception {
        String previousNight = shell("cmd uimode night").trim().replace("Night mode: ", "");
        String previousScale = shell("settings get system font_scale").trim();
        String previousRotation = shell("settings get system user_rotation").trim();
        String previousAutoRotation = shell("settings get system accelerometer_rotation").trim();
        JSONArray windows = new JSONArray();
        report.put("deviceWindows", windows);
        try {
            // Use the real Flutter setting, rather than a synthetic palette.
            click("设置");
            clickAny("颜色模式", "Color Mode");
            clickAny("跟随系统", "System");
            click("AI");
            for (boolean dark : new boolean[] { false, true, false }) {
                shell("cmd uimode night " + (dark ? "yes" : "no"));
                awaitAppearance(dark);
                snapshot(dark ? "device-ai-dark" : "device-ai-light");
                Activity remote = openRemote();
                awaitText("computer-offline-draft");
                awaitWebTheme(remote, dark ? "dark" : "light");
                windows.put(checkWindow(remote, dark, "system-" + (dark ? "dark" : "light")));
                snapshot(dark ? "device-computer-dark" : "device-computer-light");
                if (dark) {
                    shell("cmd uimode night no");
                    awaitWebTheme(remote, "light");
                    windows.put(checkWindow(remote, false, "foreground-system-light"));
                    snapshot("device-computer-live-system-light");
                    shell("cmd uimode night yes");
                    awaitWebTheme(remote, "dark");
                    windows.put(checkWindow(remote, true, "foreground-system-dark"));
                }
                click("AI");
                awaitText("AI-offline-draft");
            }
            pass("Actual Android system light/dark/light changes preserve both drafts and match native bars to the Flutter palette");

            for (boolean dark : new boolean[] { true, false }) {
                shell("cmd uimode night " + (dark ? "no" : "yes"));
                click("设置");
                clickAny("颜色模式", "Color Mode");
                if (dark) clickAny("深色", "Dark"); else clickAny("浅色", "Light");
                click("AI");
                awaitAppearance(dark, dark ? "dark" : "light");
                snapshot(dark ? "device-ai-pinned-dark" : "device-ai-pinned-light");
                Activity pinned = openRemote();
                awaitText("computer-offline-draft");
                awaitWebTheme(pinned, dark ? "dark" : "light");
                windows.put(checkWindow(pinned, dark, "pinned-" + (dark ? "dark" : "light")));
                snapshot(dark ? "device-computer-pinned-dark" : "device-computer-pinned-light");
                click("AI");
            }
            pass("Explicit Flutter dark/light choices stay consistent with the computer when the system uses the opposite theme");
            click("设置");
            clickAny("颜色模式", "Color Mode");
            clickAny("跟随系统", "System");
            click("AI");
            shell("cmd uimode night no");
            awaitAppearance(false);

            // A real font-scale configuration change, not a CSS-only fixture.
            shell("settings put system font_scale 1.5");
            awaitText("AI-offline-draft");
            snapshot("device-ai-font150");
            Activity remote = openRemote();
            awaitText("computer-offline-draft");
            JSONObject scaled = checkWindow(remote, false, "font150");
            if (scaled.getInt("textZoom") != 150) throw new AssertionError("Web text zoom does not follow Android font scale");
            windows.put(scaled);
            snapshot("device-computer-font150");
            pass("Actual Android150% font scale keeps the AI and computer drafts accessible");

            tap(awaitText("computer-offline-draft"));
            awaitKeyboard(remote, true);
            JSONObject keyboard = inspectWindow(remote);
            if (keyboard.getInt("webBottom") > keyboard.getInt("height") - keyboard.getInt("imeBottom")) {
                throw new AssertionError("Computer WebView overlaps the IME");
            }
            windows.put(keyboard.put("stage", "keyboard-open"));
            snapshot("device-computer-keyboard");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitKeyboard(remote, false);
            JSONObject closed = inspectWindow(remote);
            if (closed.getInt("webBottom") != closed.getInt("height") - closed.getInt("barBottom")) {
                throw new AssertionError("Computer margins did not restore after IME closed");
            }
            pass("Real IME opening avoids the computer composer and Android back restores the system-bar margin");

            ui.setRotation(UiAutomation.ROTATION_FREEZE_90);
            awaitOrientation(remote, true);
            awaitText("computer-offline-draft");
            JSONObject layout = inspectEmptyChatLayout(remote);
            report.put("landscapeEmptyChat", layout);
            if (layout.getDouble("firstTop") < layout.getDouble("viewportTop") - 1
                || layout.getDouble("lastBottom") > layout.getDouble("viewportBottom") + 1) {
                throw new AssertionError("Landscape empty-chat content cannot be fully reached by scrolling: " + layout);
            }
            snapshot("device-computer-landscape");
            ui.setRotation(UiAutomation.ROTATION_FREEZE_0);
            awaitOrientation(remote, false);
            awaitText("computer-offline-draft");
            snapshot("device-computer-portrait");
            pass("Computer landscape/portrait rotation keeps the offline draft");
            pass("At Android150% font scale the landscape empty-chat illustration and full explanation are reachable by scrolling");

            sendKeyDownUpSync(KeyEvent.KEYCODE_HOME);
            SystemClock.sleep(600);
            runOnMainSync(() -> getTargetContext().startActivity(new Intent().setClassName(getTargetContext(),
                "com.mobilecodex.remote.RemoteControlActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)));
            awaitText("computer-offline-draft");
            snapshot("device-computer-foreground");
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
            awaitText("AI-offline-draft");
            snapshot("device-ai-back");
            pass("Home/foreground and hardware back keep both drafts without sending");
        } finally {
            ui.setRotation(UiAutomation.ROTATION_FREEZE_0);
            ui.setRotation(UiAutomation.ROTATION_UNFREEZE);
            restoreSetting("system", "user_rotation", previousRotation);
            restoreSetting("system", "accelerometer_rotation", previousAutoRotation);
            restoreSetting("system", "font_scale", previousScale);
            if (!previousNight.matches("auto|yes|no|custom")) throw new AssertionError("Unexpected original night setting: " + previousNight);
            shell("cmd uimode night " + previousNight);
        }
    }

    private String shell(String command) throws Exception {
        try (android.os.ParcelFileDescriptor descriptor = ui.executeShellCommand(command);
             FileInputStream input = new FileInputStream(descriptor.getFileDescriptor());
             java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int size;
            while ((size = input.read(buffer)) != -1) output.write(buffer, 0, size);
            return output.toString("UTF-8");
        }
    }
    private void restoreSetting(String namespace, String key, String value) throws Exception {
        if ("null".equals(value)) shell("settings delete " + namespace + " " + key);
        else {
            if (!value.matches("[0-9.]+")) throw new AssertionError("Unexpected setting: " + key);
            shell("settings put " + namespace + " " + key + " " + value);
        }
    }
    private Activity openRemote() throws Exception {
        ActivityMonitor monitor = addMonitor("com.mobilecodex.remote.RemoteControlActivity", null, false);
        try {
            click("电脑");
            Activity remote = waitForMonitorWithTimeout(monitor, 10000);
            if (remote == null) throw new AssertionError("Remote Activity did not open");
            // The shell is ready independently of any particular toolbar action.
            // WebView may expose that toolbar subtree later after a font change.
            awaitText("主导航");
            return remote;
        } finally { removeMonitor(monitor); }
    }
    private void awaitAppearance(boolean dark) throws Exception { awaitAppearance(dark, "system"); }
    private void awaitAppearance(boolean dark, String mode) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 15000;
        do {
            JSONObject appearance = new JSONObject(getTargetContext().getSharedPreferences("product-shell-v1", 0).getString("appearance", "{}"));
            if (appearance.optBoolean("dark") == dark && mode.equals(appearance.optString("mode"))) return;
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError("Flutter did not follow the actual system theme");
    }
    @androidx.annotation.RequiresApi(30)
    private JSONObject checkWindow(Activity activity, boolean dark, String stage) throws Exception {
        ui.waitForIdle(500, 5000);
        JSONObject state = inspectWindow(activity).put("stage", stage);
        JSONObject appearance = new JSONObject(getTargetContext().getSharedPreferences("product-shell-v1", 0).getString("appearance", "{}"));
        JSONObject palettes = appearance.optJSONObject("palettes");
        JSONObject colors = palettes == null ? appearance.getJSONObject("colors") : palettes.getJSONObject(dark ? "dark" : "light");
        int expected = Color.parseColor(colors.getString("background"));
        if (state.getInt("background") != expected || state.getBoolean("lightStatusBar") == dark
            || state.getBoolean("lightNavigationBar") == dark) throw new AssertionError("Native window does not match Flutter: " + state);
        Bitmap screenshot = ui.takeScreenshot();
        if (screenshot == null) throw new AssertionError("Cannot inspect system-bar pixels");
        try {
            int statusPixel = screenshot.getPixel(screenshot.getWidth() / 2, Math.max(1, state.getInt("barTop") / 2));
            int navigationPixel = screenshot.getPixel(screenshot.getWidth() / 8, screenshot.getHeight() - Math.max(1, state.getInt("barBottom") / 2));
            state.put("statusPixel", statusPixel).put("navigationPixel", navigationPixel).put("expected", expected);
            if (statusPixel != expected || navigationPixel != expected) throw new AssertionError("System-bar background differs from Flutter: " + state);
        } finally { screenshot.recycle(); }
        return state;
    }
    @androidx.annotation.RequiresApi(30)
    private JSONObject inspectWindow(Activity activity) throws Exception {
        JSONObject state = new JSONObject();
        runOnMainSync(() -> {
            try {
                View decor = activity.getWindow().getDecorView();
                WebView web = webView(decor);
                int[] location = new int[2]; web.getLocationOnScreen(location);
                // Use framework APIs: release R8 may inline/remove AndroidX
                // methods that are only referenced by the separate test APK.
                WindowInsets insets = decor.getRootWindowInsets();
                int bars = decor.getWindowInsetsController().getSystemBarsAppearance();
                state.put("background", ((ColorDrawable) decor.getBackground()).getColor())
                    .put("lightStatusBar", (bars & WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS) != 0)
                    .put("lightNavigationBar", (bars & WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS) != 0)
                    .put("textZoom", web.getSettings().getTextZoom()).put("width", decor.getWidth()).put("height", decor.getHeight())
                    .put("webBottom", location[1] + web.getHeight())
                    .put("imeVisible", insets.isVisible(WindowInsets.Type.ime()))
                    .put("imeBottom", insets.getInsets(WindowInsets.Type.ime()).bottom)
                    .put("barTop", insets.getInsets(WindowInsets.Type.systemBars()).top)
                    .put("barBottom", insets.getInsets(WindowInsets.Type.systemBars()).bottom);
            } catch (Exception error) { throw new AssertionError(error); }
        });
        return state;
    }
    @androidx.annotation.RequiresApi(30)
    private void awaitKeyboard(Activity activity, boolean visible) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 10000;
        do {
            if (inspectWindow(activity).getBoolean("imeVisible") == visible) { SystemClock.sleep(400); return; }
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError("IME visibility did not change: " + visible);
    }
    @androidx.annotation.RequiresApi(30)
    private void awaitOrientation(Activity activity, boolean landscape) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 10000;
        do {
            JSONObject window = inspectWindow(activity);
            if ((window.getInt("width") > window.getInt("height")) == landscape) { SystemClock.sleep(400); return; }
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError("Orientation did not change");
    }
    private boolean matches(AccessibilityNodeInfo node, String value) {
        String text = String.valueOf(node.getText());
        String description = String.valueOf(node.getContentDescription());
        return text.equals(value) || description.equals(value) || description.startsWith(value + "\n");
    }
    private AccessibilityNodeInfo find(AccessibilityNodeInfo node, String value) {
        if (node == null) return null;
        if (node.isVisibleToUser() && matches(node, value)) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo found = find(node.getChild(i), value);
            if (found != null) return found;
        }
        return null;
    }
    private AccessibilityNodeInfo awaitText(String value) {
        long deadline = SystemClock.uptimeMillis() + 20000;
        do {
            AccessibilityNodeInfo found = find(ui.getRootInActiveWindow(), value);
            if (found != null) return found;
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError("Missing accessible UI: " + value);
    }
    private void click(String value) throws Exception { clickAny(value); }
    private void clickAny(String... values) throws Exception {
        ui.waitForIdle(500, 5000);
        long deadline = SystemClock.uptimeMillis() + 20000;
        Rect previous = null;
        long stableSince = 0;
        do {
            for (String value : values) {
                AccessibilityNodeInfo node = findClickTarget(ui.getRootInActiveWindow(), value);
                if (node != null) {
                    Rect bounds = new Rect(); node.getBoundsInScreen(bounds);
                    if (!bounds.equals(previous)) { previous = bounds; stableSince = SystemClock.uptimeMillis(); }
                    // Flutter sheet semantics can precede the final touch geometry;
                    // UiAutomation idle alone does not wait for a Flutter animation.
                    if (SystemClock.uptimeMillis() - stableSince >= 350) { tap(node); return; }
                    break;
                }
            }
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError("Cannot click: " + java.util.Arrays.toString(values));
    }
    private AccessibilityNodeInfo findClickTarget(AccessibilityNodeInfo node, String value) {
        if (node == null) return null;
        if (node.isVisibleToUser() && matches(node, value)) {
            AccessibilityNodeInfo target = node;
            while (target != null && !target.isClickable()) target = target.getParent();
            if (target != null && target.isVisibleToUser() && target.isEnabled()) return target;
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo target = findClickTarget(node.getChild(i), value);
            if (target != null) return target;
        }
        return null;
    }
    private void tap(AccessibilityNodeInfo node) {
        Rect bounds = new Rect();
        node.getBoundsInScreen(bounds);
        if (bounds.isEmpty()) throw new AssertionError("Empty touch target");
        long time = SystemClock.uptimeMillis();
        MotionEvent down = MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, bounds.exactCenterX(), bounds.exactCenterY(), 0);
        MotionEvent up = MotionEvent.obtain(time, time + 60, MotionEvent.ACTION_UP, bounds.exactCenterX(), bounds.exactCenterY(), 0);
        down.setSource(InputDevice.SOURCE_TOUCHSCREEN); up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        try {
            if (!ui.injectInputEvent(down, true) || !ui.injectInputEvent(up, true)) throw new AssertionError("Touch injection failed");
        } finally { down.recycle(); up.recycle(); }
    }
    private void awaitGone(String value) {
        long deadline = SystemClock.uptimeMillis() + 10000;
        do {
            if (find(ui.getRootInActiveWindow(), value) == null) return;
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError("UI did not close: " + value);
    }
    private AccessibilityNodeInfo editable(AccessibilityNodeInfo node) {
        if (node == null) return null;
        if (node.isVisibleToUser() && node.isEditable()) return node;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo found = editable(node.getChild(i));
            if (found != null) return found;
        }
        return null;
    }
    private void setDraft(String value) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 10000;
        do {
            AccessibilityNodeInfo node = editable(ui.getRootInActiveWindow());
            if (node != null) {
                tap(node);
                SystemClock.sleep(300);
                int length = String.valueOf(node.getText()).length();
                if (length > 256) throw new AssertionError("Unexpected non-fixture editor content");
                // The native mirror does not implement desktop Ctrl+A. Clear through
                // real delete keys on both sides of the observed cursor instead.
                for (int i = 0; i <= length; i++) sendKeyDownUpSync(KeyEvent.KEYCODE_DEL);
                for (int i = 0; i <= length; i++) sendKeyDownUpSync(KeyEvent.KEYCODE_FORWARD_DEL);
                sendStringSync(value);
                awaitText(value);
                ui.waitForIdle(500, 5000);
                for (AccessibilityWindowInfo window : ui.getWindows()) {
                    if (window.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) { sendKeyDownUpSync(KeyEvent.KEYCODE_BACK); break; }
                }
                ui.waitForIdle(500, 5000);
                return;
            }
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError("No editable offline composer");
    }
    private void snapshot(String name) throws Exception {
        if (ui == null || evidence == null) return;
        ui.waitForIdle(500, 5000);
        StringBuilder tree = new StringBuilder();
        dump(ui.getRootInActiveWindow(), tree, 0);
        write(name + ".txt", tree.toString());
        Bitmap image = ui.takeScreenshot();
        if (image != null) try (FileOutputStream stream = new FileOutputStream(new File(evidence, name + ".png"))) {
            image.compress(Bitmap.CompressFormat.PNG, 100, stream);
        } finally { if (image != null) image.recycle(); }
    }
    private void dump(AccessibilityNodeInfo node, StringBuilder output, int depth) {
        if (node == null) return;
        for (int i = 0; i < depth; i++) output.append(' ');
        Rect bounds = new Rect(); node.getBoundsInScreen(bounds);
        output.append(node.getClassName()).append(" bounds=").append(bounds).append(" text=").append(node.getText())
            .append(" description=").append(node.getContentDescription()).append(" editable=").append(node.isEditable())
            .append(" clickable=").append(node.isClickable()).append(" enabled=").append(node.isEnabled()).append('\n');
        for (int i = 0; i < node.getChildCount(); i++) dump(node.getChild(i), output, depth + 1);
    }
    private void write(String name, String value) throws Exception {
        try (FileOutputStream stream = new FileOutputStream(new File(evidence, name))) { stream.write(value.getBytes(StandardCharsets.UTF_8)); }
    }
    private void awaitFocus(Activity activity) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 10000;
        while (!activity.hasWindowFocus()) {
            if (SystemClock.uptimeMillis() >= deadline) throw new AssertionError("Host did not regain window focus");
            SystemClock.sleep(150);
        }
        ui.waitForIdle(500, 5000);
    }
    private WebView webView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            WebView result = webView(((ViewGroup) view).getChildAt(i));
            if (result != null) return result;
        }
        return null;
    }
    private String inspectWeb(Activity activity) throws Exception {
        String[] result = new String[1]; CountDownLatch done = new CountDownLatch(1);
        runOnMainSync(() -> {
            WebView web = webView(activity.getWindow().getDecorView());
            if (web == null) { done.countDown(); return; }
            web.evaluateJavascript("JSON.stringify({theme:document.documentElement.dataset.theme,systemDark:matchMedia('(prefers-color-scheme: dark)').matches,background:getComputedStyle(document.body).backgroundColor})", value -> { result[0] = value; done.countDown(); });
        });
        if (!done.await(5, TimeUnit.SECONDS)) throw new AssertionError("Web inspection timed out");
        return result[0];
    }
    private JSONObject inspectEmptyChatLayout(Activity activity) throws Exception {
        String[] result = new String[1]; CountDownLatch done = new CountDownLatch(1);
        runOnMainSync(() -> {
            WebView web = webView(activity.getWindow().getDecorView());
            if (web == null) { done.countDown(); return; }
            web.evaluateJavascript("JSON.stringify((() => {"
                + "const viewport=document.querySelector('.chat-workspace .messages-viewport'),empty=viewport?.querySelector('.empty-chat');"
                + "if(!empty) return {error:'Missing empty chat'};"
                + "viewport.scrollTop=0;const firstTop=empty.firstElementChild.getBoundingClientRect().top;"
                + "viewport.scrollTop=viewport.scrollHeight;const bounds=viewport.getBoundingClientRect();"
                + "return {firstTop,viewportTop:bounds.top,viewportBottom:bounds.bottom,lastBottom:empty.querySelector('p').getBoundingClientRect().bottom,"
                + "scrollTop:viewport.scrollTop,scrollHeight:viewport.scrollHeight,clientHeight:viewport.clientHeight,"
                + "emptyHeight:empty.clientHeight,emptyScrollHeight:empty.scrollHeight,explanation:empty.querySelector('p').textContent};})())",
                value -> { result[0] = value; done.countDown(); });
        });
        if (!done.await(5, TimeUnit.SECONDS) || result[0] == null) throw new AssertionError("Empty chat inspection timed out");
        return new JSONObject(new org.json.JSONTokener(result[0]).nextValue().toString());
    }
    private void awaitWebTheme(Activity activity, String expected) throws Exception {
        long deadline = SystemClock.uptimeMillis() + 10000;
        do {
            JSONObject value = new JSONObject(new org.json.JSONTokener(inspectWeb(activity)).nextValue().toString());
            if (expected.equals(value.optString("theme"))) return;
            SystemClock.sleep(150);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError("Appearance event did not update Web theme: " + expected);
    }
}

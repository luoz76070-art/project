package com.psyche.kelivo

import android.app.Activity
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import androidx.core.view.WindowCompat
import com.mobilecodex.remote.ProductWindowAppearance
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 26, 36], manifest = Config.NONE)
@Suppress("DEPRECATION")
class ProductWindowAppearanceTest {
    @Test fun flutterPaletteOwnsTheWindowAndIconContrastInBothDirections() {
        val host = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = host.get()
        val window = activity.window
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        for (dark in listOf(false, true, false)) {
            val background = if (dark) "#191b23" else "#f4f3ff"
            ProductWindowAppearance.apply(activity, JSONObject().put("dark", dark)
                .put("colors", JSONObject().put("background", background)))
            assertEquals(Color.parseColor(background), (window.decorView.background as ColorDrawable).color)
            assertEquals(!dark, controller.isAppearanceLightStatusBars)
            if (Build.VERSION.SDK_INT >= 26) assertEquals(!dark, controller.isAppearanceLightNavigationBars)
            if (Build.VERSION.SDK_INT < 35) {
                assertEquals(Color.parseColor(background), window.statusBarColor)
                assertEquals(if (Build.VERSION.SDK_INT >= 26) Color.parseColor(background) else Color.BLACK, window.navigationBarColor)
            }
            if (Build.VERSION.SDK_INT >= 29) {
                assertFalse(window.isStatusBarContrastEnforced)
                assertFalse(window.isNavigationBarContrastEnforced)
            }
        }
        host.pause().stop().destroy()
    }
}

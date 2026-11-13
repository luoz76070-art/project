package com.psyche.kelivo

import android.app.Activity
import android.view.View
import android.widget.FrameLayout
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.mobilecodex.remote.ProductWindowInsets
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], manifest = Config.NONE)
class ProductKeyboardTest {
    @Test fun keyboardInsetsUseTheMaximumAndRestoreSystemBarsOnClose() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val parent = FrameLayout(activity)
        val view = View(activity)
        parent.addView(view, FrameLayout.LayoutParams(-1, -1))
        activity.setContentView(parent)
        ProductWindowInsets.install(view)
        fun apply(ime: Int): FrameLayout.LayoutParams {
            val insets = WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.of(0, 24, 0, 48))
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, ime))
                .build()
            ViewCompat.dispatchApplyWindowInsets(view, insets)
            return view.layoutParams as FrameLayout.LayoutParams
        }
        assertEquals(320, apply(320).bottomMargin)
        assertEquals(24, apply(320).topMargin)
        assertEquals(48, apply(0).bottomMargin)
        assertEquals(320, apply(320).bottomMargin)
    }
}

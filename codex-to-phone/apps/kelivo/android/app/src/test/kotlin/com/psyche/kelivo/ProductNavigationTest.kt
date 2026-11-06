package com.psyche.kelivo

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import com.mobilecodex.remote.ProductNavigation
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.json.JSONObject

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 36], manifest = Config.NONE)
class ProductNavigationTest {
    @Test fun systemChangesSelectTheExactFlutterPaletteWithoutAnActiveFlutterFrame() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val light = JSONObject().put("background", "#f1eaff").put("primary", "#123456")
        val dark = JSONObject().put("background", "#19111f").put("primary", "#abcdef")
        val saved = JSONObject().put("mode", "system").put("dark", false).put("colors", light)
            .put("palettes", JSONObject().put("light", light).put("dark", dark))
        ProductNavigation.appearance(activity, saved)
        val night = activity.createConfigurationContext(Configuration(activity.resources.configuration).apply {
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or Configuration.UI_MODE_NIGHT_YES
        })
        val resolved = ProductNavigation.appearance(night)
        assertTrue(resolved.getBoolean("dark"))
        assertEquals(dark.toString(), resolved.getJSONObject("colors").toString())
        assertFalse(JSONObject(activity.getSharedPreferences("product-shell-v1", 0)
            .getString("appearance", "{}") ?: "{}").getBoolean("dark"))
        // Explicit app light mode remains light even when Android is dark.
        ProductNavigation.appearance(activity, saved.put("mode", "light"))
        assertFalse(ProductNavigation.appearance(night).getBoolean("dark"))
        assertEquals(light.toString(), ProductNavigation.appearance(night).getJSONObject("colors").toString())
    }
    @Test fun onlyLocalDestinationsAreAcceptedAndAppearanceSurvivesRecreation() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        assertTrue(ProductNavigation.setTab(activity, "settings"))
        assertFalse(ProductNavigation.setTab(activity, "send-task"))
        ProductNavigation.appearance(activity, JSONObject("{\"mode\":\"dark\"}"))
        ProductNavigation.openSettings(activity, true)
        controller.recreate()
        assertTrue(ProductNavigation.takeOpenSettings(controller.get()))
        assertFalse(ProductNavigation.takeOpenSettings(controller.get()))
        assertEquals("settings", ProductNavigation.tab(controller.get()))
        assertEquals("dark", ProductNavigation.appearance(controller.get()).getString("mode"))
    }
    @Test fun returningReusesTheExistingHostAndRetiresOnlyTheRemote() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        ProductNavigation.showHost(activity, "ai")
        val target = shadowOf(activity).nextStartedActivity
        assertEquals("com.psyche.kelivo.MainActivity", target.component?.className)
        assertEquals("ai", target.getStringExtra(ProductNavigation.TAB_EXTRA))
        assertTrue(target.flags and Intent.FLAG_ACTIVITY_CLEAR_TOP != 0)
        assertTrue(target.flags and Intent.FLAG_ACTIVITY_SINGLE_TOP != 0)
        assertTrue(activity.isFinishing)
    }
    @Test fun appUpdatesAndComputerSettingsDoNotLeakIntoEachOtherOrSubsequentLaunches() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        ProductNavigation.openSettings(controller.get(), true)
        ProductNavigation.openUpdates(controller.get())
        controller.recreate()
        assertTrue(ProductNavigation.takeOpenUpdates(controller.get()))
        assertFalse(ProductNavigation.takeOpenUpdates(controller.get()))
        assertFalse(ProductNavigation.takeOpenSettings(controller.get()))
        ProductNavigation.openUpdates(controller.get())
        ProductNavigation.openSettings(controller.get(), true)
        assertFalse(ProductNavigation.takeOpenUpdates(controller.get()))
        assertTrue(ProductNavigation.takeOpenSettings(controller.get()))
        ProductNavigation.openUpdates(controller.get())
        ProductNavigation.openSettings(controller.get(), false)
        assertFalse(ProductNavigation.takeOpenUpdates(controller.get()))
        assertFalse(ProductNavigation.takeOpenSettings(controller.get()))
    }
}

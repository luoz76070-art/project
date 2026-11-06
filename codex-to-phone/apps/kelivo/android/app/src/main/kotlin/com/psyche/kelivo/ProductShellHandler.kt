package com.psyche.kelivo

import android.content.Intent
import com.mobilecodex.remote.ProductNavigation
import com.mobilecodex.remote.ProductHandoffStore
import com.mobilecodex.remote.RemoteControlActivity
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import org.json.JSONObject

internal class ProductShellHandler(private val activity: MainActivity, messenger: BinaryMessenger) {
    private val channel = MethodChannel(messenger, "app.product_shell")
    init {
        channel.setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "getTab" -> result.success(ProductNavigation.tab(activity))
                    "setTab" -> {
                        require(ProductNavigation.setTab(activity, call.arguments as? String))
                        result.success(null)
                    }
                    "setAppearance", "openRemote" -> {
                        val values = call.arguments as? Map<*, *> ?: error("Missing appearance")
                        ProductNavigation.appearance(activity, JSONObject(values))
                        if (call.method == "openRemote") {
                            ProductNavigation.openSettings(activity, false)
                            activity.startActivity(Intent(activity, RemoteControlActivity::class.java))
                        }
                        result.success(null)
                    }
                    "openRemoteSettings" -> {
                        ProductNavigation.openSettings(activity, true)
                        activity.startActivity(Intent(activity, RemoteControlActivity::class.java))
                        result.success(null)
                    }
                    "openAppUpdates" -> {
                        ProductNavigation.openUpdates(activity)
                        activity.startActivity(Intent(activity, RemoteControlActivity::class.java))
                        result.success(null)
                    }
                    "prepareHandoff" -> {
                        val text = (call.arguments as? Map<*, *>)?.get("text") as? String ?: error("Missing handoff text")
                        ProductHandoffStore.prepare(activity, text)
                        ProductNavigation.openSettings(activity, false)
                        activity.startActivity(Intent(activity, RemoteControlActivity::class.java))
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            } catch (error: Exception) {
                result.error("product_navigation", error.message, null)
            }
        }
    }
    fun receive(intent: Intent) {
        val tab = intent.getStringExtra(ProductNavigation.TAB_EXTRA) ?: when (intent.action) {
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE, Intent.ACTION_PROCESS_TEXT, Intent.ACTION_VIEW -> "ai"
            else -> if (intent.hasExtra("kelivo.background.conversation")) "ai" else return
        }
        if (ProductNavigation.setTab(activity, tab)) channel.invokeMethod("showTab", tab)
        intent.removeExtra(ProductNavigation.TAB_EXTRA)
    }
    fun dispose() = channel.setMethodCallHandler(null)
}

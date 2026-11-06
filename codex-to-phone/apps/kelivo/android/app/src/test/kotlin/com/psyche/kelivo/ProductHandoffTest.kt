package com.psyche.kelivo

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import com.mobilecodex.remote.ProductHandoffStore
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 36], manifest = Config.NONE)
class ProductHandoffTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private val thread = "12345678-1234-4234-8234-123456789abc"
    @Before fun reset() { context.getSharedPreferences("product-handoff-v1", 0).edit().clear().commit() }
    private fun payload() = JSONObject().put("message", "任务说明\n\n已上传附件：\n- sample.txt | /fixture/sample.txt")
        .put("target", JSONObject().put("scope", "fixture-profile").put("threadId", thread).put("title", "测试会话")
            .put("cwd", "/fixture").put("controlToken", "must-not-persist"))
    private fun fails(block: () -> Unit) {
        try { block(); fail("Expected handoff rejection") } catch (error: IllegalStateException) { /* expected */ }
    }
    @Test fun preparingOnlyCreatesOneDurableDraftAndRepeatedTapsReuseIt() {
        val first = ProductHandoffStore.prepare(context, "只选中这一条")
        assertEquals("draft", first.getString("status"))
        assertEquals(first.getString("id"), ProductHandoffStore.prepare(context, "只选中这一条").getString("id"))
        fails { ProductHandoffStore.prepare(context, "另一条") }
        assertEquals("只选中这一条", ProductHandoffStore.read(context)!!.getString("text"))
    }
    @Test fun submissionFreezesTargetAndClientIdentityBeforeSendingWithoutTokens() {
        val draft = ProductHandoffStore.prepare(context, "任务")
        val frozen = ProductHandoffStore.begin(context, draft.getString("id"), payload())
        assertEquals("uncertain", frozen.getString("status"))
        assertEquals(frozen.getString("id"), frozen.getString("clientMessageId"))
        assertEquals(thread, frozen.getJSONObject("target").getString("threadId"))
        assertFalse(ProductHandoffStore.read(context).toString().contains("must-not-persist"))
        frozen.put("message", "外部修改")
        assertEquals(payload().getString("message"), ProductHandoffStore.read(context)!!.getString("message"))
    }
    @Test fun uncertainResultsCannotBeResubmittedCancelledOrReplaced() {
        val id = ProductHandoffStore.prepare(context, "任务").getString("id")
        ProductHandoffStore.begin(context, id, payload())
        fails { ProductHandoffStore.begin(context, id, payload()) }
        fails { ProductHandoffStore.close(context, id) }
        fails { ProductHandoffStore.prepare(context, "任务") }
        fails { ProductHandoffStore.confirm(context, id, "other", "desktop") }
        assertEquals("uncertain", ProductHandoffStore.read(context)!!.getString("status"))
    }
    @Test fun matchingConfirmationRetainsReceiptKindAndCloseNeverReplays() {
        val id = ProductHandoffStore.prepare(context, "任务").getString("id")
        ProductHandoffStore.begin(context, id, payload())
        val accepted = ProductHandoffStore.confirm(context, id, id, "queue")
        assertEquals("queue", accepted.getString("acceptance"))
        assertEquals("confirmed", ProductHandoffStore.read(context)!!.getString("status"))
        ProductHandoffStore.confirm(context, id, id, "desktop")
        ProductHandoffStore.confirm(context, id, id, "queue")
        assertEquals("desktop", ProductHandoffStore.read(context)!!.getString("acceptance"))
        ProductHandoffStore.close(context, id)
        assertNull(ProductHandoffStore.read(context))
        assertNotEquals(id, ProductHandoffStore.prepare(context, "任务").getString("id"))
    }
    @Test fun cancellingAnUnsentDraftDoesNotCreateASubmission() {
        val id = ProductHandoffStore.prepare(context, "任务").getString("id")
        fails { ProductHandoffStore.confirm(context, id, id, "desktop") }
        ProductHandoffStore.close(context, id)
        assertNull(ProductHandoffStore.read(context))
    }
    @Test fun failedDurableReservationLeavesThePreviousDraftUnsubmitted() {
        val id = ProductHandoffStore.prepare(context, "任务").getString("id")
        val failing = object : ContextWrapper(context) {
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                val original = super.getSharedPreferences(name, mode)
                return object : SharedPreferences by original {
                    override fun edit(): SharedPreferences.Editor {
                        val editor = original.edit()
                        return object : SharedPreferences.Editor by editor {
                            override fun putString(key: String?, value: String?): SharedPreferences.Editor { editor.putString(key, value); return this }
                            override fun commit() = false
                        }
                    }
                }
            }
        }
        fails { ProductHandoffStore.begin(failing, id, payload()) }
        assertEquals("draft", ProductHandoffStore.read(context)!!.getString("status"))
    }
    @Test fun invalidTargetOrOversizedPreparationPreservesTheCurrentRecord() {
        val id = ProductHandoffStore.prepare(context, "任务").getString("id")
        try { ProductHandoffStore.begin(context, id, payload().put("target", JSONObject().put("scope", "fixture").put("threadId", "not-a-thread").put("title", "测试"))); fail() }
        catch (error: IllegalArgumentException) { /* expected */ }
        assertEquals("draft", ProductHandoffStore.read(context)!!.getString("status"))
        ProductHandoffStore.close(context, id)
        try { ProductHandoffStore.prepare(context, "中".repeat(22000)); fail() }
        catch (error: IllegalArgumentException) { /* expected */ }
        assertNull(ProductHandoffStore.read(context))
    }
}

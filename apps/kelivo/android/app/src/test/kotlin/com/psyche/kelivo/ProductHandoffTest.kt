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

    private val storeId = "32345678-1234-4234-8234-123456789abc"
    private val itemId = "42345678-1234-4234-8234-123456789abc"
    private fun digest() = ProductHandoffStore.migrationState(context).getJSONObject("handoffMigration").getString("digest")

    @Test fun migrationArchivesDraftUncertainAndConfirmedWithoutChangingDelivery() {
        for (status in listOf("draft", "uncertain", "queue", "desktop")) {
            reset()
            val id = ProductHandoffStore.prepare(context, "迁移任务").getString("id")
            if (status != "draft") ProductHandoffStore.begin(context, id, payload())
            if (status == "queue" || status == "desktop") ProductHandoffStore.confirm(context, id, id, status)
            val before = ProductHandoffStore.read(context).toString()
            val expected = digest()
            assertEquals(64, expected.length)
            assertNull(ProductHandoffStore.ackMigration(context, id, expected, storeId, itemId))
            assertNull(ProductHandoffStore.read(context))
            val backup = context.getSharedPreferences("product-handoff-v1", 0).getString("migration-backup", null)!!
            assertEquals(before, JSONObject(backup).getString("raw"))
            assertFalse(backup.contains("must-not-persist"))
            assertTrue(backup.toByteArray(Charsets.UTF_8).size <= 256 * 1024)
            assertTrue(ProductHandoffStore.migrationState(context).isNull("handoffMigration"))
        }
    }

    @Test fun migrationRejectsChangedSourceAndMismatchedReceipts() {
        val id = ProductHandoffStore.prepare(context, "任务").getString("id")
        val oldDigest = digest()
        ProductHandoffStore.begin(context, id, payload())
        fails { ProductHandoffStore.ackMigration(context, id, oldDigest, storeId, itemId) }
        fails { ProductHandoffStore.ackMigration(context, itemId, digest(), storeId, itemId) }
        fails { ProductHandoffStore.ackMigration(context, id, "0".repeat(64), storeId, itemId) }
        assertEquals("uncertain", ProductHandoffStore.read(context)!!.getString("status"))
        val current = digest()
        ProductHandoffStore.ackMigration(context, id, current, storeId, itemId)
        fails { ProductHandoffStore.ackMigration(context, id, current, itemId, itemId) }
        fails { ProductHandoffStore.ackMigration(context, id, current, storeId, storeId) }
    }

    @Test fun repeatedMigrationAckDoesNotRemoveNewerHandoffAndBackupIsBoundedToOne() {
        val id = ProductHandoffStore.prepare(context, "旧任务").getString("id")
        val expected = digest()
        ProductHandoffStore.ackMigration(context, id, expected, storeId, itemId)
        assertNull(ProductHandoffStore.ackMigration(context, id, expected, storeId, itemId))
        val newer = ProductHandoffStore.prepare(context, "新任务").getString("id")
        assertEquals(newer, ProductHandoffStore.ackMigration(context, id, expected, storeId, itemId)!!.getString("id"))
        ProductHandoffStore.ackMigration(context, newer, digest(), storeId, newer)
        val prefs = context.getSharedPreferences("product-handoff-v1", 0)
        assertEquals(setOf("migration-backup"), prefs.all.keys)
        assertEquals(newer, JSONObject(prefs.getString("migration-backup", null)!!).getString("id"))
    }

    @Test fun failedMigrationCommitRestoresActiveRecordEvenAfterMemoryWasUpdated() {
        val id = ProductHandoffStore.prepare(context, "任务").getString("id")
        ProductHandoffStore.begin(context, id, payload())
        val expected = digest()
        val failing = object : ContextWrapper(context) {
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                val original = super.getSharedPreferences(name, mode)
                return object : SharedPreferences by original {
                    override fun edit(): SharedPreferences.Editor {
                        val editor = original.edit()
                        return object : SharedPreferences.Editor by editor {
                            override fun putString(key: String?, value: String?): SharedPreferences.Editor { editor.putString(key, value); return this }
                            override fun remove(key: String?): SharedPreferences.Editor { editor.remove(key); return this }
                            override fun commit(): Boolean { editor.commit(); return false }
                        }
                    }
                }
            }
        }
        fails { ProductHandoffStore.ackMigration(failing, id, expected, storeId, itemId) }
        assertEquals("uncertain", ProductHandoffStore.read(context)!!.getString("status"))
        assertEquals(expected, digest())
        assertNull(context.getSharedPreferences("product-handoff-v1", 0).getString("migration-backup", null))
        assertNull(ProductHandoffStore.ackMigration(context, id, expected, storeId, itemId))
    }

    @Test fun invalidMigrationIdentitiesKeepOriginal() {
        val id = ProductHandoffStore.prepare(context, "任务").getString("id")
        for (inputs in listOf(listOf("bad", digest(), storeId, itemId), listOf(id, "bad", storeId, itemId),
            listOf(id, digest(), "bad", itemId), listOf(id, digest(), storeId, "bad"))) {
            try { ProductHandoffStore.ackMigration(context, inputs[0], inputs[1], inputs[2], inputs[3]); fail() }
            catch (error: IllegalArgumentException) { /* expected */ }
        }
        assertEquals(id, ProductHandoffStore.read(context)!!.getString("id"))
    }
}

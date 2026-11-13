package com.psyche.kelivo.input

import android.view.View
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], manifest = Config.NONE)
class MirrorConnectionCloseTest {
    @Test fun closeDrainsAcceptedEditsBeforeFrameworkCleanup() {
        val connection = MirrorConnection(View(RuntimeEnvironment.getApplication()), "close", "abc", 3, 3) {}
        connection.navigationPending = true
        assertTrue(connection.commitText("!", 1))
        connection.closeConnection()
        assertEquals("abc", connection.editable.toString())
        assertTrue(connection.valid)
        assertFalse(connection.commitText("ignored", 1))
        connection.navigationPending = false
        while (connection.deferred.isNotEmpty()) connection.deferred.removeFirst().run()
        assertEquals("abc!", connection.editable.toString())
        assertFalse(connection.valid)
        connection.closeConnection()
        assertEquals("abc!", connection.editable.toString())
    }
}

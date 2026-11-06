package com.psyche.kelivo.workspace

import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 26], manifest = Config.NONE)
class ProcessCompatibilityTest {
    @Test fun timeoutKeepsProcessAliveAndExitCanBeReaped() {
        val process = ProcessBuilder("/bin/sh", "-c", "read value; exit 7").start()
        try {
            assertTrue(process.isRunningCompat())
            assertFalse(process.waitForCompat(20, TimeUnit.MILLISECONDS))
            assertTrue(process.isRunningCompat())
            process.outputStream.close()
            assertTrue(process.waitForCompat(5, TimeUnit.SECONDS))
            assertFalse(process.isRunningCompat())
            assertEquals(7, process.exitValue())
            assertTrue(process.waitForCompat(0, TimeUnit.MILLISECONDS))
        } finally {
            process.destroy()
            process.waitFor()
        }
    }

    @Test fun waitingCanBeInterruptedWithoutTerminatingTheProcess() {
        val process = ProcessBuilder("/bin/sh", "-c", "read value").start()
        try {
            Thread.currentThread().interrupt()
            assertThrows(InterruptedException::class.java) { process.waitForCompat(1, TimeUnit.SECONDS) }
            assertTrue(process.isRunningCompat())
        } finally {
            Thread.interrupted()
            process.outputStream.close()
            process.destroy()
            process.waitFor()
        }
    }
}

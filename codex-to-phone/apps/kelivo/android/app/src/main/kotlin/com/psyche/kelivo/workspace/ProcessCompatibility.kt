package com.psyche.kelivo.workspace

import android.os.Build
import java.util.concurrent.TimeUnit

internal fun Process.isRunningCompat(): Boolean = if (Build.VERSION.SDK_INT >= 26) {
    isAlive
} else {
    try {
        exitValue()
        false
    } catch (_: IllegalThreadStateException) {
        true
    }
}

internal fun Process.waitForCompat(timeout: Long, unit: TimeUnit): Boolean {
    if (Build.VERSION.SDK_INT >= 26) return waitFor(timeout, unit)
    val started = System.nanoTime()
    val budget = unit.toNanos(timeout).coerceAtLeast(0)
    while (isRunningCompat()) {
        val remaining = budget - (System.nanoTime() - started)
        if (remaining <= 0) return false
        TimeUnit.NANOSECONDS.sleep(minOf(remaining, TimeUnit.MILLISECONDS.toNanos(10)))
    }
    return true
}

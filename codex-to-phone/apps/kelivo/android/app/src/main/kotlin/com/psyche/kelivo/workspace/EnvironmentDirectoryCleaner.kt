package com.psyche.kelivo.workspace

import android.os.Build
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE
import java.nio.file.attribute.PosixFilePermission.OWNER_READ
import java.nio.file.attribute.PosixFilePermission.OWNER_WRITE

/** Deletes app-owned guest data after setEnvironmentBusy has stopped guest processes. */
object EnvironmentDirectoryCleaner {
    fun delete(directory: File) = deleteEntry(directory.toPath())

    private fun deleteEntry(path: Path) {
        val attributes = try {
            Files.readAttributes(path, BasicFileAttributes::class.java, NOFOLLOW_LINKS)
        } catch (error: IOException) {
            // Android 7's desugared NIO can report FileNotFoundException.
            // notExists distinguishes absence from an indeterminate/denied stat.
            if (Files.notExists(path, NOFOLLOW_LINKS)) return
            throw error
        }
        if (attributes.isDirectory) {
            // Repair before listing; only directories identified without following
            // symlinks may have their permissions changed.
            if (Build.VERSION.SDK_INT >= 26) {
                val permissions = Files.getPosixFilePermissions(path, NOFOLLOW_LINKS).toMutableSet()
                if (permissions.addAll(listOf(OWNER_READ, OWNER_WRITE, OWNER_EXECUTE))) {
                    Files.setPosixFilePermissions(path, permissions)
                }
            } else {
                // java.io's owner-only setters preserve other permission bits and
                // work on Android 7, where desugared POSIX attributes do not.
                val file = path.toFile()
                if (!file.setReadable(true, true) || !file.setWritable(true, true) || !file.setExecutable(true, true)) {
                    throw IOException("Cannot repair directory permissions: $path")
                }
            }
            Files.newDirectoryStream(path).use { children ->
                for (child in children) deleteEntry(child)
            }
        }
        // Symlinks (including dangling and guest-absolute links) are only unlinked.
        Files.deleteIfExists(path)
    }
}

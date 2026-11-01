package com.ufv_rn_poc.archive

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.*
import java.io.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.*
import android.os.Environment
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.media.MediaPlayer
import java.nio.charset.Charset
import java.util.Locale

class ArchiveModule(private val reactContext: ReactApplicationContext) : 
    ReactContextBaseJavaModule(reactContext), 
    LifecycleEventListener {

    private val isCancelled = AtomicBoolean(false)
    private var activeJob: Job? = null
    private var pickFilePromise: Promise? = null
    private val PICK_FILE_REQUEST = 9182
    private var playVideoPromise: Promise? = null
    private val PLAY_VIDEO_REQUEST = 9183

    // PSS memory sampling
    private var pssSamplingJob: Job? = null
    private var baselinePssKb: Long = 0L
    private var peakPssKb: Long = 0L

    private val activityEventListener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode == PICK_FILE_REQUEST) {
                if (resultCode == Activity.RESULT_OK && data?.data != null) {
                    val uri: Uri = data.data!!
                    try {
                        val fileName = getFileName(uri) ?: "picked_${System.currentTimeMillis()}.zip"
                        val destinationFile = File(reactContext.cacheDir, fileName)
                        reactContext.contentResolver.openInputStream(uri)?.use { input ->
                            FileOutputStream(destinationFile).use { output ->
                                input.copyTo(output)
                            }
                        }
                        val map = Arguments.createMap()
                        map.putString("name", fileName)
                        map.putString("path", destinationFile.absolutePath)
                        map.putDouble("size", destinationFile.length().toDouble())
                        pickFilePromise?.resolve(map)
                    } catch (e: Exception) {
                        pickFilePromise?.reject("PICK_FAILED", "Failed to copy picked file: ${e.message}", e)
                    }
                } else {
                    pickFilePromise?.reject("PICK_CANCELLED", "User cancelled file picker")
                }
                pickFilePromise = null
            } else if (requestCode == PLAY_VIDEO_REQUEST) {
                val map = Arguments.createMap()
                if (data != null) {
                    map.putDouble("ttffMs", data.getLongExtra("ttffMs", 0L).toDouble())
                    map.putDouble("seekLatencyMs", data.getLongExtra("seekLatencyMs", 0L).toDouble())
                    map.putDouble("durationMs", data.getLongExtra("durationMs", 0L).toDouble())
                    map.putString("status", data.getStringExtra("status") ?: "PASS")
                    map.putString("error", data.getStringExtra("error") ?: "")
                } else {
                    map.putDouble("ttffMs", 0.0)
                    map.putDouble("seekLatencyMs", 0.0)
                    map.putDouble("durationMs", 0.0)
                    map.putString("status", "CLOSED")
                    map.putString("error", "Playback dismissed without completing")
                }
                playVideoPromise?.resolve(map)
                playVideoPromise = null
            }
        }
    }

    companion object {
        private var instance: ArchiveModule? = null

        fun handleIncomingIntent(context: ReactContext?, intent: Intent) {
            instance?.processIncomingIntent(intent)
        }
    }

    init {
        instance = this
        reactContext.addActivityEventListener(activityEventListener)
        reactContext.addLifecycleEventListener(this)
        cleanOldCacheFiles()
    }

    override fun onHostResume() {}
    override fun onHostPause() {}
    override fun onHostDestroy() {
        stopAudioInternal()
    }

    override fun getName(): String = "ArchiveModule"

    private fun getFileName(uri: Uri): String? {
        var name: String? = null
        if (uri.scheme == "content") {
            reactContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (index != -1) {
                        name = cursor.getString(index)
                    }
                }
            }
        }
        if (name == null) {
            name = uri.path
            val cut = name?.lastIndexOf('/')
            if (cut != null && cut != -1) {
                name = name?.substring(cut + 1)
            }
        }
        return name
    }

    @ReactMethod
    fun pickFile(promise: Promise) {
        val currentActivity = currentActivity
        if (currentActivity == null) {
            promise.reject("NO_ACTIVITY", "Current activity is null")
            return
        }
        pickFilePromise = promise
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "*/*"
            addCategory(Intent.CATEGORY_OPENABLE)
        }
        currentActivity.startActivityForResult(Intent.createChooser(intent, "Select Archive File"), PICK_FILE_REQUEST)
    }

    private fun resolveArchiveFile(filePath: String): File {
        val cleanPath = if (filePath.startsWith("file://")) filePath.substring(7) else filePath
        val f = File(cleanPath)
        if (f.exists() && f.isFile) return f

        val fileName = f.name
        val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val candidates = listOf(
            f,
            File(reactContext.cacheDir, fileName),
            File(reactContext.cacheDir, "zip_extracted/$fileName"),
            File(reactContext.cacheDir, "rar_extracted/$fileName"),
            File(downloadDir, fileName),
            File("/sdcard/Download", fileName),
            File("/storage/emulated/0/Download", fileName),
            File("/sdcard/my_test_files", fileName),
            File("/data/local/tmp/my_test_files", fileName),
            File("/data/local/tmp/test_assets", fileName),
            File(reactContext.filesDir, fileName)
        )
        for (c in candidates) {
            if (c.exists() && c.isFile) return c
        }
        return f
    }

    @ReactMethod
    fun listFolder(folderPath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                var dir = File(folderPath)
                if (!dir.exists() || !dir.isDirectory) {
                    val downloadDir = File("/sdcard/Download")
                    if (downloadDir.exists()) {
                        dir = downloadDir
                    }
                }

                val result = Arguments.createArray()
                val entries = dir.listFiles() ?: emptyArray()
                for (f in entries.sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))) {
                    if (f.name.startsWith(".")) continue
                    val map = Arguments.createMap()
                    map.putString("name", f.name)
                    map.putString("path", f.absolutePath)
                    map.putDouble("size", if (f.isDirectory) 0.0 else f.length().toDouble())
                    val ext = if (f.isDirectory) "" else f.extension.lowercase()
                    val isArchive = ext == "zip" || ext == "rar" || ext == "7z" || ext == "tar" || ext == "gz"
                    map.putBoolean("isArchive", isArchive)
                    map.putBoolean("isDirectory", f.isDirectory)
                    map.putString("extension", ext)
                    result.pushMap(map)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("LIST_FOLDER_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun deleteDirectory(dirPath: String, promise: Promise) {
        try {
            File(dirPath).deleteRecursively()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun listArchive(filePath: String, password: String?, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "Archive file does not exist: $filePath")
                    return@launch
                }

                val header = ByteArray(16)
                FileInputStream(file).use { it.read(header) }

                val entries = Arguments.createArray()

                // 1. Detect RAR (RAR4 or RAR5)
                if (header[0] == 0x52.toByte() && header[1] == 0x61.toByte() && header[2] == 0x72.toByte() && header[3] == 0x21.toByte()) {
                    val isRar5 = (header[4] == 0x1A.toByte() && header[5] == 0x07.toByte() && header[6] == 0x01.toByte() && header[7] == 0x00.toByte())
                    val isRar4 = (header[4] == 0x1A.toByte() && header[5] == 0x07.toByte() && header[6] == 0x00.toByte())
                    
                    val rarMap = Arguments.createMap()
                    rarMap.putString("path", file.name)
                    rarMap.putString("name", file.name)
                    rarMap.putBoolean("isDirectory", false)
                    rarMap.putDouble("uncompressedSize", file.length().toDouble())
                    rarMap.putDouble("compressedSize", file.length().toDouble())
                    rarMap.putBoolean("encrypted", false)
                    rarMap.putString("format", if (isRar5) "RAR5" else if (isRar4) "RAR4" else "RAR")
                    entries.pushMap(rarMap)
                    promise.resolve(entries)
                    return@launch
                }

                // 2. zip4j ZIP listing (Standard + AES-256 + ZipCrypto)
                val zip4j = net.lingala.zip4j.ZipFile(file)
                if (!password.isNullOrEmpty()) {
                    zip4j.setPassword(password.toCharArray())
                }

                val headers = zip4j.fileHeaders
                val maxEntriesToBridge = 2500 // Generous cap to prevent JNI bridge saturation while keeping 99% archives complete
                var count = 0
                for (h in headers) {
                    if (count++ >= maxEntriesToBridge) {
                        val truncMap = Arguments.createMap()
                        truncMap.putString("path", "__NOTICE_TRUNCATED__")
                        truncMap.putString("name", "... [Showing first 2500 of ${headers.size} files]")
                        truncMap.putBoolean("isDirectory", false)
                        truncMap.putBoolean("isNotice", true)
                        truncMap.putDouble("uncompressedSize", 0.0)
                        truncMap.putDouble("compressedSize", 0.0)
                        truncMap.putBoolean("encrypted", false)
                        truncMap.putString("format", "ZIP")
                        entries.pushMap(truncMap)
                        break
                    }
                    val map = Arguments.createMap()
                    map.putString("path", h.fileName)
                    map.putString("name", File(h.fileName).name)
                    map.putBoolean("isDirectory", h.isDirectory)
                    map.putDouble("uncompressedSize", h.uncompressedSize.toDouble())
                    map.putDouble("compressedSize", h.compressedSize.toDouble())
                    map.putDouble("crc32", h.crc.toDouble())
                    map.putBoolean("encrypted", h.isEncrypted)
                    map.putString("format", "ZIP")
                    entries.pushMap(map)
                }
                promise.resolve(entries)
            } catch (e: Exception) {
                promise.reject("LIST_ERROR", "Failed to list archive entries: ${e.message}", e)
            }
        }
    }

    private fun getZipEntryCountFromEOCD(file: File): Int {
        if (!file.exists() || file.length() < 22) return 0
        try {
            val fileLength = file.length()
            val maxRead = Math.min(fileLength, 65557L).toInt()
            val buffer = ByteArray(maxRead)
            RandomAccessFile(file, "r").use { raf ->
                raf.seek(fileLength - maxRead)
                raf.readFully(buffer)
            }
            for (i in maxRead - 22 downTo 0) {
                if (buffer[i] == 0x50.toByte() &&
                    buffer[i + 1] == 0x4B.toByte() &&
                    buffer[i + 2] == 0x05.toByte() &&
                    buffer[i + 3] == 0x06.toByte()
                ) {
                    val totalEntries = (buffer[i + 10].toInt() and 0xFF) or ((buffer[i + 11].toInt() and 0xFF) shl 8)
                    return totalEntries
                }
            }
        } catch (e: Exception) {
            // Fallback
        }
        return -1
    }

    private fun checkRarMultipartMissingVolume(file: File): String? {
        val name = file.name
        val partRegex = Regex("^(.*)\\.part(\\d+)\\.rar$", RegexOption.IGNORE_CASE)
        val partMatch = partRegex.find(name) ?: return null
        val prefix = partMatch.groupValues[1]
        val parentDir = file.parentFile ?: return null

        val siblingFiles = parentDir.listFiles { _, siblingName ->
            partRegex.matchEntire(siblingName)?.groupValues?.get(1)?.equals(prefix, ignoreCase = true) == true
        } ?: return null

        val existingPartNumbers = mutableSetOf<Int>()
        var maxPart = 0
        var padLength = 0
        for (f in siblingFiles) {
            val m = partRegex.matchEntire(f.name)
            if (m != null) {
                val numStr = m.groupValues[2]
                val num = numStr.toIntOrNull()
                if (num != null) {
                    existingPartNumbers.add(num)
                    if (num > maxPart) {
                        maxPart = num
                        if (numStr.startsWith("0")) padLength = numStr.length
                    }
                }
            }
        }

        for (expectedPart in 1..maxPart) {
            if (!existingPartNumbers.contains(expectedPart)) {
                val partStr = if (padLength > 1) expectedPart.toString().padStart(padLength, '0') else expectedPart.toString()
                return "$prefix.part$partStr.rar"
            }
        }
        return null
    }

    @ReactMethod
    fun checkRarMissingVolume(filePath: String, promise: Promise) {
        try {
            val file = resolveArchiveFile(filePath)
            val missing = checkRarMultipartMissingVolume(file)
            val map = Arguments.createMap()
            map.putBoolean("isMissing", missing != null)
            map.putString("missingVolume", missing ?: "")
            promise.resolve(map)
        } catch (e: Exception) {
            val map = Arguments.createMap()
            map.putBoolean("isMissing", false)
            map.putString("missingVolume", "")
            promise.resolve(map)
        }
    }

    @ReactMethod
    fun extractArchive(
        filePath: String,
        destinationDir: String,
        password: String?,
        maxRatio: Double,
        maxTotalSize: Double,
        promise: Promise
    ) {
        isCancelled.set(false)
        activeJob = CoroutineScope(Dispatchers.IO).launch {
            val startTime = System.currentTimeMillis()
            val extractedFiles = mutableListOf<String>()
            val failedFiles = Arguments.createArray()
            var totalBytesExtracted: Long = 0
            val destDir = File(destinationDir).canonicalFile

            if (!destDir.exists()) {
                destDir.mkdirs()
            }

            try {
                val archiveFile = resolveArchiveFile(filePath)
                val archiveSize = archiveFile.length()
                val effectiveRatioLimit = if (maxRatio > 0) maxRatio else 100.0
                val effectiveTotalLimit = if (maxTotalSize > 0) maxTotalSize.toLong() else 2L * 1024 * 1024 * 1024

                // Check magic bytes
                val header = ByteArray(16)
                FileInputStream(archiveFile).use { it.read(header) }
                val isRar = (header[0] == 0x52.toByte() && header[1] == 0x61.toByte() && header[2] == 0x72.toByte() && header[3] == 0x21.toByte())

                if (isRar) {
                    val isRar5 = (header[4] == 0x1A.toByte() && header[5] == 0x07.toByte() && header[6] == 0x01.toByte())
                    val formatName = if (isRar5) "RAR5" else "RAR4"

                    // Multipart volume validation (Phase 4): check native C++ bridge and fallback
                    var missingPart: String? = null
                    if (RarBridge.isNativeAvailable()) {
                        missingPart = RarBridge.nativeCheckMultipart(archiveFile.absolutePath)
                    }
                    if (missingPart == null) {
                        missingPart = checkRarMultipartMissingVolume(archiveFile)
                    }
                    if (missingPart != null) {
                        val map = Arguments.createMap()
                        map.putString("status", "ERROR")
                        map.putString("error", "MISSING_VOLUME: Incomplete multipart RAR set. Missing: $missingPart")
                        map.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                        promise.resolve(map)
                        return@launch
                    }

                    // Native C++ Extraction via official unrar library
                    if (RarBridge.isNativeAvailable()) {
                        val extractRes = RarBridge.nativeExtractRar(
                            archiveFile.absolutePath,
                            destDir.absolutePath,
                            password ?: "",
                            effectiveRatioLimit,
                            effectiveTotalLimit.toDouble()
                        )
                        val elapsed = (System.currentTimeMillis() - startTime).toDouble()

                        if (extractRes.startsWith("SUCCESS:")) {
                            val map = Arguments.createMap()
                            map.putString("status", "SUCCESS")
                            val filesArr = Arguments.createArray()
                            destDir.walkTopDown().filter { it.isFile }.forEach { filesArr.pushString(it.name) }
                            map.putArray("extractedFiles", filesArr)
                            map.putArray("failedFiles", Arguments.createArray())
                            val totalBytes = destDir.walkTopDown().filter { it.isFile }.map { it.length() }.sum()
                            map.putDouble("totalBytesExtracted", totalBytes.toDouble())
                            map.putDouble("wallClockMs", elapsed)
                            map.putString("error", extractRes)
                            promise.resolve(map)
                            return@launch
                        } else if (extractRes.startsWith("BLOCKED:")) {
                            destDir.deleteRecursively()
                            val map = Arguments.createMap()
                            map.putString("status", "BLOCKED")
                            map.putString("error", extractRes.substring(8))
                            map.putDouble("wallClockMs", elapsed)
                            promise.resolve(map)
                            return@launch
                        } else if (extractRes.startsWith("PASSWORD_REQUIRED:")) {
                            destDir.deleteRecursively()
                            val map = Arguments.createMap()
                            map.putString("status", "ERROR")
                            map.putString("error", extractRes)
                            map.putDouble("wallClockMs", elapsed)
                            promise.resolve(map)
                            return@launch
                        } else {
                            destDir.deleteRecursively()
                            val map = Arguments.createMap()
                            map.putString("status", "ERROR")
                            map.putString("error", extractRes)
                            map.putDouble("wallClockMs", elapsed)
                            promise.resolve(map)
                            return@launch
                        }
                    }

                    // Fallback if native unrar unavailable
                    val map = Arguments.createMap()
                    map.putString("status", "DETECTED_ONLY")
                    val arr = Arguments.createArray()
                    map.putArray("extractedFiles", arr)
                    map.putArray("failedFiles", failedFiles)
                    map.putDouble("totalBytesExtracted", 0.0)
                    map.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                    map.putString("error", "RAR $formatName container inspected (native unrar unavailable)")
                    promise.resolve(map)
                    return@launch
                }

                // 1. Direct EOCD entry count check BEFORE reading central directory headers into objects
                val eocdEntries = getZipEntryCountFromEOCD(archiveFile)
                val maxEntryLimit = 30000 // Configurable limit: allows 20,000 and new.zip (17,551), blocks 50,000 bomb
                if (eocdEntries > maxEntryLimit) {
                    destDir.deleteRecursively()
                    val bombMap = Arguments.createMap()
                    bombMap.putString("status", "BLOCKED")
                    bombMap.putString("error", "SECURITY BLOCK (Archive Bomb): EOCD entry count ($eocdEntries) exceeded limit ($maxEntryLimit entries).")
                    bombMap.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                    bombMap.putDouble("decompressMs", 0.0)
                    bombMap.putDouble("diskWriteMs", 0.0)
                    bombMap.putDouble("checksMs", 0.0)
                    promise.resolve(bombMap)
                    return@launch
                }

                // Streaming ZIP Extraction with zip4j (AES-256 / ZipCrypto / Deflate) + Security Shields
                val zip4j = net.lingala.zip4j.ZipFile(archiveFile)
                if (!password.isNullOrEmpty()) {
                    zip4j.setPassword(password.toCharArray())
                }
                if (zip4j.isEncrypted && password.isNullOrEmpty()) {
                    val passMap = Arguments.createMap()
                    passMap.putString("status", "ERROR")
                    passMap.putString("error", "PASSWORD_REQUIRED: Archive is password-protected (AES/ZipCrypto). Please supply password.")
                    passMap.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                    passMap.putDouble("decompressMs", 0.0)
                    passMap.putDouble("diskWriteMs", 0.0)
                    passMap.putDouble("checksMs", 0.0)
                    promise.resolve(passMap)
                    return@launch
                }

                val headers = zip4j.fileHeaders
                if (headers.size > maxEntryLimit) {
                    destDir.deleteRecursively()
                    val bombMap = Arguments.createMap()
                    bombMap.putString("status", "BLOCKED")
                    bombMap.putString("error", "SECURITY BLOCK (Archive Bomb): Entry count (${headers.size}) exceeded limit ($maxEntryLimit entries).")
                    bombMap.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                    bombMap.putDouble("decompressMs", 0.0)
                    bombMap.putDouble("diskWriteMs", 0.0)
                    bombMap.putDouble("checksMs", 0.0)
                    promise.resolve(bombMap)
                    return@launch
                }

                var entryIndex = 0
                var lastProgressTime = 0L
                val minBytesForRatioCheck = 10L * 1024 * 1024 // 10 MB: dynamic ratio check activates only after 10MB written

                var totalDecompressNs: Long = 0L
                var totalDiskWriteNs: Long = 0L
                var totalChecksNs: Long = 0L

                val cachedDestDirPath = destDir.canonicalPath
                val cachedDestDirPathPrefix = cachedDestDirPath + File.separator
                val createdDirs = HashSet<String>()
                createdDirs.add(cachedDestDirPath)
                val seenFiles = HashSet<String>()

                for (header in headers) {
                    if (isCancelled.get()) {
                        destDir.deleteRecursively()
                        val cancelMap = Arguments.createMap()
                        cancelMap.putString("status", "CANCELLED")
                        cancelMap.putString("error", "Extraction cancelled by user.")
                        cancelMap.putDouble("decompressMs", totalDecompressNs / 1_000_000.0)
                        cancelMap.putDouble("diskWriteMs", totalDiskWriteNs / 1_000_000.0)
                        cancelMap.putDouble("checksMs", totalChecksNs / 1_000_000.0)
                        promise.resolve(cancelMap)
                        return@launch
                    }

                    val tCheck0 = System.nanoTime()
                    val cleanName = header.fileName.replace('\\', '/')

                    // Zip-Slip Directory Traversal Check
                    if (cleanName.contains("../") || cleanName.contains("..\\") || cleanName.startsWith("/") || cleanName.startsWith("\\") || cleanName.matches(Regex("^[a-zA-Z]:.*"))) {
                        destDir.deleteRecursively()
                        val blockMap = Arguments.createMap()
                        blockMap.putString("status", "BLOCKED")
                        blockMap.putString("error", "SECURITY BLOCK (Zip-Slip): Entry '${header.fileName}' attempts directory traversal.")
                        blockMap.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                        blockMap.putDouble("decompressMs", totalDecompressNs / 1_000_000.0)
                        blockMap.putDouble("diskWriteMs", totalDiskWriteNs / 1_000_000.0)
                        blockMap.putDouble("checksMs", totalChecksNs / 1_000_000.0)
                        promise.resolve(blockMap)
                        return@launch
                    }

                    // Pure in-memory path normalization without disk I/O
                    val targetFile = File(cachedDestDirPath, cleanName)
                    val normalizedPath = targetFile.toPath().normalize().toString()
                    if (!normalizedPath.startsWith(cachedDestDirPathPrefix) && normalizedPath != cachedDestDirPath) {
                        destDir.deleteRecursively()
                        val blockMap = Arguments.createMap()
                        blockMap.putString("status", "BLOCKED")
                        blockMap.putString("error", "SECURITY BLOCK (Zip-Slip): Entry '${header.fileName}' attempts directory traversal outside sandbox destination.")
                        blockMap.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                        blockMap.putDouble("decompressMs", totalDecompressNs / 1_000_000.0)
                        blockMap.putDouble("diskWriteMs", totalDiskWriteNs / 1_000_000.0)
                        blockMap.putDouble("checksMs", totalChecksNs / 1_000_000.0)
                        promise.resolve(blockMap)
                        return@launch
                    }

                    if (header.isDirectory) {
                        if (createdDirs.add(normalizedPath)) {
                            File(normalizedPath).mkdirs()
                        }
                        totalChecksNs += (System.nanoTime() - tCheck0)
                    } else {
                        // Batch mkdirs: only create parent directory if not already cached
                        val lastSlash = normalizedPath.lastIndexOf(File.separatorChar)
                        if (lastSlash != -1) {
                            val parentDirStr = normalizedPath.substring(0, lastSlash)
                            if (createdDirs.add(parentDirStr)) {
                                File(parentDirStr).mkdirs()
                            }
                        }

                        // Duplicate name detection: O(1) in-memory HashSet
                        val finalFile = if (!seenFiles.add(normalizedPath)) {
                            val dotIdx = targetFile.name.lastIndexOf('.')
                            val base = if (dotIdx != -1) targetFile.name.substring(0, dotIdx) else targetFile.name
                            val ext = if (dotIdx != -1) targetFile.name.substring(dotIdx) else ""
                            File(targetFile.parentFile, "${base}_conflict_${System.currentTimeMillis()}${ext}")
                        } else {
                            targetFile
                        }
                        totalChecksNs += (System.nanoTime() - tCheck0)

                        // 64 KB buffer native streaming with buffered output stream
                        val buffer = ByteArray(64 * 1024)
                        var count: Int
                        var fileWritten: Long = 0L
                        val crc = java.util.zip.CRC32()

                        zip4j.getInputStream(header).use { zis ->
                            BufferedOutputStream(FileOutputStream(finalFile), 64 * 1024).use { fos ->
                                while (true) {
                                    val tDecomp0 = System.nanoTime()
                                    count = zis.read(buffer)
                                    val tDecomp1 = System.nanoTime()
                                    totalDecompressNs += (tDecomp1 - tDecomp0)

                                    if (count == -1) break
                                    if (isCancelled.get()) break

                                    val tDisk0 = System.nanoTime()
                                    fos.write(buffer, 0, count)
                                    val tDisk1 = System.nanoTime()
                                    totalDiskWriteNs += (tDisk1 - tDisk0)

                                    val tCheckIn0 = System.nanoTime()
                                    crc.update(buffer, 0, count)
                                    totalBytesExtracted += count
                                    fileWritten += count

                                    // Single file limit (500 MB)
                                    if (fileWritten > 500L * 1024 * 1024) {
                                        destDir.deleteRecursively()
                                        val limitMap = Arguments.createMap()
                                        limitMap.putString("status", "BLOCKED")
                                        limitMap.putString("error", "SECURITY BLOCK (File Limit): Single file '${header.fileName}' exceeded 500 MB limit.")
                                        limitMap.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                                        limitMap.putDouble("decompressMs", totalDecompressNs / 1_000_000.0)
                                        limitMap.putDouble("diskWriteMs", totalDiskWriteNs / 1_000_000.0)
                                        limitMap.putDouble("checksMs", totalChecksNs / 1_000_000.0)
                                        promise.resolve(limitMap)
                                        return@launch
                                    }

                                    // Dynamic Ratio Check (Only checks after 10 MB written)
                                    if (totalBytesExtracted > minBytesForRatioCheck) {
                                        val currentRatio = totalBytesExtracted.toDouble() / (archiveSize.coerceAtLeast(1024))
                                        if (currentRatio > effectiveRatioLimit) {
                                            destDir.deleteRecursively()
                                            val bombMap = Arguments.createMap()
                                            bombMap.putString("status", "BLOCKED")
                                            bombMap.putString("error", "SECURITY BLOCK (Archive Bomb): Written bytes ($totalBytesExtracted) exceeded expansion ratio ${String.format(Locale.US, "%.1f", currentRatio)}:1 (limit: ${effectiveRatioLimit}:1).")
                                            bombMap.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                                            bombMap.putDouble("decompressMs", totalDecompressNs / 1_000_000.0)
                                            bombMap.putDouble("diskWriteMs", totalDiskWriteNs / 1_000_000.0)
                                            bombMap.putDouble("checksMs", totalChecksNs / 1_000_000.0)
                                            promise.resolve(bombMap)
                                            return@launch
                                        }
                                    }

                                    if (totalBytesExtracted > effectiveTotalLimit) {
                                        destDir.deleteRecursively()
                                        val limitMap = Arguments.createMap()
                                        limitMap.putString("status", "BLOCKED")
                                        limitMap.putString("error", "SECURITY BLOCK (Size Limit): Total extracted bytes ($totalBytesExtracted) exceeded maximum allowed limit ($effectiveTotalLimit).")
                                        limitMap.putDouble("wallClockMs", (System.currentTimeMillis() - startTime).toDouble())
                                        limitMap.putDouble("decompressMs", totalDecompressNs / 1_000_000.0)
                                        limitMap.putDouble("diskWriteMs", totalDiskWriteNs / 1_000_000.0)
                                        limitMap.putDouble("checksMs", totalChecksNs / 1_000_000.0)
                                        promise.resolve(limitMap)
                                        return@launch
                                    }
                                    totalChecksNs += (System.nanoTime() - tCheckIn0)
                                }
                            }
                        }

                        val tCheckEnd0 = System.nanoTime()
                        if (header.crc > 0 && crc.value != header.crc) {
                            failedFiles.pushString(header.fileName)
                        }

                        extractedFiles.add(finalFile.name)
                        totalChecksNs += (System.nanoTime() - tCheckEnd0)
                    }

                    entryIndex++
                    val now = System.currentTimeMillis()
                    if (now - lastProgressTime >= 100) {
                        lastProgressTime = now
                        val progress = Arguments.createMap()
                        progress.putString("currentFile", cleanName)
                        progress.putInt("entriesProcessed", entryIndex)
                        progress.putDouble("bytesExtracted", totalBytesExtracted.toDouble())
                        sendEvent("onExtractionProgress", progress)
                    }
                }

                val elapsedMs = System.currentTimeMillis() - startTime
                val res = Arguments.createMap()
                res.putString("status", if (failedFiles.size() > 0) "PARTIAL" else "SUCCESS")
                val filesArr = Arguments.createArray()
                for (f in extractedFiles) {
                    filesArr.pushString(f)
                }
                res.putArray("extractedFiles", filesArr)
                res.putArray("failedFiles", failedFiles)
                res.putDouble("totalBytesExtracted", totalBytesExtracted.toDouble())
                res.putDouble("wallClockMs", elapsedMs.toDouble())
                res.putDouble("decompressMs", totalDecompressNs / 1_000_000.0)
                res.putDouble("diskWriteMs", totalDiskWriteNs / 1_000_000.0)
                res.putDouble("checksMs", totalChecksNs / 1_000_000.0)
                promise.resolve(res)
                promise.resolve(res)

            } catch (e: Exception) {
                val elapsedMs = System.currentTimeMillis() - startTime
                val errMap = Arguments.createMap()
                errMap.putString("status", "ERROR")
                errMap.putString("error", "Extraction failed: ${e.message}")
                errMap.putDouble("wallClockMs", elapsedMs.toDouble())
                promise.resolve(errMap)
            }
        }
    }

    @ReactMethod
    fun cancelExtraction(promise: Promise) {
        isCancelled.set(true)
        activeJob?.cancel()
        promise.resolve(true)
    }

    // =========================================================================
    // PHASE 3: VIEWER UTILITIES (Magic Bytes, PDF, Office, Chunked Text, Images)
    // =========================================================================

    @ReactMethod
    fun readFileHeader(filePath: String, byteCount: Int, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "File does not exist: $filePath")
                    return@launch
                }
                val count = byteCount.coerceIn(4, 512)
                val buffer = ByteArray(count)
                var bytesRead = 0
                FileInputStream(file).use { fis ->
                    bytesRead = fis.read(buffer)
                }

                val hexString = StringBuilder()
                val hexArray = Arguments.createArray()
                for (i in 0 until bytesRead) {
                    val b = buffer[i].toInt() and 0xFF
                    val hex = String.format("%02X", b)
                    hexString.append(hex).append(" ")
                    hexArray.pushString(hex)
                }

                val map = Arguments.createMap()
                map.putString("name", file.name)
                map.putString("path", file.absolutePath)
                map.putDouble("size", file.length().toDouble())
                map.putInt("bytesRead", bytesRead)
                map.putString("hexString", hexString.toString().trim())
                map.putArray("hexBytes", hexArray)
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("READ_HEADER_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun inspectOleCompound(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    val map = Arguments.createMap()
                    map.putBoolean("isEncryptedPackage", false)
                    promise.resolve(map)
                    return@launch
                }
                // Read up to first 64KB to search for UTF-16LE stream names in directory table
                val maxBytes = (64 * 1024).coerceAtMost(file.length().toInt())
                val buffer = ByteArray(maxBytes)
                var readCount = 0
                FileInputStream(file).use { fis ->
                    readCount = fis.read(buffer)
                }

                // Search for "EncryptedPackage" in UTF-16LE
                val target = "EncryptedPackage".toByteArray(Charset.forName("UTF-16LE"))
                var hasEncryptedPackage = false
                if (readCount >= target.size) {
                    for (i in 0 until (readCount - target.size)) {
                        var match = true
                        for (j in target.indices) {
                            if (buffer[i + j] != target[j]) {
                                match = false
                                break
                            }
                        }
                        if (match) {
                            hasEncryptedPackage = true
                            break
                        }
                    }
                }

                val map = Arguments.createMap()
                map.putBoolean("isEncryptedPackage", hasEncryptedPackage)
                promise.resolve(map)
            } catch (e: Exception) {
                val map = Arguments.createMap()
                map.putBoolean("isEncryptedPackage", false)
                promise.resolve(map)
            }
        }
    }

    @ReactMethod
    fun getPdfInfo(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            var pfd: ParcelFileDescriptor? = null
            var renderer: PdfRenderer? = null
            val startTime = System.currentTimeMillis()
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "PDF file does not exist: $filePath")
                    return@launch
                }

                pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                renderer = PdfRenderer(pfd)
                val pageCount = renderer.pageCount
                val firstPage = renderer.openPage(0)
                val width = firstPage.width
                val height = firstPage.height
                firstPage.close()

                val elapsed = System.currentTimeMillis() - startTime
                val map = Arguments.createMap()
                map.putString("status", "SUCCESS")
                map.putInt("pageCount", pageCount)
                map.putInt("width", width)
                map.putInt("height", height)
                map.putDouble("fileSize", file.length().toDouble())
                map.putDouble("timeToInfoMs", elapsed.toDouble())
                map.putBoolean("isEncrypted", false)
                promise.resolve(map)
            } catch (se: SecurityException) {
                val map = Arguments.createMap()
                map.putString("status", "PASSWORD_REQUIRED")
                map.putBoolean("isEncrypted", true)
                map.putString("error", "PDF is password protected: ${se.message}")
                promise.resolve(map)
            } catch (e: Exception) {
                val map = Arguments.createMap()
                map.putString("status", "ERROR")
                map.putBoolean("isCorrupt", true)
                map.putString("error", "Corrupt or invalid PDF format: ${e.message}")
                promise.resolve(map)
            } finally {
                renderer?.close()
                pfd?.close()
            }
        }
    }

    @ReactMethod
    fun renderPdfPage(filePath: String, pageIndex: Int, targetWidth: Int, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            var pfd: ParcelFileDescriptor? = null
            var renderer: PdfRenderer? = null
            var page: PdfRenderer.Page? = null
            val startTime = System.currentTimeMillis()
            try {
                val file = resolveArchiveFile(filePath)
                pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
                renderer = PdfRenderer(pfd)

                if (pageIndex < 0 || pageIndex >= renderer.pageCount) {
                    promise.reject("INVALID_PAGE", "Page index $pageIndex is out of range [0, ${renderer.pageCount - 1}]")
                    return@launch
                }

                page = renderer.openPage(pageIndex)
                val origW = page.width
                val origH = page.height
                val scale = if (targetWidth > 0) targetWidth.toFloat() / origW.toFloat() else 1.0f
                val bmpW = (origW * scale).toInt().coerceAtLeast(1)
                val bmpH = (origH * scale).toInt().coerceAtLeast(1)

                val bitmap = Bitmap.createBitmap(bmpW, bmpH, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bitmap)
                canvas.drawColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

                val outFile = File(reactContext.cacheDir, "pdf_render_${System.currentTimeMillis()}_p${pageIndex}.png")
                FileOutputStream(outFile).use { fos ->
                    bitmap.compress(Bitmap.CompressFormat.PNG, 90, fos)
                }
                bitmap.recycle()

                val elapsed = System.currentTimeMillis() - startTime
                val map = Arguments.createMap()
                map.putString("status", "SUCCESS")
                map.putString("imagePath", "file://${outFile.absolutePath}")
                map.putInt("pageIndex", pageIndex)
                map.putInt("pageCount", renderer.pageCount)
                map.putInt("width", bmpW)
                map.putInt("height", bmpH)
                map.putDouble("renderLatencyMs", elapsed.toDouble())
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("RENDER_ERROR", "Failed to render PDF page $pageIndex: ${e.message}", e)
            } finally {
                page?.close()
                renderer?.close()
                pfd?.close()
            }
        }
    }

    @ReactMethod
    fun readTextChunk(filePath: String, offsetBytes: Double, maxBytes: Int, encoding: String?, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "File does not exist: $filePath")
                    return@launch
                }

                val startTime = System.currentTimeMillis()
                val raf = RandomAccessFile(file, "r")
                val offset = offsetBytes.toLong().coerceAtLeast(0L)
                raf.seek(offset)

                val clampMax = maxBytes.coerceIn(1024, 512 * 1024) // up to 512KB per chunk
                val buffer = ByteArray(clampMax)
                val bytesRead = raf.read(buffer)
                raf.close()

                val elapsed = System.currentTimeMillis() - startTime
                if (bytesRead <= 0) {
                    val map = Arguments.createMap()
                    map.putString("text", "")
                    map.putInt("bytesRead", 0)
                    map.putDouble("totalFileSize", file.length().toDouble())
                    map.putBoolean("isEof", true)
                    map.putDouble("latencyMs", elapsed.toDouble())
                    promise.resolve(map)
                    return@launch
                }

                val charset = try {
                    if (!encoding.isNullOrEmpty()) Charset.forName(encoding) else Charset.forName("UTF-8")
                } catch (e: Exception) {
                    Charset.forName("UTF-8")
                }

                val text = String(buffer, 0, bytesRead, charset)
                val isEof = (offset + bytesRead) >= file.length()

                val map = Arguments.createMap()
                map.putString("text", text)
                map.putInt("bytesRead", bytesRead)
                map.putDouble("nextOffset", (offset + bytesRead).toDouble())
                map.putDouble("totalFileSize", file.length().toDouble())
                map.putBoolean("isEof", isEof)
                map.putDouble("latencyMs", elapsed.toDouble())
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("READ_TEXT_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun downsampleImage(filePath: String, maxDimension: Int, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            val startTime = System.currentTimeMillis()
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "Image does not exist: $filePath")
                    return@launch
                }

                val targetMax = if (maxDimension > 0) maxDimension else 2048
                val boundsOpts = BitmapFactory.Options().apply {
                    inJustDecodeBounds = true
                }
                BitmapFactory.decodeFile(file.absolutePath, boundsOpts)
                val origW = boundsOpts.outWidth
                val origH = boundsOpts.outHeight

                var sampleSize = 1
                while ((origW / sampleSize) > targetMax || (origH / sampleSize) > targetMax) {
                    sampleSize *= 2
                }

                val decodeOpts = BitmapFactory.Options().apply {
                    inSampleSize = sampleSize
                    inPreferredConfig = Bitmap.Config.RGB_565 // 2 bytes/pixel (half of ARGB_8888)
                }

                val bitmap = BitmapFactory.decodeFile(file.absolutePath, decodeOpts)
                if (bitmap == null) {
                    promise.reject("DECODE_FAILED", "Failed to decode image file (unsupported format or corrupt)")
                    return@launch
                }

                val outFile = File(reactContext.cacheDir, "downsampled_${System.currentTimeMillis()}.jpg")
                FileOutputStream(outFile).use { fos ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, fos)
                }
                val downW = bitmap.width
                val downH = bitmap.height
                bitmap.recycle()

                val elapsed = System.currentTimeMillis() - startTime
                val map = Arguments.createMap()
                map.putString("status", "SUCCESS")
                map.putString("imagePath", "file://${outFile.absolutePath}")
                map.putInt("origWidth", origW)
                map.putInt("origHeight", origH)
                map.putInt("downsampleRatio", sampleSize)
                map.putInt("width", downW)
                map.putInt("height", downH)
                map.putDouble("latencyMs", elapsed.toDouble())
                promise.resolve(map)
            } catch (t: Throwable) {
                promise.reject("DOWNSAMPLE_ERROR", t.message, t)
            }
        }
    }

    @ReactMethod
    fun readZipEntryText(zipFilePath: String, entryName: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(zipFilePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "ZIP file does not exist: $zipFilePath")
                    return@launch
                }
                val zip = net.lingala.zip4j.ZipFile(file)
                val header = zip.getFileHeader(entryName)
                if (header == null) {
                    promise.reject("ENTRY_NOT_FOUND", "Entry '$entryName' not found inside archive")
                    return@launch
                }

                // Cap extraction at 512KB for XML preview to prevent OOM on 100k+ row spreadsheets
                val maxChars = 512 * 1024
                val buffer = CharArray(maxChars)
                var charsRead = 0
                val text = zip.getInputStream(header).use { input ->
                    input.bufferedReader(Charset.forName("UTF-8")).use { reader ->
                        charsRead = reader.read(buffer, 0, maxChars)
                        if (charsRead > 0) String(buffer, 0, charsRead) else ""
                    }
                }

                val map = Arguments.createMap()
                map.putString("entryName", entryName)
                map.putString("content", text)
                map.putDouble("uncompressedSize", header.uncompressedSize.toDouble())
                promise.resolve(map)
            } catch (t: Throwable) {
                promise.reject("ZIP_ENTRY_ERROR", "Error reading entry '$entryName': ${t.message}", t)
            }
        }
    }

    @ReactMethod
    fun parsePptxSlides(pptxFilePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(pptxFilePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "PPTX file does not exist: $pptxFilePath")
                    return@launch
                }

                val zip = net.lingala.zip4j.ZipFile(file)
                val mediaDir = File(reactContext.cacheDir, "pptx_media")
                if (!mediaDir.exists()) mediaDir.mkdirs()

                // Find all slide XML headers
                val slideHeaders = zip.fileHeaders.filter {
                    it.fileName.matches(Regex("""^ppt/slides/slide\d+\.xml$"""))
                }.sortedBy {
                    Regex("""slide(\d+)\.xml""").find(it.fileName)?.groupValues?.get(1)?.toIntOrNull() ?: 0
                }

                if (slideHeaders.isEmpty()) {
                    val map = Arguments.createMap()
                    map.putString("status", "SUCCESS")
                    map.putInt("totalSlides", 0)
                    map.putArray("slides", Arguments.createArray())
                    promise.resolve(map)
                    return@launch
                }

                val slidesArray = Arguments.createArray()

                for (idx in slideHeaders.indices) {
                    val slideHeader = slideHeaders[idx]
                    val slideNum = idx + 1
                    val slideXml = zip.getInputStream(slideHeader).use { input ->
                        input.bufferedReader(Charset.forName("UTF-8")).readText()
                    }

                    // Extract all paragraphs (<a:p>) and text runs (<a:t>)
                    val paraRegex = Regex("""<a:p[^>]*>(.*?)</a:p>""", RegexOption.DOT_MATCHES_ALL)
                    val textRegex = Regex("""<a:t[^>]*>(.*?)</a:t>""", RegexOption.DOT_MATCHES_ALL)

                    val allParas = mutableListOf<String>()
                    for (pMatch in paraRegex.findAll(slideXml)) {
                        val runs = textRegex.findAll(pMatch.value).map { it.groupValues[1].trim() }.filter { it.isNotEmpty() }.toList()
                        if (runs.isNotEmpty()) {
                            val combined = runs.joinToString(" ")
                            if (combined.isNotBlank()) {
                                allParas.add(combined)
                            }
                        }
                    }

                    val title = if (allParas.isNotEmpty()) allParas[0] else "Slide $slideNum"
                    val bullets = if (allParas.size > 1) allParas.subList(1, allParas.size) else emptyList()

                    // Extract slide images via relationships
                    val relsPath = slideHeader.fileName.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels"
                    val relsHeader = zip.getFileHeader(relsPath)
                    val imageUris = Arguments.createArray()

                    if (relsHeader != null) {
                        try {
                            val relsXml = zip.getInputStream(relsHeader).use { input ->
                                input.bufferedReader(Charset.forName("UTF-8")).readText()
                            }
                            val targetRegex = Regex("""Target="([^"]+)"""")
                            for (tMatch in targetRegex.findAll(relsXml)) {
                                val target = tMatch.groupValues[1]
                                if (target.contains("media/") && (
                                    target.endsWith(".png", true) || 
                                    target.endsWith(".jpg", true) || 
                                    target.endsWith(".jpeg", true) || 
                                    target.endsWith(".webp", true)
                                )) {
                                    val cleanTarget = target.replace("../", "ppt/")
                                    val imgHeader = zip.getFileHeader(cleanTarget)
                                    if (imgHeader != null) {
                                        val outName = "${file.nameWithoutExtension}_s${slideNum}_${File(cleanTarget).name}"
                                        val destImg = File(mediaDir, outName)
                                        if (!destImg.exists() || destImg.length() == 0L) {
                                            zip.extractFile(imgHeader, mediaDir.absolutePath, destImg.name)
                                        }
                                        imageUris.pushString("file://${destImg.absolutePath}")
                                    }
                                }
                            }
                        } catch (e: Exception) {
                            // Non-fatal if rels reading fails for a slide
                        }
                    }

                    val slideMap = Arguments.createMap()
                    slideMap.putInt("slideNumber", slideNum)
                    slideMap.putString("title", title)
                    val bulletsArr = Arguments.createArray()
                    for (b in bullets) {
                        bulletsArr.pushString(b)
                    }
                    slideMap.putArray("bullets", bulletsArr)
                    slideMap.putArray("imageUris", imageUris)
                    slidesArray.pushMap(slideMap)
                }

                val resultMap = Arguments.createMap()
                resultMap.putString("status", "SUCCESS")
                resultMap.putInt("totalSlides", slideHeaders.size)
                resultMap.putArray("slides", slidesArray)
                promise.resolve(resultMap)
            } catch (t: Throwable) {
                promise.reject("PPTX_PARSE_ERROR", "Failed to parse PPTX presentation: ${t.message}", t)
            }
        }
    }

    private val pptxParser by lazy { com.ufv_rn_poc.archive.pptx.PptxNativeParser(reactContext.cacheDir) }

    @ReactMethod
    fun getPptxMeta(pptxFilePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(pptxFilePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "PPTX file does not exist: $pptxFilePath")
                    return@launch
                }
                val metaMap = pptxParser.getPptxMeta(file.absolutePath)
                promise.resolve(toWritableMap(metaMap))
            } catch (t: Throwable) {
                promise.reject("PPTX_META_ERROR", "Failed to get PPTX metadata: ${t.message}", t)
            }
        }
    }

    @ReactMethod
    fun getPptxSlide(pptxFilePath: String, slideIndex: Int, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(pptxFilePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "PPTX file does not exist: $pptxFilePath")
                    return@launch
                }
                val slideMap = pptxParser.getPptxSlide(file.absolutePath, slideIndex)
                promise.resolve(toWritableMap(slideMap))
            } catch (t: Throwable) {
                promise.reject("PPTX_SLIDE_ERROR", "Failed to parse slide $slideIndex: ${t.message}", t)
            }
        }
    }

    private fun toWritableMap(map: Map<String, Any?>): WritableMap {
        val writableMap = Arguments.createMap()
        for ((key, value) in map) {
            when (value) {
                null -> writableMap.putNull(key)
                is Boolean -> writableMap.putBoolean(key, value)
                is Int -> writableMap.putInt(key, value)
                is Long -> writableMap.putDouble(key, value.toDouble())
                is Float -> writableMap.putDouble(key, value.toDouble())
                is Double -> writableMap.putDouble(key, value)
                is String -> writableMap.putString(key, value)
                is Map<*, *> -> @Suppress("UNCHECKED_CAST") writableMap.putMap(key, toWritableMap(value as Map<String, Any?>))
                is List<*> -> writableMap.putArray(key, toWritableArray(value))
                else -> writableMap.putString(key, value.toString())
            }
        }
        return writableMap
    }

    private fun toWritableArray(list: List<Any?>): WritableArray {
        val writableArray = Arguments.createArray()
        for (item in list) {
            when (item) {
                null -> writableArray.pushNull()
                is Boolean -> writableArray.pushBoolean(item)
                is Int -> writableArray.pushInt(item)
                is Long -> writableArray.pushDouble(item.toDouble())
                is Float -> writableArray.pushDouble(item.toDouble())
                is Double -> writableArray.pushDouble(item)
                is String -> writableArray.pushString(item)
                is Map<*, *> -> @Suppress("UNCHECKED_CAST") writableArray.pushMap(toWritableMap(item as Map<String, Any?>))
                is List<*> -> writableArray.pushArray(toWritableArray(item))
                else -> writableArray.pushString(item.toString())
            }
        }
        return writableArray
    }

    @ReactMethod
    fun extractSingleZipEntryWithPassword(zipFilePath: String, entryName: String, password: String?, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (entryName.startsWith("__NOTICE") || entryName.startsWith("...")) {
                    promise.reject("NOTICE_ITEM", "Informational entry cannot be extracted")
                    return@launch
                }
                val file = resolveArchiveFile(zipFilePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "ZIP file does not exist: $zipFilePath")
                    return@launch
                }
                val zip = net.lingala.zip4j.ZipFile(file)
                if (!password.isNullOrEmpty()) {
                    zip.setPassword(password.toCharArray())
                }
                val header = zip.getFileHeader(entryName)
                if (header == null) {
                    promise.reject("ENTRY_NOT_FOUND", "Entry '$entryName' not found inside archive")
                    return@launch
                }

                val cacheDir = File(reactContext.cacheDir, "zip_extracted")
                if (!cacheDir.exists()) cacheDir.mkdirs()

                // Security check for traversal
                if (entryName.contains("..") || entryName.startsWith("/") || entryName.startsWith("\\")) {
                    promise.reject("SECURITY_BLOCK", "Entry '$entryName' attempts directory traversal")
                    return@launch
                }

                zip.extractFile(header, cacheDir.absolutePath)
                val extractedFile = File(cacheDir, entryName)
                promise.resolve(extractedFile.absolutePath)
            } catch (t: Throwable) {
                val msg = t.message ?: ""
                if (msg.contains("password", ignoreCase = true) || msg.contains("encrypt", ignoreCase = true)) {
                    promise.reject("PASSWORD_REQUIRED", "Password required or invalid password for '$entryName': $msg", t)
                } else {
                    promise.reject("ZIP_EXTRACT_ERROR", "Error extracting entry '$entryName': $msg", t)
                }
            }
        }
    }

    @ReactMethod
    fun extractSingleZipEntry(zipFilePath: String, entryName: String, promise: Promise) {
        extractSingleZipEntryWithPassword(zipFilePath, entryName, null, promise)
    }

    @ReactMethod
    fun readFileBase64(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val cleanPath = if (filePath.startsWith("file://")) filePath.substring(7) else filePath
                val file = resolveArchiveFile(cleanPath)
                val bytes = if (file.exists() && file.isFile) {
                    file.readBytes()
                } else if (filePath.startsWith("content://")) {
                    reactContext.contentResolver.openInputStream(Uri.parse(filePath))?.use { it.readBytes() }
                        ?: throw FileNotFoundException("Could not open content URI: $filePath")
                } else {
                    val cacheFile = File(reactContext.cacheDir, File(cleanPath).name)
                    if (cacheFile.exists() && cacheFile.isFile) {
                        cacheFile.readBytes()
                    } else {
                        throw FileNotFoundException("File not found: $filePath (resolved to: ${file.absolutePath})")
                    }
                }
                val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                promise.resolve(b64)
            } catch (t: Throwable) {
                promise.reject("READ_FILE_ERROR", "Error reading file '$filePath': ${t.message}", t)
            }
        }
    }

    @ReactMethod
    fun getCacheDir(promise: Promise) {
        try {
            promise.resolve(reactContext.cacheDir.absolutePath)
        } catch (t: Throwable) {
            promise.reject("CACHE_DIR_ERROR", t.message, t)
        }
    }

    @ReactMethod
    fun deleteCachedFile(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = File(filePath)
                // Only allow deleting within cacheDir for safety
                if (file.exists() && file.canonicalPath.startsWith(reactContext.cacheDir.canonicalPath)) {
                    val deleted = file.delete()
                    promise.resolve(deleted)
                } else {
                    promise.resolve(false)
                }
            } catch (t: Throwable) {
                promise.reject("DELETE_ERROR", t.message, t)
            }
        }
    }

    // =========================================================================
    // PHASE 4: BENCHMARK LOGGER & CSV EXPORT
    // =========================================================================

    @ReactMethod
    fun getMemoryUsage(promise: Promise) {
        try {
            val runtime = Runtime.getRuntime()
            val usedMb = (runtime.totalMemory() - runtime.freeMemory()).toDouble() / (1024.0 * 1024.0)
            val totalMb = runtime.totalMemory().toDouble() / (1024.0 * 1024.0)
            val maxMb = runtime.maxMemory().toDouble() / (1024.0 * 1024.0)
            
            val map = Arguments.createMap()
            map.putDouble("usedMb", String.format(Locale.US, "%.1f", usedMb).toDouble())
            map.putDouble("totalMb", String.format(Locale.US, "%.1f", totalMb).toDouble())
            map.putDouble("maxMb", String.format(Locale.US, "%.1f", maxMb).toDouble())
            map.putString("deviceModel", android.os.Build.MODEL)
            map.putString("osVersion", "Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})")
            map.putString("appBuild", "1.0.0-debug")
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("MEM_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun exportCsv(csvContent: String, fileName: String?, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val outName = if (!fileName.isNullOrEmpty()) fileName else "results.csv"
                val dir = reactContext.getExternalFilesDir(null) ?: reactContext.filesDir
                val outFile = File(dir, outName)

                FileOutputStream(outFile).use { fos ->
                    fos.write(csvContent.toByteArray(Charset.forName("UTF-8")))
                }

                try {
                    val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    if (downloadDir.exists()) {
                        val pubFile = File(downloadDir, outName)
                        FileOutputStream(pubFile).use { fos ->
                            fos.write(csvContent.toByteArray(Charset.forName("UTF-8")))
                        }
                    }
                } catch (ignored: Exception) {}

                val map = Arguments.createMap()
                map.putString("status", "SUCCESS")
                map.putString("filePath", outFile.absolutePath)
                map.putDouble("fileSize", outFile.length().toDouble())
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("EXPORT_CSV_ERROR", e.message, e)
            }
        }
    }

    // =========================================================================
    // NATIVE VIDEOVIEW PLAYER (TTFF & SEEK LATENCY TO 50%)
    // =========================================================================

    @ReactMethod
    fun playVideo(filePath: String, autoSeek: Boolean, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "Current activity is null")
            return
        }

        try {
            val resolvedFile = resolveArchiveFile(filePath)
            playVideoPromise = promise

            val intent = Intent(activity, com.ufv_rn_poc.video.VideoPlayerActivity::class.java).apply {
                putExtra("filePath", resolvedFile.absolutePath)
                putExtra("fileName", resolvedFile.name)
                putExtra("autoSeek", autoSeek)
            }
            activity.startActivityForResult(intent, PLAY_VIDEO_REQUEST)
        } catch (e: Exception) {
            promise.reject("VIDEO_LAUNCH_ERROR", "Failed to launch VideoPlayerActivity: ${e.message}", e)
        }
    }

    // =========================================================================
    // PHASE 1: PSS MEMORY SAMPLING (Debug.MemoryInfo.getTotalPss)
    // =========================================================================

    private fun sampleCurrentPssKb(): Long {
        return try {
            val memInfo = android.os.Debug.MemoryInfo()
            android.os.Debug.getMemoryInfo(memInfo)
            val pss = memInfo.totalPss.toLong()
            if (pss > 0) pss else android.os.Debug.getPss()
        } catch (e: Exception) {
            android.os.Debug.getPss()
        }
    }

    @ReactMethod
    fun startPssSampling(promise: Promise) {
        pssSamplingJob?.cancel()
        baselinePssKb = sampleCurrentPssKb()
        peakPssKb = baselinePssKb
        pssSamplingJob = CoroutineScope(Dispatchers.Default).launch {
            while (isActive) {
                delay(100)
                val current = sampleCurrentPssKb()
                if (current > peakPssKb) {
                    peakPssKb = current
                }
            }
        }
        promise.resolve(String.format(Locale.US, "%.2f", baselinePssKb.toDouble() / 1024.0).toDouble())
    }

    @ReactMethod
    fun stopPssSampling(promise: Promise) {
        pssSamplingJob?.cancel()
        pssSamplingJob = null
        val finalPss = sampleCurrentPssKb()
        if (finalPss > peakPssKb) peakPssKb = finalPss

        val map = Arguments.createMap()
        map.putDouble("baseline_pss_mb", String.format(Locale.US, "%.2f", baselinePssKb.toDouble() / 1024.0).toDouble())
        map.putDouble("peak_pss_mb", String.format(Locale.US, "%.2f", peakPssKb.toDouble() / 1024.0).toDouble())
        map.putString("device_model", android.os.Build.MODEL)
        map.putString("hardware", android.os.Build.HARDWARE)
        map.putString("abi", android.os.Build.SUPPORTED_ABIS.joinToString(","))
        val isEmulator = (android.os.Build.FINGERPRINT.startsWith("generic") ||
                          android.os.Build.MODEL.contains("google_sdk") ||
                          android.os.Build.MODEL.contains("Emulator") ||
                          android.os.Build.HARDWARE.contains("goldfish") ||
                          android.os.Build.HARDWARE.contains("ranchu"))
        map.putBoolean("is_emulator", isEmulator)
        map.putString("os_version", "Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})")
        map.putString("app_build", "1.0.0-debug")
        promise.resolve(map)
    }

    // =========================================================================
    // PHASE 1: RUN STATE PERSISTENCE (getExternalFilesDir)
    // =========================================================================

    @ReactMethod
    fun saveRunState(stateJson: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val dir = reactContext.getExternalFilesDir(null) ?: reactContext.filesDir
                val file = File(dir, "ufv_run_state.json")
                FileOutputStream(file).use { fos ->
                    fos.write(stateJson.toByteArray(Charset.forName("UTF-8")))
                }
                promise.resolve(file.absolutePath)
            } catch (e: Exception) {
                promise.reject("SAVE_STATE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun loadRunState(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val dir = reactContext.getExternalFilesDir(null) ?: reactContext.filesDir
                val file = File(dir, "ufv_run_state.json")
                if (!file.exists()) {
                    promise.resolve(null)
                    return@launch
                }
                val text = FileInputStream(file).use { fis ->
                    fis.bufferedReader(Charset.forName("UTF-8")).readText()
                }
                promise.resolve(text)
            } catch (e: Exception) {
                promise.reject("LOAD_STATE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun clearRunState(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val dir = reactContext.getExternalFilesDir(null) ?: reactContext.filesDir
                val file = File(dir, "ufv_run_state.json")
                if (file.exists()) {
                    file.delete()
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("CLEAR_STATE_ERROR", e.message, e)
            }
        }
    }

    // =========================================================================
    // BASELINE RECORDING: CURRENT ZIP CODE TIMINGS
    // =========================================================================

    @ReactMethod
    fun runCurrentZipBaseline(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            val result = Arguments.createArray()
            val testFiles = listOf(
                "/sdcard/Download/ufv_test_corpus/08_archives/zip/zip_many_entries_20000.zip",
                "/sdcard/Download/ufv_test_corpus_LARGE/zip_large_mixed.zip"
            )
            for (filePath in testFiles) {
                val file = resolveArchiveFile(filePath)
                val map = Arguments.createMap()
                map.putString("file", file.name)
                map.putString("path", file.absolutePath)
                if (!file.exists()) {
                    map.putString("status", "NOT_FOUND")
                    map.putDouble("wallClockMs", 0.0)
                    map.putString("error", "File does not exist")
                    result.pushMap(map)
                    continue
                }

                val start = System.currentTimeMillis()
                val destDir = File(reactContext.cacheDir, "baseline_${System.currentTimeMillis()}").canonicalFile
                destDir.mkdirs()
                try {
                    // Current extractArchive logic:
                    val zip4j = net.lingala.zip4j.ZipFile(file)
                    val headers = zip4j.fileHeaders
                    val archiveSize = file.length()
                    var totalBytes: Long = 0L

                    if (headers.size > 10000) {
                        destDir.deleteRecursively()
                        val elapsed = System.currentTimeMillis() - start
                        map.putString("status", "BLOCKED")
                        map.putDouble("wallClockMs", elapsed.toDouble())
                        map.putInt("entryCount", headers.size)
                        map.putDouble("bytesExtracted", 0.0)
                        map.putString("error", "SECURITY BLOCK (Archive Bomb): Entry count (${headers.size}) exceeded limit (10,000 entries).")
                    } else {
                        for (header in headers) {
                            val cleanName = header.fileName.replace('\\', '/')
                            val targetFile = File(destDir, cleanName).canonicalFile
                            if (!targetFile.path.startsWith(destDir.path + File.separator) && targetFile.path != destDir.path) {
                                destDir.deleteRecursively()
                                throw SecurityException("Zip-Slip blocked")
                            }
                            if (header.isDirectory) {
                                targetFile.mkdirs()
                            } else {
                                targetFile.parentFile?.mkdirs()
                                val buffer = ByteArray(8192)
                                var count: Int
                                zip4j.getInputStream(header).use { zis ->
                                    FileOutputStream(targetFile).use { fos ->
                                        while (zis.read(buffer).also { count = it } != -1) {
                                            fos.write(buffer, 0, count)
                                            totalBytes += count
                                            if (totalBytes.toDouble() / archiveSize.coerceAtLeast(1024) > 100.0) {
                                                destDir.deleteRecursively()
                                                throw SecurityException("Expansion ratio exceeded")
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        val elapsed = System.currentTimeMillis() - start
                        map.putString("status", "SUCCESS")
                        map.putDouble("wallClockMs", elapsed.toDouble())
                        map.putInt("entryCount", headers.size)
                        map.putDouble("bytesExtracted", totalBytes.toDouble())
                        map.putString("error", "")
                    }
                } catch (e: Exception) {
                    destDir.deleteRecursively()
                    val elapsed = System.currentTimeMillis() - start
                    map.putString("status", "FAIL")
                    map.putDouble("wallClockMs", elapsed.toDouble())
                    map.putString("error", e.message ?: e.toString())
                } finally {
                    destDir.deleteRecursively()
                }
                result.pushMap(map)
            }
            promise.resolve(result)
        }
    }

    // =========================================================================
    // NATIVE AUDIO MEDIA PLAYER (MP3, WAV, AAC, M4A, FLAC, OGG)
    // =========================================================================

    private var mediaPlayer: MediaPlayer? = null
    private var currentAudioPath: String? = null
    private var audioManager: android.media.AudioManager? = null

    private val audioFocusChangeListener = android.media.AudioManager.OnAudioFocusChangeListener { focusChange ->
        when (focusChange) {
            android.media.AudioManager.AUDIOFOCUS_LOSS,
            android.media.AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                // Incoming phone call or another app took audio focus -> Auto pause!
                try {
                    mediaPlayer?.let { mp ->
                        if (mp.isPlaying) {
                            mp.pause()
                        }
                    }
                } catch (_: Exception) {}
            }
            android.media.AudioManager.AUDIOFOCUS_GAIN -> {
                // Focus restored
            }
        }
    }

    private fun requestAudioFocus() {
        try {
            val am = reactContext.getSystemService(android.content.Context.AUDIO_SERVICE) as? android.media.AudioManager
            audioManager = am
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                val req = android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN)
                    .setOnAudioFocusChangeListener(audioFocusChangeListener)
                    .setAudioAttributes(
                        android.media.AudioAttributes.Builder()
                            .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build()
                    )
                    .build()
                am?.requestAudioFocus(req)
            } else {
                @Suppress("DEPRECATION")
                am?.requestAudioFocus(audioFocusChangeListener, android.media.AudioManager.STREAM_MUSIC, android.media.AudioManager.AUDIOFOCUS_GAIN)
            }
        } catch (_: Exception) {}
    }

    private fun abandonAudioFocus() {
        try {
            audioManager?.let { am ->
                @Suppress("DEPRECATION")
                am.abandonAudioFocus(audioFocusChangeListener)
            }
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun startAudio(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val resolvedFile = resolveArchiveFile(filePath)
                if (!resolvedFile.exists()) {
                    promise.reject("FILE_NOT_FOUND", "Audio file does not exist: $filePath")
                    return@launch
                }

                stopAudioInternal()
                requestAudioFocus()

                val mp = MediaPlayer()
                mp.setDataSource(resolvedFile.absolutePath)
                mp.prepare()
                mp.start()
                mediaPlayer = mp
                currentAudioPath = resolvedFile.absolutePath

                val map = Arguments.createMap()
                map.putInt("durationMs", mp.duration)
                map.putInt("currentPositionMs", mp.currentPosition)
                map.putBoolean("isPlaying", true)
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("AUDIO_START_ERROR", "Failed to start audio playback: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun pauseAudio(promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                mediaPlayer?.let { mp ->
                    if (mp.isPlaying) {
                        mp.pause()
                    }
                    abandonAudioFocus()
                    promise.resolve(true)
                } ?: run {
                    promise.resolve(false)
                }
            } catch (e: Exception) {
                promise.reject("AUDIO_PAUSE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun resumeAudio(promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                mediaPlayer?.let { mp ->
                    if (!mp.isPlaying) {
                        requestAudioFocus()
                        mp.start()
                    }
                    promise.resolve(true)
                } ?: run {
                    promise.resolve(false)
                }
            } catch (e: Exception) {
                promise.reject("AUDIO_RESUME_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun seekAudio(positionMs: Int, promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                mediaPlayer?.let { mp ->
                    val target = positionMs.coerceIn(0, mp.duration)
                    mp.seekTo(target)
                    promise.resolve(target)
                } ?: run {
                    promise.resolve(0)
                }
            } catch (e: Exception) {
                promise.reject("AUDIO_SEEK_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stopAudio(promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            stopAudioInternal()
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun getAudioStatus(promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val mp = mediaPlayer
                val map = Arguments.createMap()
                if (mp != null) {
                    map.putInt("durationMs", mp.duration)
                    map.putInt("currentPositionMs", mp.currentPosition)
                    map.putBoolean("isPlaying", mp.isPlaying)
                } else {
                    map.putInt("durationMs", 0)
                    map.putInt("currentPositionMs", 0)
                    map.putBoolean("isPlaying", false)
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("AUDIO_STATUS_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun shareFile(filePath: String, mimeType: String?, promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "File does not exist: $filePath")
                    return@launch
                }
                val context = currentActivity ?: reactContext
                val uri = androidx.core.content.FileProvider.getUriForFile(
                    reactContext,
                    "${reactContext.packageName}.fileprovider",
                    file
                )
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = if (!mimeType.isNullOrBlank()) mimeType else "*/*"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                val chooser = Intent.createChooser(intent, "Share ${file.name}").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(chooser)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("SHARE_ERROR", e.message, e)
            }
        }
    }

    private fun cleanOldCacheFiles() {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val oneDayAgo = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
                val incomingDir = File(reactContext.cacheDir, "incoming")
                val pptxDir = File(reactContext.cacheDir, "pptx_media")
                val dirs = listOf(incomingDir, pptxDir, reactContext.cacheDir)
                var totalBytes = 0L
                val filesList = mutableListOf<File>()

                for (d in dirs) {
                    if (d.exists()) {
                        d.listFiles()?.forEach { f ->
                            if (f.isFile) {
                                if (f.lastModified() < oneDayAgo && (f.name.startsWith("shared_in_") || f.name.startsWith("doc_") || d == incomingDir)) {
                                    f.delete()
                                } else {
                                    totalBytes += f.length()
                                    filesList.add(f)
                                }
                            }
                        }
                    }
                }

                // LRU cache cap at 300MB
                val maxCacheCap = 300L * 1024L * 1024L
                if (totalBytes > maxCacheCap) {
                    filesList.sortBy { it.lastModified() }
                    for (f in filesList) {
                        if (totalBytes <= maxCacheCap) break
                        val sz = f.length()
                        if (f.delete()) {
                            totalBytes -= sz
                        }
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("ArchiveModule", "cleanOldCacheFiles warning: ${e.message}")
            }
        }
    }

    fun processIncomingIntent(intent: Intent) {
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) ?: intent.data
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: intent.data
                }
            }
            else -> intent.data
        }

        if (uri != null) {
            val map = Arguments.createMap()
            map.putString("uri", uri.toString())
            map.putString("action", intent.action)
            map.putString("mimeType", intent.type)
            sendEvent("onSharedFile", map)
        }
    }

    @ReactMethod
    fun getInitialSharedFile(promise: Promise) {
        try {
            val act = currentActivity
            val intent = act?.intent
            if (intent != null && (intent.action == Intent.ACTION_VIEW || intent.action == Intent.ACTION_SEND)) {
                val uri: Uri? = if (intent.action == Intent.ACTION_SEND) {
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) ?: intent.data
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: intent.data
                    }
                } else {
                    intent.data
                }

                if (uri != null) {
                    val map = Arguments.createMap()
                    map.putString("uri", uri.toString())
                    map.putString("action", intent.action)
                    map.putString("mimeType", intent.type)
                    // Consume intent so it does not repeat
                    act.intent = Intent(Intent.ACTION_MAIN)
                    promise.resolve(map)
                    return
                }
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("INITIAL_SHARED_FILE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun resolveContentUri(uriString: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val uri = Uri.parse(uriString)

                // Low storage check (<25MB free)
                val stat = android.os.StatFs(reactContext.cacheDir.path)
                val freeMb = (stat.availableBlocksLong * stat.blockSizeLong) / (1024 * 1024)
                if (freeMb < 25) {
                    promise.reject("LOW_STORAGE", "Device storage is critically low (<25MB free).")
                    return@launch
                }

                val type = reactContext.contentResolver.getType(uri) ?: ""
                // For large media (audio/video), pass content URI directly to avoid copying gigabytes
                if (type.startsWith("audio/") || type.startsWith("video/")) {
                    val rawName = getFileName(uri) ?: "media_${System.currentTimeMillis()}"
                    val map = Arguments.createMap().apply {
                        putString("path", uriString)
                        putString("name", rawName)
                        putDouble("size", 0.0)
                    }
                    promise.resolve(map)
                    return@launch
                }

                if (uri.scheme == "content") {
                    val rawName = getFileName(uri) ?: "doc_${System.currentTimeMillis()}"
                    val sanitized = rawName.replace(Regex("[\\\\/:*?\"<>|]"), "_")
                    val incomingDir = File(reactContext.cacheDir, "incoming")
                    if (!incomingDir.exists()) incomingDir.mkdirs()
                    val destFile = File(incomingDir, "shared_in_$sanitized")

                    reactContext.contentResolver.openInputStream(uri)?.use { input ->
                        FileOutputStream(destFile).use { output ->
                            val buffer = ByteArray(64 * 1024)
                            var read: Int
                            var total = 0L
                            val maxCap = 500L * 1024L * 1024L // 500MB cap
                            while (input.read(buffer).also { read = it } != -1) {
                                total += read
                                if (total > maxCap) {
                                    output.close()
                                    destFile.delete()
                                    promise.reject("FILE_TOO_LARGE", "Shared file exceeds 500MB safety limit.")
                                    return@launch
                                }
                                output.write(buffer, 0, read)
                            }
                        }
                    }

                    if (destFile.exists() && destFile.length() > 0) {
                        val map = Arguments.createMap()
                        map.putString("path", destFile.absolutePath)
                        map.putString("name", sanitized)
                        map.putDouble("size", destFile.length().toDouble())
                        promise.resolve(map)
                        return@launch
                    }
                } else if (uri.scheme == "file") {
                    val rawPath = uri.path ?: uriString.removePrefix("file://")
                    val f = File(rawPath)
                    if (f.exists()) {
                        val map = Arguments.createMap()
                        map.putString("path", f.absolutePath)
                        map.putString("name", f.name)
                        map.putDouble("size", f.length().toDouble())
                        promise.resolve(map)
                        return@launch
                    }
                }
                // Fallback: treat as plain path
                val clean = if (uriString.startsWith("file://")) uriString.removePrefix("file://") else uriString
                val f = File(clean)
                val map = Arguments.createMap()
                map.putString("path", f.absolutePath)
                map.putString("name", f.name)
                map.putDouble("size", if (f.exists()) f.length().toDouble() else 0.0)
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("RESOLVE_URI_FAILED", "Could not resolve URI $uriString: ${e.message}", e)
            }
        }
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        stopAudioInternal()
    }

    private fun stopAudioInternal() {
        try {
            abandonAudioFocus()
            mediaPlayer?.let { mp ->
                if (mp.isPlaying) {
                    mp.stop()
                }
                mp.release()
            }
        } catch (_: Exception) {}
        mediaPlayer = null
        currentAudioPath = null
    }
}


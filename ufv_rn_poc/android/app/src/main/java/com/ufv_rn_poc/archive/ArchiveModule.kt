package com.ufv_rn_poc.archive

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.*
import java.io.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.*
import android.os.Environment
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.ClipData
import android.net.Uri
import android.provider.OpenableColumns
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.media.MediaPlayer
import android.webkit.MimeTypeMap
import java.nio.charset.Charset
import java.util.Locale
import java.util.ArrayList

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

    data class CachedFileInfo(
        val file: File,
        val name: String,
        val size: Long,
        val mimeType: String
    )

    companion object {
        private var instance: ArchiveModule? = null

        fun cacheIncomingUri(context: Context, uri: Uri, intentMimeType: String?): CachedFileInfo? {
            try {
                val scheme = uri.scheme
                val resolver = context.contentResolver

                // 1. If it's already a direct local file
                if (scheme == "file" || scheme.isNullOrBlank()) {
                    val rawPath = uri.path ?: uri.toString().removePrefix("file://")
                    val f = File(rawPath)
                    if (f.exists() && f.isFile) {
                        val mime = if (!intentMimeType.isNullOrBlank()) intentMimeType else "*/*"
                        return CachedFileInfo(f, f.name, f.length(), mime)
                    }
                }

                // 2. Query MIME type from provider or intent
                var resolvedMime = try {
                    if (scheme == "content") resolver.getType(uri) ?: intentMimeType ?: "" else intentMimeType ?: ""
                } catch (_: Exception) {
                    intentMimeType ?: ""
                }

                // 3. Query display name
                var displayName: String? = null
                if (scheme == "content") {
                    try {
                        resolver.query(uri, null, null, null, null)?.use { cursor ->
                            val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                            if (nameIdx >= 0 && cursor.moveToFirst()) {
                                displayName = cursor.getString(nameIdx)
                            }
                        }
                    } catch (_: Exception) {}
                }

                if (displayName.isNullOrBlank()) {
                    val path = uri.path
                    val cut = path?.lastIndexOf('/')
                    if (cut != null && cut != -1) {
                        displayName = path.substring(cut + 1)
                    }
                }

                if (displayName.isNullOrBlank()) {
                    displayName = "document_${System.currentTimeMillis()}"
                }

                var cleanName = displayName!!.replace(Regex("[\\\\/:*?\"<>|]"), "_")

                // Ensure valid extension
                val currentExt = cleanName.substringAfterLast('.', "")
                val hasValidExt = currentExt.isNotBlank() && currentExt.length in 2..5 && !currentExt.contains(" ")

                if (!hasValidExt) {
                    val extFromMime = if (resolvedMime.isNotBlank()) {
                        MimeTypeMap.getSingleton().getExtensionFromMimeType(resolvedMime)
                    } else null

                    val extToAppend = when {
                        !extFromMime.isNullOrBlank() -> extFromMime
                        resolvedMime.contains("pdf") -> "pdf"
                        resolvedMime.contains("word") || resolvedMime.contains("document") -> "docx"
                        resolvedMime.contains("sheet") || resolvedMime.contains("excel") -> "xlsx"
                        resolvedMime.contains("presentation") || resolvedMime.contains("powerpoint") -> "pptx"
                        resolvedMime.contains("csv") -> "csv"
                        resolvedMime.contains("plain") || resolvedMime.contains("text") -> "txt"
                        resolvedMime.contains("zip") -> "zip"
                        resolvedMime.contains("rar") -> "rar"
                        resolvedMime.contains("jpeg") || resolvedMime.contains("jpg") -> "jpg"
                        resolvedMime.contains("png") -> "png"
                        resolvedMime.contains("audio") -> "mp3"
                        resolvedMime.contains("video") -> "mp4"
                        else -> ""
                    }

                    if (extToAppend.isNotBlank()) {
                        cleanName = "$cleanName.$extToAppend"
                    }
                }

                val incomingDir = File(context.cacheDir, "incoming")
                if (!incomingDir.exists()) incomingDir.mkdirs()

                val safeUniqueName = "shared_${System.currentTimeMillis()}_$cleanName"
                val destFile = File(incomingDir, safeUniqueName)

                // Copy stream
                val inputStream = resolver.openInputStream(uri) ?: return null
                inputStream.use { input ->
                    FileOutputStream(destFile).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var read: Int
                        var total = 0L
                        val maxCap = 500L * 1024L * 1024L // 500MB safety cap
                        while (input.read(buffer).also { read = it } != -1) {
                            total += read
                            if (total > maxCap) {
                                output.close()
                                destFile.delete()
                                return null
                            }
                            output.write(buffer, 0, read)
                        }
                    }
                }

                if (!destFile.exists() || destFile.length() == 0L) {
                    return null
                }

                // Check magic bytes if extension or mimeType was generic
                if (!cleanName.contains(".") || resolvedMime.isBlank() || resolvedMime == "application/octet-stream") {
                    try {
                        val header = ByteArray(16)
                        FileInputStream(destFile).use { it.read(header) }
                        if (header.size >= 4) {
                            if (header[0] == 0x25.toByte() && header[1] == 0x50.toByte() && header[2] == 0x44.toByte() && header[3] == 0x46.toByte()) {
                                resolvedMime = "application/pdf"
                                if (!cleanName.endsWith(".pdf", ignoreCase = true)) {
                                    val renamed = File(incomingDir, "$safeUniqueName.pdf")
                                    if (destFile.renameTo(renamed)) {
                                        return CachedFileInfo(renamed, "$cleanName.pdf", renamed.length(), resolvedMime)
                                    }
                                }
                            } else if (header[0] == 0x50.toByte() && header[1] == 0x4B.toByte() && header[2] == 0x03.toByte() && header[3] == 0x04.toByte()) {
                                if (resolvedMime.isBlank() || resolvedMime == "application/octet-stream") {
                                    resolvedMime = "application/zip"
                                }
                            } else if (header[0] == 0x52.toByte() && header[1] == 0x61.toByte() && header[2] == 0x72.toByte() && header[3] == 0x21.toByte()) {
                                resolvedMime = "application/x-rar-compressed"
                                if (!cleanName.endsWith(".rar", ignoreCase = true)) {
                                    val renamed = File(incomingDir, "$safeUniqueName.rar")
                                    if (destFile.renameTo(renamed)) {
                                        return CachedFileInfo(renamed, "$cleanName.rar", renamed.length(), resolvedMime)
                                    }
                                }
                            }
                        }
                    } catch (_: Exception) {}
                }

                return CachedFileInfo(
                    file = destFile,
                    name = cleanName,
                    size = destFile.length(),
                    mimeType = if (resolvedMime.isNotBlank()) resolvedMime else "*/*"
                )
            } catch (e: Exception) {
                android.util.Log.e("ArchiveModule", "cacheIncomingUri error: ${e.message}", e)
                return null
            }
        }

        fun sendSharedFileEvent(context: ReactContext?, params: WritableMap) {
            try {
                if (context != null && context.hasActiveReactInstance()) {
                    context
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("onSharedFile", params)
                }
            } catch (_: Exception) {}
        }

        fun handleIncomingIntent(context: ReactContext?, intent: Intent) {
            try {
                val uri = com.ufv_rn_poc.MainActivity.extractUriFromIntent(intent) ?: return
                val ctx = context ?: instance?.reactContext ?: return
                val cached = cacheIncomingUri(ctx, uri, intent.type)
                if (cached != null) {
                    val map = Arguments.createMap().apply {
                        putString("uri", "file://${cached.file.absolutePath}")
                        putString("path", cached.file.absolutePath)
                        putString("name", cached.name)
                        putDouble("size", cached.size.toDouble())
                        putString("mimeType", cached.mimeType)
                        putString("action", intent.action)
                    }
                    sendSharedFileEvent(context, map)
                }
            } catch (e: Exception) {
                android.util.Log.w("ArchiveModule", "handleIncomingIntent error: ${e.message}")
            }
        }

        fun stopActivePlayback() {
            try {
                instance?.stopAudioInternal()
            } catch (_: Exception) {}
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
            val resolver = (currentActivity ?: reactContext).contentResolver
            try {
                resolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (index != -1) {
                            name = cursor.getString(index)
                        }
                    }
                }
            } catch (_: Exception) {}
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
        if (filePath.startsWith("content://")) {
            try {
                val uri = Uri.parse(filePath)
                var displayName = "shared_file_${System.currentTimeMillis()}"
                val resolver = (currentActivity ?: reactContext).contentResolver
                try {
                    resolver.query(uri, null, null, null, null)?.use { cursor ->
                        val nameIdx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (nameIdx >= 0 && cursor.moveToFirst()) {
                            val name = cursor.getString(nameIdx)
                            if (!name.isNullOrBlank()) {
                                displayName = name
                            }
                        }
                    }
                } catch (_: Exception) {}

                val incomingDir = File(reactContext.cacheDir, "incoming")
                if (!incomingDir.exists()) incomingDir.mkdirs()
                val targetFile = File(incomingDir, displayName)

                // If already cached and recent (< 60s), reuse it
                if (targetFile.exists() && targetFile.length() > 0 && (System.currentTimeMillis() - targetFile.lastModified() < 60000)) {
                    return targetFile
                }

                resolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(targetFile).use { output ->
                        input.copyTo(output)
                    }
                }
                if (targetFile.exists() && targetFile.length() > 0) {
                    return targetFile
                }
            } catch (e: Exception) {
                android.util.Log.w("ArchiveModule", "Failed to resolve content URI: ${e.message}")
            }
        }

        val decodedPath = try {
            java.net.URLDecoder.decode(filePath, "UTF-8")
        } catch (_: Exception) {
            filePath
        }

        val cleanPath = if (filePath.startsWith("file://")) filePath.substring(7) else filePath
        val cleanDecodedPath = if (decodedPath.startsWith("file://")) decodedPath.substring(7) else decodedPath

        val f1 = File(cleanDecodedPath)
        if (f1.exists() && f1.isFile) return f1

        val f2 = File(cleanPath)
        if (f2.exists() && f2.isFile) return f2

        val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        val candidates = listOf(
            f1,
            f2,
            File(reactContext.cacheDir, f1.name),
            File(reactContext.cacheDir, f2.name),
            File(reactContext.cacheDir, "incoming/${f1.name}"),
            File(reactContext.cacheDir, "incoming/${f2.name}"),
            File(reactContext.cacheDir, "zip_extracted/${f1.name}"),
            File(reactContext.cacheDir, "rar_extracted/${f1.name}"),
            File(downloadDir, f1.name),
            File(downloadDir, f2.name),
            File("/sdcard/Download", f1.name),
            File("/storage/emulated/0/Download", f1.name),
            File("/sdcard/Download", f2.name),
            File("/storage/emulated/0/Download", f2.name),
            File("/sdcard/my_test_files", f1.name),
            File("/sdcard/my_test_files", f2.name),
            File("/data/local/tmp/my_test_files", f1.name),
            File("/data/local/tmp/test_assets", f1.name),
            File(reactContext.filesDir, f1.name)
        )
        for (c in candidates) {
            if (c.exists() && c.isFile) return c
        }
        return if (f1.exists()) f1 else f2
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
                    map.putDouble("lastModified", f.lastModified().toDouble())
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
                map.putDouble("lastModified", file.lastModified().toDouble())
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
                val cacheDir = File(reactContext.cacheDir, "pdf_cache")
                if (!cacheDir.exists()) cacheDir.mkdirs()

                // Fast disk cache check
                val safePathHash = Math.abs(file.absolutePath.hashCode())
                val cacheKey = "pdf_p_${safePathHash}_${file.lastModified()}_${pageIndex}_w${targetWidth}.jpg"
                val cachedOutFile = File(cacheDir, cacheKey)
                if (cachedOutFile.exists() && cachedOutFile.length() > 0) {
                    val map = Arguments.createMap()
                    map.putString("status", "SUCCESS")
                    map.putString("imagePath", "file://${cachedOutFile.absolutePath}")
                    map.putInt("pageIndex", pageIndex)
                    map.putInt("pageCount", 0)
                    map.putInt("width", if (targetWidth > 0) targetWidth else 1000)
                    map.putInt("height", 0)
                    map.putDouble("renderLatencyMs", (System.currentTimeMillis() - startTime).toDouble())
                    map.putBoolean("fromCache", true)
                    promise.resolve(map)
                    return@launch
                }

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

                FileOutputStream(cachedOutFile).use { fos ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 85, fos)
                }
                bitmap.recycle()

                val elapsed = System.currentTimeMillis() - startTime
                val map = Arguments.createMap()
                map.putString("status", "SUCCESS")
                map.putString("imagePath", "file://${cachedOutFile.absolutePath}")
                map.putInt("pageIndex", pageIndex)
                map.putInt("pageCount", renderer.pageCount)
                map.putInt("width", bmpW)
                map.putInt("height", bmpH)
                map.putDouble("renderLatencyMs", elapsed.toDouble())
                map.putBoolean("fromCache", false)
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
    fun searchPdfText(filePath: String, query: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "PDF file not found: $filePath")
                    return@launch
                }

                val trimmedQuery = query.trim()
                if (trimmedQuery.isEmpty()) {
                    val map = Arguments.createMap()
                    map.putString("query", "")
                    map.putInt("totalMatches", 0)
                    map.putArray("matchingPages", Arguments.createArray())
                    map.putArray("pageMatchCounts", Arguments.createArray())
                    map.putArray("matches", Arguments.createArray())
                    promise.resolve(map)
                    return@launch
                }

                val bytes = file.readBytes()
                val str = String(bytes, Charset.forName("ISO-8859-1"))

                // Helper to unescape PDF literal strings
                fun unescapePdfLiteral(raw: String): ByteArray {
                    val out = ArrayList<Byte>()
                    var i = 0
                    val len = raw.length
                    while (i < len) {
                        if (raw[i] == '\\') {
                            i++
                            if (i >= len) break
                            val c = raw[i]
                            when (c) {
                                'n' -> { out.add(0x0a.toByte()); i++ }
                                'r' -> { out.add(0x0d.toByte()); i++ }
                                't' -> { out.add(0x09.toByte()); i++ }
                                'b' -> { out.add(0x08.toByte()); i++ }
                                'f' -> { out.add(0x0c.toByte()); i++ }
                                '(' -> { out.add('('.code.toByte()); i++ }
                                ')' -> { out.add(')'.code.toByte()); i++ }
                                '\\' -> { out.add('\\'.code.toByte()); i++ }
                                in '0'..'7' -> {
                                    var oct = "" + c
                                    i++
                                    if (i < len && raw[i] in '0'..'7') {
                                        oct += raw[i]
                                        i++
                                        if (i < len && raw[i] in '0'..'7') {
                                            oct += raw[i]
                                            i++
                                        }
                                    }
                                    try {
                                        out.add(oct.toInt(8).toByte())
                                    } catch (_: Exception) {}
                                }
                                '\r', '\n' -> {
                                    if (c == '\r' && i + 1 < len && raw[i + 1] == '\n') i++
                                    i++
                                }
                                else -> {
                                    out.add(c.code.toByte())
                                    i++
                                }
                            }
                        } else {
                            out.add(raw[i].code.toByte())
                            i++
                        }
                    }
                    val res = ByteArray(out.size)
                    for (k in out.indices) res[k] = out[k]
                    return res
                }

                // 1. Build CMap from all begincmap streams
                val cmapMap = mutableMapOf<Int, Char>()
                var pos = 0
                while (true) {
                    val sIdx = str.indexOf("stream", pos)
                    if (sIdx == -1) break
                    var start = sIdx + 6
                    if (start < bytes.size && bytes[start] == '\r'.code.toByte()) start++
                    if (start < bytes.size && bytes[start] == '\n'.code.toByte()) start++

                    val eIdx = str.indexOf("endstream", start)
                    if (eIdx == -1) break
                    var end = eIdx
                    if (end > start && bytes[end - 1] == '\n'.code.toByte()) end--
                    if (end > start && bytes[end - 1] == '\r'.code.toByte()) end--

                    if (end > start && start < bytes.size) {
                        try {
                            val rawStream = bytes.copyOfRange(start, end.coerceAtMost(bytes.size))
                            var decompressed: ByteArray? = null
                            try {
                                val inf = Inflater()
                                inf.setInput(rawStream)
                                val bos = ByteArrayOutputStream()
                                val buf = ByteArray(4096)
                                while (!inf.finished()) {
                                    val count = inf.inflate(buf)
                                    if (count <= 0 && inf.needsInput()) break
                                    bos.write(buf, 0, count)
                                }
                                inf.end()
                                decompressed = bos.toByteArray()
                            } catch (_: Exception) {
                                try {
                                    val inf = Inflater(true)
                                    inf.setInput(rawStream)
                                    val bos = ByteArrayOutputStream()
                                    val buf = ByteArray(4096)
                                    while (!inf.finished()) {
                                        val count = inf.inflate(buf)
                                        if (count <= 0 && inf.needsInput()) break
                                        bos.write(buf, 0, count)
                                    }
                                    inf.end()
                                    decompressed = bos.toByteArray()
                                } catch (_: Exception) {}
                            }

                            if (decompressed != null) {
                                val cStr = String(decompressed, Charset.forName("UTF-8"))
                                if (cStr.contains("begincmap")) {
                                    val bfcharRegex = Regex("""beginbfchar([\s\S]*?)endbfchar""")
                                    for (m in bfcharRegex.findAll(cStr)) {
                                        val lines = m.groupValues[1].lines()
                                        for (line in lines) {
                                            val parts = Regex("""<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>""").find(line)
                                            if (parts != null) {
                                                val cid = parts.groupValues[1].toIntOrNull(16)
                                                val uni = parts.groupValues[2].toIntOrNull(16)
                                                if (cid != null && uni != null) {
                                                    cmapMap[cid] = uni.toChar()
                                                }
                                            }
                                        }
                                    }

                                    val bfrangeRegex = Regex("""beginbfrange([\s\S]*?)endbfrange""")
                                    for (m in bfrangeRegex.findAll(cStr)) {
                                        val lines = m.groupValues[1].lines()
                                        for (line in lines) {
                                            val parts = Regex("""<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>""").find(line)
                                            if (parts != null) {
                                                val startCid = parts.groupValues[1].toIntOrNull(16)
                                                val endCid = parts.groupValues[2].toIntOrNull(16)
                                                val destUni = parts.groupValues[3].toIntOrNull(16)
                                                if (startCid != null && endCid != null && destUni != null) {
                                                    for (c in startCid..endCid) {
                                                        cmapMap[c] = (destUni + (c - startCid)).toChar()
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (_: Exception) {}
                    }
                    pos = eIdx + 9
                }

                // Helper to decode extracted bytes (using CMap or fallback)
                fun decodeBytes(rawBytes: ByteArray): String {
                    if (rawBytes.isEmpty()) return ""
                    var isCid = false
                    var i = 0
                    while (i < rawBytes.size) {
                        if (i + 1 < rawBytes.size) {
                            val b1 = rawBytes[i].toInt() and 0xFF
                            val b2 = rawBytes[i + 1].toInt() and 0xFF
                            val cid = (b1 shl 8) or b2
                            if (cmapMap.containsKey(cid)) {
                                isCid = true
                                break
                            }
                        }
                        i += 2
                    }

                    val sb = StringBuilder()
                    if (isCid) {
                        i = 0
                        while (i < rawBytes.size) {
                            if (i + 1 < rawBytes.size) {
                                val b1 = rawBytes[i].toInt() and 0xFF
                                val b2 = rawBytes[i + 1].toInt() and 0xFF
                                val cid = (b1 shl 8) or b2
                                val ch = cmapMap[cid]
                                if (ch != null) {
                                    sb.append(ch)
                                } else {
                                    sb.append(b1.toChar()).append(b2.toChar())
                                }
                            } else {
                                sb.append((rawBytes[i].toInt() and 0xFF).toChar())
                            }
                            i += 2
                        }
                    } else {
                        sb.append(String(rawBytes, Charset.forName("ISO-8859-1")))
                    }
                    return sb.toString()
                }

                fun extractAllTextFromStream(streamStr: String): String {
                    val sb = StringBuilder()
                    val tjRegex = Regex("""\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")""")
                    for (m in tjRegex.findAll(streamStr)) {
                        val unescaped = unescapePdfLiteral(m.groupValues[1])
                        sb.append(decodeBytes(unescaped))
                    }
                    val tjArrayRegex = Regex("""\[([^\]]+)\]\s*TJ""")
                    for (m in tjArrayRegex.findAll(streamStr)) {
                        val inner = m.groupValues[1]
                        val innerRegex = Regex("""\(((?:[^()\\]|\\.)*)\)""")
                        for (im in innerRegex.findAll(inner)) {
                            val unescaped = unescapePdfLiteral(im.groupValues[1])
                            sb.append(decodeBytes(unescaped))
                        }
                        sb.append(" ")
                    }
                    return sb.toString()
                }

                // 2. Parse all objects and decompress streams
                val objMap = mutableMapOf<Int, String>()
                val streamMap = mutableMapOf<Int, String>()
                val objHeaderRegex = Regex("""(\d+)\s+0\s+obj""")
                val objMatches = objHeaderRegex.findAll(str).toList()
                for (idx in objMatches.indices) {
                    val curMatch = objMatches[idx]
                    val id = curMatch.groupValues[1].toIntOrNull() ?: continue
                    val startPos = curMatch.range.first
                    val nextPos = if (idx + 1 < objMatches.size) objMatches[idx + 1].range.first else str.length
                    val body = str.substring(startPos, nextPos)
                    objMap[id] = body

                    val sIdx = body.indexOf("stream")
                    if (sIdx != -1) {
                        var streamStart = startPos + sIdx + 6
                        if (streamStart < bytes.size && bytes[streamStart] == '\r'.code.toByte()) streamStart++
                        if (streamStart < bytes.size && bytes[streamStart] == '\n'.code.toByte()) streamStart++
                        val endstreamIdx = str.indexOf("endstream", streamStart)
                        if (endstreamIdx != -1) {
                            var streamEnd = endstreamIdx
                            if (streamEnd > streamStart && bytes[streamEnd - 1] == '\n'.code.toByte()) streamEnd--
                            if (streamEnd > streamStart && bytes[streamEnd - 1] == '\r'.code.toByte()) streamEnd--

                            if (streamEnd > streamStart && streamStart < bytes.size) {
                                val rawStream = bytes.copyOfRange(streamStart, streamEnd.coerceAtMost(bytes.size))
                                var decompressed: ByteArray? = null
                                try {
                                    val inf = Inflater()
                                    inf.setInput(rawStream)
                                    val bos = ByteArrayOutputStream()
                                    val buf = ByteArray(4096)
                                    while (!inf.finished()) {
                                        val count = inf.inflate(buf)
                                        if (count <= 0 && inf.needsInput()) break
                                        bos.write(buf, 0, count)
                                    }
                                    inf.end()
                                    decompressed = bos.toByteArray()
                                } catch (_: Exception) {
                                    try {
                                        val inf = Inflater(true)
                                        inf.setInput(rawStream)
                                        val bos = ByteArrayOutputStream()
                                        val buf = ByteArray(4096)
                                        while (!inf.finished()) {
                                            val count = inf.inflate(buf)
                                            if (count <= 0 && inf.needsInput()) break
                                            bos.write(buf, 0, count)
                                        }
                                        inf.end()
                                        decompressed = bos.toByteArray()
                                    } catch (_: Exception) {}
                                }
                                val finalBytes = decompressed ?: rawStream
                                streamMap[id] = String(finalBytes, Charset.forName("ISO-8859-1"))
                            }
                        }
                    }
                }

                // 3. Find Page IDs from /Type /Pages /Kids or scan /Type /Page
                val pageIds = mutableListOf<Int>()
                val kidsMatch = Regex("""/Type\s*/Pages[\s\S]*?/Kids\s*\[([^\]]+)\]""").find(str)
                if (kidsMatch != null) {
                    val kidRefs = Regex("""(\d+)\s+0\s+R""").findAll(kidsMatch.groupValues[1])
                    for (kr in kidRefs) {
                        val pid = kr.groupValues[1].toIntOrNull()
                        if (pid != null) pageIds.add(pid)
                    }
                }
                if (pageIds.isEmpty()) {
                    val pageRegex = Regex("""(\d+)\s+0\s+obj[\s\S]*?/Type\s*/Page\b""")
                    for (pm in pageRegex.findAll(str)) {
                        val pid = pm.groupValues[1].toIntOrNull()
                        if (pid != null && !pageIds.contains(pid)) pageIds.add(pid)
                    }
                }

                // 4. Extract text & streams per page
                val pageTexts = mutableListOf<String>()
                val pageStreamsList = mutableListOf<List<Pair<String, Boolean>>>()

                for (pId in pageIds) {
                    val pageBody = objMap[pId] ?: ""
                    val pageSb = StringBuilder()
                    val pageStreams = mutableListOf<Pair<String, Boolean>>()

                    // /Contents
                    val contentsMatch = Regex("""/Contents\s+(?:(\d+)\s+0\s+R|\[([^\]]+)\])""").find(pageBody)
                    if (contentsMatch != null) {
                        val singleId = contentsMatch.groupValues[1].toIntOrNull()
                        val refIds = if (singleId != null) {
                            listOf(singleId)
                        } else {
                            Regex("""(\d+)\s+0\s+R""").findAll(contentsMatch.groupValues[2]).mapNotNull { it.groupValues[1].toIntOrNull() }.toList()
                        }
                        for (rId in refIds) {
                            val st = streamMap[rId]
                            if (st != null) {
                                pageSb.append(extractAllTextFromStream(st)).append(" ")
                                pageStreams.add(Pair(st, false))
                            }
                        }
                    }

                    // Form XObjects in /Resources /XObject
                    val xobjSection = Regex("""/XObject\s*<<([\s\S]*?)>>""").find(pageBody)
                    if (xobjSection != null) {
                        val xRefs = Regex("""(\d+)\s+0\s+R""").findAll(xobjSection.groupValues[1]).mapNotNull { it.groupValues[1].toIntOrNull() }
                        for (xId in xRefs) {
                            val st = streamMap[xId]
                            if (st != null) {
                                pageSb.append(extractAllTextFromStream(st)).append(" ")
                                pageStreams.add(Pair(st, true))
                            }
                        }
                    }

                    pageTexts.add(pageSb.toString())
                    pageStreamsList.add(pageStreams)
                }

                // Fallback if no pages identified: search all streams
                if (pageTexts.isEmpty()) {
                    for ((_, st) in streamMap) {
                        pageTexts.add(extractAllTextFromStream(st))
                        pageStreamsList.add(listOf(Pair(st, false)))
                    }
                }

                // Helper to compute exact on-page highlight rectangles
                class MatchBox(val x: Double, val y: Double, val width: Double, val height: Double)

                fun findMatchBoxes(streamRaw: String, q: String, pageW: Double, pageH: Double, isXObject: Boolean): List<MatchBox> {
                    val boxes = mutableListOf<MatchBox>()
                    val lines = streamRaw.split(Regex("""[\r\n]+"""))
                    var curCm = doubleArrayOf(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
                    var curTfSize = 12.0
                    var curTextX = 0.0
                    var curTextY = 0.0
                    val currentWord = StringBuilder()
                    var wordStartX = 0.0
                    var wordStartY = 0.0
                    var wordCm = curCm.clone()
                    var wordTf = 12.0

                    val lowerQ = q.lowercase(Locale.ROOT)
                    val globalCm = if (isXObject) doubleArrayOf(0.24, 0.0, 0.0, -0.24, 0.0, pageH) else doubleArrayOf(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

                    val cmRegex = Regex("""^([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+cm$""")
                    val tfRegex = Regex("""/F\d+\s+([0-9.]+)\s+Tf""")
                    val tmRegex = Regex("""^([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+Tm$""")
                    val tdRegex = Regex("""^([0-9.-]+)\s+([0-9.-]+)\s+Td$""")
                    val tjRegex = Regex("""^\(([\s\S]*)\)\s*Tj$""")

                    for (lineRaw in lines) {
                        val line = lineRaw.trim()
                        if (line.isEmpty()) continue

                        val cmM = cmRegex.find(line)
                        if (cmM != null) {
                            curCm = doubleArrayOf(
                                cmM.groupValues[1].toDoubleOrNull() ?: 1.0,
                                cmM.groupValues[2].toDoubleOrNull() ?: 0.0,
                                cmM.groupValues[3].toDoubleOrNull() ?: 0.0,
                                cmM.groupValues[4].toDoubleOrNull() ?: 1.0,
                                cmM.groupValues[5].toDoubleOrNull() ?: 0.0,
                                cmM.groupValues[6].toDoubleOrNull() ?: 0.0
                            )
                            continue
                        }

                        val tfM = tfRegex.find(line)
                        if (tfM != null) {
                            curTfSize = tfM.groupValues[1].toDoubleOrNull() ?: 12.0
                            continue
                        }

                        if (line == "BT") {
                            curTextX = 0.0
                            curTextY = 0.0
                            continue
                        }

                        val tmM = tmRegex.find(line)
                        if (tmM != null) {
                            curTextX = tmM.groupValues[5].toDoubleOrNull() ?: 0.0
                            curTextY = tmM.groupValues[6].toDoubleOrNull() ?: 0.0
                            continue
                        }

                        val tdM = tdRegex.find(line)
                        if (tdM != null) {
                            curTextX += tdM.groupValues[1].toDoubleOrNull() ?: 0.0
                            curTextY += tdM.groupValues[2].toDoubleOrNull() ?: 0.0
                            continue
                        }

                        val tjM = tjRegex.find(line)
                        if (tjM != null) {
                            val unescaped = unescapePdfLiteral(tjM.groupValues[1])
                            val decodedStr = decodeBytes(unescaped)

                            for (ch in decodedStr) {
                                if (currentWord.isEmpty()) {
                                    if (ch.lowercaseChar() == lowerQ[0]) {
                                        currentWord.append(ch)
                                        wordStartX = curTextX
                                        wordStartY = curTextY
                                        wordCm = curCm.clone()
                                        wordTf = curTfSize
                                    }
                                } else {
                                    currentWord.append(ch)
                                    if (currentWord.toString().lowercase(Locale.ROOT) == lowerQ) {
                                        val xForm = wordCm[0] * wordStartX + wordCm[2] * wordStartY + wordCm[4]
                                        val yForm = wordCm[1] * wordStartX + wordCm[3] * wordStartY + wordCm[5]

                                        val xPage: Double
                                        val yPage: Double
                                        val wPage: Double
                                        val hPage: Double

                                        if (isXObject) {
                                            xPage = globalCm[0] * xForm + globalCm[2] * yForm + globalCm[4]
                                            yPage = globalCm[1] * xForm + globalCm[3] * yForm + globalCm[5]
                                            wPage = Math.abs(globalCm[0] * wordCm[0]) * (wordTf * q.length * 0.55)
                                            hPage = Math.abs(globalCm[3] * wordCm[3]) * wordTf
                                        } else {
                                            xPage = xForm
                                            yPage = pageH - yForm
                                            wPage = wordTf * q.length * 0.55
                                            hPage = wordTf
                                        }

                                        val xPct = (xPage / pageW) * 100.0
                                        val yPct = (1.0 - (yPage / pageH)) * 100.0
                                        val wPct = (wPage / pageW) * 100.0
                                        val hPct = (hPage / pageH) * 100.0

                                        boxes.add(MatchBox(
                                            Math.max(2.0, Math.min(95.0, Math.round(xPct * 10.0) / 10.0)),
                                            Math.max(2.0, Math.min(95.0, Math.round(yPct * 10.0) / 10.0)),
                                            Math.max(4.0, Math.min(80.0, Math.round(wPct * 10.0) / 10.0)),
                                            Math.max(1.2, Math.min(10.0, Math.round(hPct * 10.0) / 10.0))
                                        ))
                                        currentWord.clear()
                                    } else if (!lowerQ.startsWith(currentWord.toString().lowercase(Locale.ROOT))) {
                                        currentWord.clear()
                                        if (ch.lowercaseChar() == lowerQ[0]) {
                                            currentWord.append(ch)
                                            wordStartX = curTextX
                                            wordStartY = curTextY
                                            wordCm = curCm.clone()
                                            wordTf = curTfSize
                                        }
                                    }
                                }
                            }
                        }
                    }
                    return boxes
                }

                // 5. Search query in page texts & compute bounding boxes
                var totalMatches = 0
                val matchingPagesArr = Arguments.createArray()
                val pageMatchCountsArr = Arguments.createArray()
                val matchesArr = Arguments.createArray()

                val lowerQuery = trimmedQuery.lowercase(Locale.ROOT)
                for (pIdx in pageTexts.indices) {
                    val pText = pageTexts[pIdx]
                    val lowerPText = pText.lowercase(Locale.ROOT)
                    val pStreams = if (pIdx < pageStreamsList.size) pageStreamsList[pIdx] else emptyList()
                    val pageBoxes = mutableListOf<MatchBox>()
                    for ((st, isXObj) in pStreams) {
                        pageBoxes.addAll(findMatchBoxes(st, trimmedQuery, 595.5, 842.25, isXObj))
                    }

                    var count = 0
                    var cur = 0
                    while (cur < lowerPText.length) {
                        val found = lowerPText.indexOf(lowerQuery, cur)
                        if (found == -1) break
                        count++

                        val box = if (count - 1 < pageBoxes.size) {
                            pageBoxes[count - 1]
                        } else {
                            val ratio = if (pText.isNotEmpty()) found.toDouble() / pText.length.toDouble() else 0.5
                            val fallbackY = (ratio * 80.0 + 8.0).coerceIn(4.0, 92.0)
                            MatchBox(20.0, Math.round(fallbackY * 10.0) / 10.0, (trimmedQuery.length * 1.5).coerceIn(6.0, 40.0), 1.8)
                        }

                        // Extract snippet with 35 chars context
                        val snippetStart = (found - 35).coerceAtLeast(0)
                        val snippetEnd = (found + lowerQuery.length + 35).coerceAtMost(pText.length)
                        val prefix = if (snippetStart > 0) "..." else ""
                        val suffix = if (snippetEnd < pText.length) "..." else ""
                        val snippet = prefix + pText.substring(snippetStart, snippetEnd).trim() + suffix

                        val matchMap = Arguments.createMap()
                        matchMap.putInt("pageIndex", pIdx)
                        matchMap.putInt("matchIndex", totalMatches + count - 1)
                        matchMap.putString("snippet", snippet)
                        matchMap.putDouble("x", box.x)
                        matchMap.putDouble("y", box.y)
                        matchMap.putDouble("width", box.width)
                        matchMap.putDouble("height", box.height)
                        matchesArr.pushMap(matchMap)

                        cur = found + lowerQuery.length
                    }

                    val pMap = Arguments.createMap()
                    pMap.putInt("pageIndex", pIdx)
                    pMap.putInt("count", count)
                    pageMatchCountsArr.pushMap(pMap)

                    if (count > 0) {
                        totalMatches += count
                        matchingPagesArr.pushInt(pIdx)
                    }
                }

                val res = Arguments.createMap()
                res.putString("query", trimmedQuery)
                res.putInt("totalMatches", totalMatches)
                res.putArray("matchingPages", matchingPagesArr)
                res.putArray("pageMatchCounts", pageMatchCountsArr)
                res.putArray("matches", matchesArr)
                promise.resolve(res)
            } catch (e: Exception) {
                promise.reject("SEARCH_PDF_ERROR", "Search failed: ${e.message}", e)
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
                if (filePath.startsWith("content://")) {
                    val resolver = (currentActivity ?: reactContext).contentResolver
                    val bytes = resolver.openInputStream(Uri.parse(filePath))?.use { it.readBytes() }
                    if (bytes != null && bytes.isNotEmpty()) {
                        val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                        promise.resolve(b64)
                        return@launch
                    }
                }
                val file = resolveArchiveFile(filePath)
                if (file.exists() && file.isFile) {
                    val bytes = file.readBytes()
                    val b64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                    promise.resolve(b64)
                } else {
                    throw FileNotFoundException("File not found: $filePath (resolved to: ${file.absolutePath})")
                }
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

    @ReactMethod
    fun cleanTemporaryCache(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                var freedBytes = 0L
                val cacheDir = reactContext.cacheDir
                val files = cacheDir.listFiles()
                if (files != null) {
                    for (file in files) {
                        try {
                            val size = if (file.isDirectory) file.walkTopDown().sumOf { it.length() } else file.length()
                            if (file.deleteRecursively()) {
                                freedBytes += size
                            }
                        } catch (_: Throwable) {}
                    }
                }
                val result = Arguments.createMap()
                result.putDouble("freedBytes", freedBytes.toDouble())
                promise.resolve(result)
            } catch (t: Throwable) {
                promise.reject("CLEAN_CACHE_ERROR", t.message, t)
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

    @ReactMethod
    fun probeMediaCodec(filePath: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            val extractor = android.media.MediaExtractor()
            try {
                val file = resolveArchiveFile(filePath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "File does not exist: $filePath")
                    return@launch
                }
                extractor.setDataSource(file.absolutePath)
                val trackCount = extractor.trackCount
                var hasVideo = false
                var hasAudio = false
                var isVideoSupported = true
                var isAudioSupported = true
                var videoCodec = ""
                var audioCodec = ""
                var durationUs: Long = 0L

                val codecList = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.LOLLIPOP) {
                    android.media.MediaCodecList(android.media.MediaCodecList.REGULAR_CODECS)
                } else null

                for (i in 0 until trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(android.media.MediaFormat.KEY_MIME) ?: ""
                    if (format.containsKey(android.media.MediaFormat.KEY_DURATION)) {
                        val dur = format.getLong(android.media.MediaFormat.KEY_DURATION)
                        if (dur > durationUs) durationUs = dur
                    }

                    if (mime.startsWith("video/")) {
                        hasVideo = true
                        videoCodec = mime
                        if (codecList != null) {
                            val decoder = codecList.findDecoderForFormat(format)
                            if (decoder == null) {
                                isVideoSupported = false
                            }
                        }
                    } else if (mime.startsWith("audio/")) {
                        hasAudio = true
                        audioCodec = mime
                        if (codecList != null) {
                            val decoder = codecList.findDecoderForFormat(format)
                            if (decoder == null) {
                                isAudioSupported = false
                            }
                        }
                    }
                }

                val map = Arguments.createMap()
                map.putBoolean("hasVideo", hasVideo)
                map.putBoolean("hasAudio", hasAudio)
                map.putBoolean("isVideoSupported", isVideoSupported)
                map.putBoolean("isAudioSupported", isAudioSupported)
                map.putBoolean("isSupported", (!hasVideo || isVideoSupported) && (!hasAudio || isAudioSupported))
                map.putString("videoCodec", videoCodec)
                map.putString("audioCodec", audioCodec)
                map.putDouble("durationMs", (durationUs / 1000).toDouble())
                promise.resolve(map)
            } catch (e: Exception) {
                val map = Arguments.createMap()
                map.putBoolean("hasVideo", false)
                map.putBoolean("hasAudio", false)
                map.putBoolean("isSupported", false)
                map.putBoolean("isVideoSupported", false)
                map.putBoolean("isAudioSupported", false)
                map.putString("error", e.message ?: "Failed to probe media")
                promise.resolve(map)
            } finally {
                try {
                    extractor.release()
                } catch (_: Exception) {}
            }
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
                            val map = Arguments.createMap()
                            map.putString("event", "AUDIOFOCUS_LOSS")
                            map.putBoolean("isPlaying", false)
                            sendEvent("onAudioStateChanged", map)
                        }
                    }
                } catch (_: Exception) {}
            }
            android.media.AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                try {
                    mediaPlayer?.setVolume(0.2f, 0.2f)
                } catch (_: Exception) {}
            }
            android.media.AudioManager.AUDIOFOCUS_GAIN -> {
                try {
                    mediaPlayer?.setVolume(1.0f, 1.0f)
                } catch (_: Exception) {}
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
    fun setImmersiveMode(enabled: Boolean, promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.resolve(false)
            return
        }
        activity.runOnUiThread {
            try {
                val window = activity.window ?: return@runOnUiThread
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
                    val controller = window.insetsController
                    if (enabled) {
                        controller?.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
                        controller?.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    } else {
                        controller?.show(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
                    }
                } else {
                    @Suppress("DEPRECATION")
                    if (enabled) {
                        window.decorView.systemUiVisibility = (
                            android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                        )
                    } else {
                        window.decorView.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    }
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("IMMERSIVE_ERROR", e.message)
            }
        }
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
    fun setAudioSpeed(speed: Float, promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val mp = mediaPlayer
                if (mp != null && android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                    val params = mp.playbackParams
                    params.speed = speed.coerceIn(0.25f, 4.0f)
                    mp.playbackParams = params
                    promise.resolve(true)
                } else {
                    promise.resolve(false)
                }
            } catch (e: Exception) {
                promise.reject("SET_SPEED_ERROR", e.message, e)
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
                    clipData = ClipData.newRawUri("Shared file", uri)
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

    @ReactMethod
    fun shareMultipleFiles(filePaths: ReadableArray, mimeType: String?, promise: Promise) {
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val count = filePaths.size()
                if (count == 0) {
                    promise.resolve(false)
                    return@launch
                }

                val context = currentActivity ?: reactContext
                val uris = ArrayList<Uri>()
                val authority = "${reactContext.packageName}.fileprovider"

                for (i in 0 until count) {
                    val p = filePaths.getString(i) ?: continue
                    try {
                        val f = resolveArchiveFile(p)
                        if (f.exists()) {
                            val uri = androidx.core.content.FileProvider.getUriForFile(
                                reactContext,
                                authority,
                                f
                            )
                            uris.add(uri)
                        }
                    } catch (e: Exception) {
                        android.util.Log.w("ArchiveModule", "Failed to resolve file for sharing: $p, ${e.message}")
                    }
                }

                if (uris.isEmpty()) {
                    promise.reject("FILES_NOT_FOUND", "None of the selected files exist")
                    return@launch
                }

                val intent: Intent
                val chooserTitle: String

                if (uris.size == 1) {
                    intent = Intent(Intent.ACTION_SEND).apply {
                        type = if (!mimeType.isNullOrBlank()) mimeType else "*/*"
                        putExtra(Intent.EXTRA_STREAM, uris[0])
                        clipData = ClipData.newRawUri("Shared file", uris[0])
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    chooserTitle = "Share file"
                } else {
                    intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                        type = if (!mimeType.isNullOrBlank()) mimeType else "*/*"
                        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
                        val clip = ClipData.newRawUri("Shared file 0", uris[0])
                        for (j in 1 until uris.size) {
                            clip.addItem(ClipData.Item(uris[j]))
                        }
                        clipData = clip
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    chooserTitle = "Share ${uris.size} files"
                }

                val chooser = Intent.createChooser(intent, chooserTitle).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    if (intent.clipData != null) {
                        clipData = intent.clipData
                    }
                }

                for (u in uris) {
                    try {
                        context.grantUriPermission(context.packageName, u, Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    } catch (_: Exception) {}
                }

                context.startActivity(chooser)
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("SHARE_MULTIPLE_ERROR", e.message, e)
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

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for React Native built-in NativeEventEmitter calls
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for React Native built-in NativeEventEmitter calls
    }

    fun processIncomingIntent(intent: Intent) {
        val uri: Uri? = com.ufv_rn_poc.MainActivity.extractUriFromIntent(intent)
        if (uri != null) {
            val cached = cacheIncomingUri(currentActivity ?: reactContext, uri, intent.type)
            if (cached != null) {
                val map = Arguments.createMap().apply {
                    putString("uri", "file://${cached.file.absolutePath}")
                    putString("path", cached.file.absolutePath)
                    putString("name", cached.name)
                    putDouble("size", cached.size.toDouble())
                    putString("mimeType", cached.mimeType)
                    putString("action", intent.action)
                }
                sendEvent("onSharedFile", map)
            }
        }
    }

    @ReactMethod
    fun getInitialSharedFile(promise: Promise) {
        try {
            val cached = com.ufv_rn_poc.MainActivity.cachedSharedFile
            if (cached != null) {
                com.ufv_rn_poc.MainActivity.cachedSharedFile = null
                promise.resolve(cached)
                return
            }
            val act = currentActivity
            val incomingIntent = com.ufv_rn_poc.MainActivity.initialIntent ?: act?.intent
            if (incomingIntent != null) {
                val uri: Uri? = com.ufv_rn_poc.MainActivity.extractUriFromIntent(incomingIntent)
                if (uri != null) {
                    val context = act ?: reactContext
                    val cachedInfo = cacheIncomingUri(context, uri, incomingIntent.type)
                    if (cachedInfo != null) {
                        val map = Arguments.createMap().apply {
                            putString("uri", "file://${cachedInfo.file.absolutePath}")
                            putString("path", cachedInfo.file.absolutePath)
                            putString("name", cachedInfo.name)
                            putDouble("size", cachedInfo.size.toDouble())
                            putString("mimeType", cachedInfo.mimeType)
                            putString("action", incomingIntent.action)
                        }
                        com.ufv_rn_poc.MainActivity.initialIntent = null
                        promise.resolve(map)
                        return
                    }
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

                // 1. If already a direct local file
                if (uri.scheme == "file" || uri.scheme.isNullOrBlank()) {
                    val rawPath = uri.path ?: uriString.removePrefix("file://")
                    val f = File(rawPath)
                    if (f.exists()) {
                        val map = Arguments.createMap().apply {
                            putString("path", f.absolutePath)
                            putString("name", f.name)
                            putDouble("size", f.length().toDouble())
                        }
                        promise.resolve(map)
                        return@launch
                    }
                }

                // 2. Cache incoming content URI safely
                val context = currentActivity ?: reactContext
                val cached = cacheIncomingUri(context, uri, null)
                if (cached != null && cached.file.exists()) {
                    val map = Arguments.createMap().apply {
                        putString("path", cached.file.absolutePath)
                        putString("name", cached.name)
                        putDouble("size", cached.size.toDouble())
                        putString("mimeType", cached.mimeType)
                    }
                    promise.resolve(map)
                    return@launch
                }

                // 3. Fallback: plain file check
                val clean = if (uriString.startsWith("file://")) uriString.removePrefix("file://") else uriString
                val f = File(clean)
                val map = Arguments.createMap().apply {
                    putString("path", f.absolutePath)
                    putString("name", f.name)
                    putDouble("size", if (f.exists()) f.length().toDouble() else 0.0)
                }
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


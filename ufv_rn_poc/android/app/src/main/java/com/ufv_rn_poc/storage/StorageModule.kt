package com.ufv_rn_poc.storage

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

class StorageModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), ActivityEventListener {

    companion object {
        const val NAME = "StorageModule"
        private const val REQUEST_CODE_SAF_TREE = 9021
        private const val PREFS_NAME = "ufv_storage_prefs"
        private const val KEY_SAF_TREE_URI = "saf_tree_uri"
    }

    private var pendingTreePromise: Promise? = null

    init {
        reactContext.addActivityEventListener(this)
    }

    override fun getName(): String = NAME

    override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQUEST_CODE_SAF_TREE) {
            val promise = pendingTreePromise
            pendingTreePromise = null
            if (resultCode == Activity.RESULT_OK && data != null) {
                val uri = data.data
                if (uri != null) {
                    try {
                        val takeFlags: Int = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        reactContext.contentResolver.takePersistableUriPermission(uri, takeFlags and (data.flags))

                        val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        prefs.edit().putString(KEY_SAF_TREE_URI, uri.toString()).apply()

                        val result = Arguments.createMap().apply {
                            putBoolean("granted", true)
                            putString("uri", uri.toString())
                        }
                        promise?.resolve(result)
                        return
                    } catch (e: Exception) {
                        Log.e(NAME, "Failed to take persistable URI permission: ${e.message}")
                        promise?.reject("PERSIST_PERMISSION_FAILED", "Failed to persist SAF permission: ${e.message}", e)
                        return
                    }
                }
            }
            val result = Arguments.createMap().apply {
                putBoolean("granted", false)
                putString("uri", null)
            }
            promise?.resolve(result)
        }
    }

    override fun onNewIntent(intent: Intent?) {}

    private fun getSavedTreeUri(): Uri? {
        val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val uriStr = prefs.getString(KEY_SAF_TREE_URI, null) ?: return null
        return try {
            Uri.parse(uriStr)
        } catch (e: Exception) {
            null
        }
    }

    @ReactMethod
    fun getPermissionState(promise: Promise) {
        try {
            val map = Arguments.createMap()

            // 1. Media Permission
            val mediaStatus: String = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                // Android 14 partial media check
                val hasImages = ContextCompat.checkSelfPermission(reactContext, android.Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
                val hasVideo = ContextCompat.checkSelfPermission(reactContext, android.Manifest.permission.READ_MEDIA_VIDEO) == PackageManager.PERMISSION_GRANTED
                val hasAudio = ContextCompat.checkSelfPermission(reactContext, android.Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED
                val hasVisualUserSelected = ContextCompat.checkSelfPermission(reactContext, "android.permission.READ_MEDIA_VISUAL_USER_SELECTED") == PackageManager.PERMISSION_GRANTED

                when {
                    hasImages && hasVideo && hasAudio -> "granted"
                    hasVisualUserSelected -> "partial"
                    else -> "denied"
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val hasImages = ContextCompat.checkSelfPermission(reactContext, android.Manifest.permission.READ_MEDIA_IMAGES) == PackageManager.PERMISSION_GRANTED
                val hasAudio = ContextCompat.checkSelfPermission(reactContext, android.Manifest.permission.READ_MEDIA_AUDIO) == PackageManager.PERMISSION_GRANTED
                if (hasImages && hasAudio) "granted" else "denied"
            } else {
                val hasStorage = ContextCompat.checkSelfPermission(reactContext, android.Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
                if (hasStorage) "granted" else "denied"
            }
            map.putString("media", mediaStatus)

            // 2. Documents Tree (SAF)
            val treeUri = getSavedTreeUri()
            var isTreeValid = false
            if (treeUri != null) {
                val persistedUris = reactContext.contentResolver.persistedUriPermissions
                isTreeValid = persistedUris.any { it.uri == treeUri && it.isReadPermission }
            }
            map.putBoolean("documentsTreeGranted", isTreeValid)
            map.putString("treeUri", if (isTreeValid) treeUri.toString() else null)

            // 3. All Files Access (MANAGE_EXTERNAL_STORAGE)
            val allFiles = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Environment.isExternalStorageManager()
            } else {
                ContextCompat.checkSelfPermission(reactContext, android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
            }
            map.putBoolean("allFiles", allFiles)

            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("PERMISSION_STATE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun requestDocumentsTree(promise: Promise) {
        val activity = currentActivity
        if (activity == null) {
            promise.reject("ACTIVITY_UNAVAILABLE", "Activity is null")
            return
        }

        try {
            pendingTreePromise = promise
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or
                         Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                         Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                         Intent.FLAG_GRANT_PREFIX_URI_PERMISSION)
            }
            activity.startActivityForResult(intent, REQUEST_CODE_SAF_TREE)
        } catch (e: Exception) {
            pendingTreePromise = null
            promise.reject("SAF_REQUEST_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getStorageDashboardCounts(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val counts = mutableMapOf(
                    "PDF" to CategoryCount("PDF"),
                    "WORD" to CategoryCount("WORD"),
                    "EXCEL" to CategoryCount("EXCEL"),
                    "PPT" to CategoryCount("PPT"),
                    "ARCHIVE" to CategoryCount("ARCHIVE"),
                    "AUDIO" to CategoryCount("AUDIO"),
                    "VIDEO" to CategoryCount("VIDEO"),
                    "IMAGE" to CategoryCount("IMAGE")
                )

                // 1. Media counts via MediaStore
                val mediaStrategy = MediaStoreStrategy(reactContext)
                val mediaCounts = mediaStrategy.getCategoryCounts()
                for ((k, v) in mediaCounts) {
                    val target = counts.getOrPut(k) { CategoryCount(k) }
                    target.count += v.count
                    target.totalBytes += v.totalBytes
                }

                // 2. Documents & Archives via SAF Tree if available
                val treeUri = getSavedTreeUri()
                if (treeUri != null) {
                    val safStrategy = SafTreeStrategy(reactContext, treeUri)
                    val docCounts = safStrategy.getCategoryCounts()
                    for ((k, v) in docCounts) {
                        if (k != "AUDIO" && k != "VIDEO" && k != "IMAGE") {
                            val target = counts.getOrPut(k) { CategoryCount(k) }
                            target.count += v.count
                            target.totalBytes += v.totalBytes
                        }
                    }
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
                    val allFilesStrategy = AllFilesStrategy()
                    val allCounts = allFilesStrategy.getCategoryCounts()
                    for ((k, v) in allCounts) {
                        if (k != "AUDIO" && k != "VIDEO" && k != "IMAGE") {
                            val target = counts.getOrPut(k) { CategoryCount(k) }
                            target.count += v.count
                            target.totalBytes += v.totalBytes
                        }
                    }
                } else {
                    // Fallback: check standard public Download & Documents folders
                    val dirs = listOf(
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
                    )
                    for (dir in dirs) {
                        if (dir != null && dir.exists() && dir.canRead()) {
                            try {
                                dir.walkTopDown().maxDepth(3).forEach { file ->
                                    if (file.isFile && !file.name.startsWith(".")) {
                                        val cat = FileCategoryMapper.getCategory(file.name, null)
                                        if (cat != "AUDIO" && cat != "VIDEO" && cat != "IMAGE") {
                                            val target = counts.getOrPut(cat) { CategoryCount(cat) }
                                            target.count++
                                            target.totalBytes += file.length()
                                        }
                                    }
                                }
                            } catch (e: Exception) {
                                Log.w(NAME, "Fallback folder walk warning: ${e.message}")
                            }
                        }
                    }
                }

                val resultMap = Arguments.createMap()
                for ((cat, countObj) in counts) {
                    val catMap = Arguments.createMap().apply {
                        putInt("count", countObj.count)
                        putDouble("totalBytes", countObj.totalBytes.toDouble())
                    }
                    resultMap.putMap(cat.lowercase(), catMap)
                }

                promise.resolve(resultMap)
            } catch (e: Exception) {
                promise.reject("STORAGE_COUNTS_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun queryCategoryFiles(category: String, offset: Int, limit: Int, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val catUpper = category.uppercase()
                val isMedia = catUpper == "AUDIO" || catUpper == "VIDEO" || catUpper == "IMAGE"
                val list = mutableListOf<StorageFileInfo>()

                if (isMedia) {
                    val mediaStrategy = MediaStoreStrategy(reactContext)
                    list.addAll(mediaStrategy.queryCategoryFiles(catUpper, offset, limit))
                } else {
                    val treeUri = getSavedTreeUri()
                    if (treeUri != null) {
                        val safStrategy = SafTreeStrategy(reactContext, treeUri)
                        list.addAll(safStrategy.queryCategoryFiles(catUpper, offset, limit))
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
                        val allFilesStrategy = AllFilesStrategy()
                        list.addAll(allFilesStrategy.queryCategoryFiles(catUpper, offset, limit))
                    } else {
                        // Fallback: search public folders
                        val dirs = listOf(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS)
                        )
                        var skipped = 0
                        for (dir in dirs) {
                            if (dir != null && dir.exists() && dir.canRead() && list.size < limit) {
                                dir.walkTopDown().maxDepth(4).forEach { file ->
                                    if (file.isFile && !file.name.startsWith(".")) {
                                        val fileCat = FileCategoryMapper.getCategory(file.name, null)
                                        if (catUpper == "ALL" || fileCat == catUpper) {
                                            if (skipped < offset) {
                                                skipped++
                                            } else if (list.size < limit) {
                                                list.add(
                                                    StorageFileInfo(
                                                        uri = Uri.fromFile(file).toString(),
                                                        name = file.name,
                                                        size = file.length(),
                                                        lastModified = file.lastModified(),
                                                        mimeType = "application/octet-stream",
                                                        extension = file.extension.lowercase(),
                                                        category = fileCat
                                                    )
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                val arr = Arguments.createArray()
                for (item in list) {
                    val m = Arguments.createMap().apply {
                        putString("uri", item.uri)
                        putString("name", item.name)
                        putDouble("size", item.size.toDouble())
                        putDouble("modified", item.lastModified.toDouble())
                        putString("mime", item.mimeType)
                        putString("ext", item.extension)
                        putString("category", item.category)
                    }
                    arr.pushMap(m)
                }
                promise.resolve(arr)
            } catch (e: Exception) {
                promise.reject("QUERY_CATEGORY_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun getStorageUsage(promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val path = Environment.getDataDirectory()
                val stat = StatFs(path.path)
                val blockSize = stat.blockSizeLong
                val totalBlocks = stat.blockCountLong
                val availableBlocks = stat.availableBlocksLong

                val totalBytes = totalBlocks * blockSize
                val freeBytes = availableBlocks * blockSize
                val usedBytes = totalBytes - freeBytes

                val map = Arguments.createMap().apply {
                    putDouble("usedBytes", usedBytes.toDouble())
                    putDouble("totalBytes", totalBytes.toDouble())
                    putDouble("freeBytes", freeBytes.toDouble())
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("STORAGE_USAGE_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun resolveToLocalFile(uriString: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val uri = Uri.parse(uriString)
                if (uri.scheme == "file") {
                    val file = File(uri.path ?: "")
                    if (file.exists()) {
                        val map = Arguments.createMap().apply {
                            putString("localPath", file.absolutePath)
                            putString("name", file.name)
                            putDouble("size", file.length().toDouble())
                            putString("mimeType", FileCategoryMapper.getCategory(file.name, null))
                        }
                        promise.resolve(map)
                        return@launch
                    }
                }

                // Resolve via ContentResolver (SAF or Content URI)
                val incomingDir = File(reactContext.cacheDir, "incoming")
                if (!incomingDir.exists()) incomingDir.mkdirs()

                var displayName = "file_${System.currentTimeMillis()}"
                var size = 0L

                val cursor = reactContext.contentResolver.query(uri, null, null, null, null)
                cursor?.use { c ->
                    val nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (c.moveToFirst()) {
                        if (nameIdx >= 0) displayName = c.getString(nameIdx) ?: displayName
                    }
                }

                // Sanitize file name
                val cleanName = displayName.replace(Regex("[\\\\/:*?\"<>|]"), "_")
                val destFile = File(incomingDir, cleanName)

                // Stream copy with cap (500MB max)
                reactContext.contentResolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(destFile).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var bytesRead: Int
                        var totalCopied = 0L
                        val maxCap = 500L * 1024L * 1024L

                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            totalCopied += bytesRead
                            if (totalCopied > maxCap) {
                                output.close()
                                destFile.delete()
                                promise.reject("FILE_TOO_LARGE", "File exceeds 500MB limit for incoming shared files.")
                                return@launch
                            }
                            output.write(buffer, 0, bytesRead)
                        }
                    }
                } ?: run {
                    promise.reject("INPUT_STREAM_FAILED", "Could not open stream for URI: $uriString")
                    return@launch
                }

                val map = Arguments.createMap().apply {
                    putString("localPath", destFile.absolutePath)
                    putString("name", cleanName)
                    putDouble("size", destFile.length().toDouble())
                    putString("mimeType", FileCategoryMapper.getCategory(cleanName, null))
                }
                promise.resolve(map)
            } catch (e: Exception) {
                promise.reject("RESOLVE_URI_ERROR", e.message, e)
            }
        }
    }
}

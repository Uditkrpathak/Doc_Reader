package com.ufv_rn_poc.storage

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

data class CategoryCount(
    val category: String,
    var count: Int = 0,
    var totalBytes: Long = 0L
)

data class StorageFileInfo(
    val uri: String,
    val name: String,
    val size: Long,
    val lastModified: Long,
    val mimeType: String,
    val extension: String,
    val category: String
)

interface StorageAccessStrategy {
    suspend fun getCategoryCounts(): Map<String, CategoryCount>
    suspend fun queryCategoryFiles(category: String, offset: Int, limit: Int): List<StorageFileInfo>
}

object FileCategoryMapper {
    val EXT_TO_CATEGORY = mapOf(
        "pdf" to "PDF",
        "docx" to "WORD",
        "doc" to "WORD",
        "txt" to "WORD",
        "rtf" to "WORD",
        "odt" to "WORD",
        "xlsx" to "EXCEL",
        "xls" to "EXCEL",
        "csv" to "EXCEL",
        "tsv" to "EXCEL",
        "pptx" to "PPT",
        "ppt" to "PPT",
        "odp" to "PPT",
        "zip" to "ARCHIVE",
        "rar" to "ARCHIVE",
        "7z" to "ARCHIVE",
        "tar" to "ARCHIVE",
        "gz" to "ARCHIVE",
        "mp3" to "AUDIO",
        "wav" to "AUDIO",
        "aac" to "AUDIO",
        "flac" to "AUDIO",
        "ogg" to "AUDIO",
        "m4a" to "AUDIO",
        "mp4" to "VIDEO",
        "mkv" to "VIDEO",
        "avi" to "VIDEO",
        "mov" to "VIDEO",
        "webm" to "VIDEO",
        "3gp" to "VIDEO",
        "jpg" to "IMAGE",
        "jpeg" to "IMAGE",
        "png" to "IMAGE",
        "webp" to "IMAGE",
        "gif" to "IMAGE",
        "bmp" to "IMAGE",
        "heic" to "IMAGE"
    )

    fun getCategory(name: String, mimeType: String?): String {
        val ext = name.substringAfterLast('.', "").lowercase()
        val catByExt = EXT_TO_CATEGORY[ext]
        if (catByExt != null) return catByExt

        val mime = mimeType?.lowercase() ?: ""
        return when {
            mime.startsWith("audio/") -> "AUDIO"
            mime.startsWith("video/") -> "VIDEO"
            mime.startsWith("image/") -> "IMAGE"
            mime.contains("pdf") -> "PDF"
            mime.contains("word") || mime.contains("officedocument.wordprocessingml") -> "WORD"
            mime.contains("spreadsheet") || mime.contains("excel") || mime.contains("csv") -> "EXCEL"
            mime.contains("presentation") || mime.contains("powerpoint") -> "PPT"
            mime.contains("zip") || mime.contains("rar") || mime.contains("tar") || mime.contains("7z") -> "ARCHIVE"
            else -> "OTHER"
        }
    }
}

/**
 * 1. MediaStoreStrategy: Fast index query for audio, video, images and public MediaStore files.
 */
class MediaStoreStrategy(private val context: Context) : StorageAccessStrategy {
    private val TAG = "MediaStoreStrategy"

    override suspend fun getCategoryCounts(): Map<String, CategoryCount> = withContext(Dispatchers.IO) {
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

        // 1. Audio query
        queryMediaCollection(
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Audio.Media.SIZE),
            null, null, "AUDIO", counts
        )

        // 2. Video query
        queryMediaCollection(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Video.Media.SIZE),
            null, null, "VIDEO", counts
        )

        // 3. Images query
        queryMediaCollection(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            arrayOf(MediaStore.Images.Media.SIZE),
            null, null, "IMAGE", counts
        )

        // 4. Documents & Archives in MediaStore.Files
        try {
            val projection = arrayOf(
                MediaStore.Files.FileColumns.DISPLAY_NAME,
                MediaStore.Files.FileColumns.SIZE,
                MediaStore.Files.FileColumns.MIME_TYPE
            )
            val cursor = context.contentResolver.query(
                MediaStore.Files.getContentUri("external"),
                projection,
                null, null, null
            )
            cursor?.use { c ->
                val nameCol = c.getColumnIndex(MediaStore.Files.FileColumns.DISPLAY_NAME)
                val sizeCol = c.getColumnIndex(MediaStore.Files.FileColumns.SIZE)
                val mimeCol = c.getColumnIndex(MediaStore.Files.FileColumns.MIME_TYPE)

                while (c.moveToNext()) {
                    val name = if (nameCol >= 0) c.getString(nameCol) ?: "" else ""
                    val size = if (sizeCol >= 0) c.getLong(sizeCol) else 0L
                    val mime = if (mimeCol >= 0) c.getString(mimeCol) else null
                    val cat = FileCategoryMapper.getCategory(name, mime)
                    // Skip media as already counted above
                    if (cat != "AUDIO" && cat != "VIDEO" && cat != "IMAGE" && cat != "OTHER") {
                        val entry = counts.getOrPut(cat) { CategoryCount(cat) }
                        entry.count++
                        entry.totalBytes += maxOf(0L, size)
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "MediaStore.Files query failed or restricted: ${e.message}")
        }

        counts
    }

    private fun queryMediaCollection(
        uri: Uri,
        projection: Array<String>,
        selection: String?,
        selectionArgs: Array<String>?,
        category: String,
        counts: MutableMap<String, CategoryCount>
    ) {
        try {
            val cursor = context.contentResolver.query(uri, projection, selection, selectionArgs, null)
            cursor?.use { c ->
                val sizeCol = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
                val count = c.count
                var totalBytes = 0L
                while (c.moveToNext()) {
                    if (sizeCol >= 0) {
                        totalBytes += maxOf(0L, c.getLong(sizeCol))
                    }
                }
                val entry = counts.getOrPut(category) { CategoryCount(category) }
                entry.count += count
                entry.totalBytes += totalBytes
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed query for $category: ${e.message}")
        }
    }

    override suspend fun queryCategoryFiles(category: String, offset: Int, limit: Int): List<StorageFileInfo> = withContext(Dispatchers.IO) {
        val result = mutableListOf<StorageFileInfo>()
        val uri: Uri
        val projection: Array<String>
        val sortOrder = "${MediaStore.MediaColumns.DATE_MODIFIED} DESC LIMIT $limit OFFSET $offset"

        when (category) {
            "AUDIO" -> {
                uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
                projection = arrayOf(
                    MediaStore.Audio.Media._ID,
                    MediaStore.Audio.Media.DISPLAY_NAME,
                    MediaStore.Audio.Media.SIZE,
                    MediaStore.Audio.Media.DATE_MODIFIED,
                    MediaStore.Audio.Media.MIME_TYPE
                )
            }
            "VIDEO" -> {
                uri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                projection = arrayOf(
                    MediaStore.Video.Media._ID,
                    MediaStore.Video.Media.DISPLAY_NAME,
                    MediaStore.Video.Media.SIZE,
                    MediaStore.Video.Media.DATE_MODIFIED,
                    MediaStore.Video.Media.MIME_TYPE
                )
            }
            "IMAGE" -> {
                uri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                projection = arrayOf(
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.SIZE,
                    MediaStore.Images.Media.DATE_MODIFIED,
                    MediaStore.Images.Media.MIME_TYPE
                )
            }
            else -> {
                uri = MediaStore.Files.getContentUri("external")
                projection = arrayOf(
                    MediaStore.Files.FileColumns._ID,
                    MediaStore.Files.FileColumns.DISPLAY_NAME,
                    MediaStore.Files.FileColumns.SIZE,
                    MediaStore.Files.FileColumns.DATE_MODIFIED,
                    MediaStore.Files.FileColumns.MIME_TYPE
                )
            }
        }

        try {
            val cursor = context.contentResolver.query(uri, projection, null, null, sortOrder)
            cursor?.use { c ->
                val idCol = c.getColumnIndex(MediaStore.MediaColumns._ID)
                val nameCol = c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME)
                val sizeCol = c.getColumnIndex(MediaStore.MediaColumns.SIZE)
                val dateCol = c.getColumnIndex(MediaStore.MediaColumns.DATE_MODIFIED)
                val mimeCol = c.getColumnIndex(MediaStore.MediaColumns.MIME_TYPE)

                while (c.moveToNext()) {
                    val id = if (idCol >= 0) c.getLong(idCol) else 0L
                    val name = if (nameCol >= 0) c.getString(nameCol) ?: "" else ""
                    val size = if (sizeCol >= 0) c.getLong(sizeCol) else 0L
                    val date = if (dateCol >= 0) c.getLong(dateCol) * 1000L else System.currentTimeMillis()
                    val mime = if (mimeCol >= 0) c.getString(mimeCol) ?: "application/octet-stream" else "application/octet-stream"
                    val ext = name.substringAfterLast('.', "").lowercase()
                    val cat = FileCategoryMapper.getCategory(name, mime)

                    if (cat == category || category == "ALL") {
                        val fileUri = Uri.withAppendedPath(uri, id.toString()).toString()
                        result.add(
                            StorageFileInfo(
                                uri = fileUri,
                                name = name,
                                size = maxOf(0L, size),
                                lastModified = date,
                                mimeType = mime,
                                extension = ext,
                                category = cat
                            )
                        )
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "queryCategoryFiles failed for $category: ${e.message}")
        }
        result
    }
}

/**
 * 2. SafTreeStrategy: Traverses user-granted Document Tree (Downloads, Documents, etc.) via DocumentsContract.
 */
class SafTreeStrategy(private val context: Context, private val treeUri: Uri) : StorageAccessStrategy {
    private val TAG = "SafTreeStrategy"

    override suspend fun getCategoryCounts(): Map<String, CategoryCount> = withContext(Dispatchers.IO) {
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

        try {
            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, rootDocId)
            scanDocumentTreeRecursive(childrenUri, counts, maxDepth = 4)
        } catch (e: Exception) {
            Log.w(TAG, "SAF tree scan error: ${e.message}")
        }
        counts
    }

    private fun scanDocumentTreeRecursive(
        parentUri: Uri,
        counts: MutableMap<String, CategoryCount>,
        maxDepth: Int
    ) {
        if (maxDepth <= 0) return

        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )

        val cursor = context.contentResolver.query(parentUri, projection, null, null, null)
        cursor?.use { c ->
            val idCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val sizeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
            val mimeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)

            while (c.moveToNext()) {
                val docId = if (idCol >= 0) c.getString(idCol) ?: "" else ""
                val name = if (nameCol >= 0) c.getString(nameCol) ?: "" else ""
                val size = if (sizeCol >= 0) c.getLong(sizeCol) else 0L
                val mime = if (mimeCol >= 0) c.getString(mimeCol) ?: "" else ""

                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    val subFolderUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)
                    scanDocumentTreeRecursive(subFolderUri, counts, maxDepth - 1)
                } else {
                    val cat = FileCategoryMapper.getCategory(name, mime)
                    if (counts.containsKey(cat)) {
                        val entry = counts.getValue(cat)
                        entry.count++
                        entry.totalBytes += maxOf(0L, size)
                    }
                }
            }
        }
    }

    override suspend fun queryCategoryFiles(category: String, offset: Int, limit: Int): List<StorageFileInfo> = withContext(Dispatchers.IO) {
        val list = mutableListOf<StorageFileInfo>()
        try {
            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, rootDocId)
            collectFilesRecursive(childrenUri, category, list, limit + offset)
            if (offset < list.size) {
                list.subList(offset, minOf(offset + limit, list.size))
            } else {
                emptyList()
            }
        } catch (e: Exception) {
            Log.w(TAG, "SAF queryCategoryFiles failed: ${e.message}")
            emptyList()
        }
    }

    private fun collectFilesRecursive(
        parentUri: Uri,
        targetCategory: String,
        results: MutableList<StorageFileInfo>,
        maxTargetCount: Int
    ) {
        if (results.size >= maxTargetCount) return

        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )

        val cursor = context.contentResolver.query(parentUri, projection, null, null, null)
        cursor?.use { c ->
            val idCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
            val nameCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
            val sizeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
            val dateCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            val mimeCol = c.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)

            while (c.moveToNext() && results.size < maxTargetCount) {
                val docId = if (idCol >= 0) c.getString(idCol) ?: "" else ""
                val name = if (nameCol >= 0) c.getString(nameCol) ?: "" else ""
                val size = if (sizeCol >= 0) c.getLong(sizeCol) else 0L
                val date = if (dateCol >= 0) c.getLong(dateCol) else System.currentTimeMillis()
                val mime = if (mimeCol >= 0) c.getString(mimeCol) ?: "" else ""

                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    val subFolderUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)
                    collectFilesRecursive(subFolderUri, targetCategory, results, maxTargetCount)
                } else {
                    val cat = FileCategoryMapper.getCategory(name, mime)
                    if (targetCategory == "ALL" || cat == targetCategory) {
                        val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId).toString()
                        results.add(
                            StorageFileInfo(
                                uri = docUri,
                                name = name,
                                size = maxOf(0L, size),
                                lastModified = date,
                                mimeType = mime,
                                extension = name.substringAfterLast('.', "").lowercase(),
                                category = cat
                            )
                        )
                    }
                }
            }
        }
    }
}

/**
 * 3. AllFilesStrategy: Fast direct filesystem walk if MANAGE_EXTERNAL_STORAGE is granted.
 */
class AllFilesStrategy(private val rootDir: File = Environment.getExternalStorageDirectory()) : StorageAccessStrategy {
    override suspend fun getCategoryCounts(): Map<String, CategoryCount> = withContext(Dispatchers.IO) {
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

        try {
            rootDir.walkTopDown()
                .maxDepth(5)
                .onEnter { dir -> !dir.name.startsWith(".") && dir.name != "Android" }
                .forEach { file ->
                    if (file.isFile && !file.name.startsWith(".")) {
                        val cat = FileCategoryMapper.getCategory(file.name, null)
                        counts[cat]?.let {
                            it.count++
                            it.totalBytes += file.length()
                        }
                    }
                }
        } catch (e: Exception) {
            Log.w("AllFilesStrategy", "File walk failed: ${e.message}")
        }
        counts
    }

    override suspend fun queryCategoryFiles(category: String, offset: Int, limit: Int): List<StorageFileInfo> = withContext(Dispatchers.IO) {
        val list = mutableListOf<StorageFileInfo>()
        try {
            var skipped = 0
            rootDir.walkTopDown()
                .maxDepth(5)
                .onEnter { dir -> !dir.name.startsWith(".") && dir.name != "Android" }
                .forEach { file ->
                    if (file.isFile && !file.name.startsWith(".")) {
                        val cat = FileCategoryMapper.getCategory(file.name, null)
                        if (category == "ALL" || cat == category) {
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
                                        category = cat
                                    )
                                )
                            }
                        }
                    }
                }
        } catch (e: Exception) {
            Log.w("AllFilesStrategy", "queryCategoryFiles failed: ${e.message}")
        }
        list
    }
}


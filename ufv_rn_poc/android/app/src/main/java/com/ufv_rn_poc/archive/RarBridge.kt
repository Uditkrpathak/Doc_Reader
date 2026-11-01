package com.ufv_rn_poc.archive

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class RarBridge(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "RarBridge"

    companion object {
        private const val TAG = "RarBridge"
        private var isLibraryLoaded = false

        init {
            try {
                System.loadLibrary("unrar_jni")
                isLibraryLoaded = true
                Log.i(TAG, "Loaded libunrar_jni.so successfully. Version: " + nativeGetVersion())
            } catch (t: Throwable) {
                Log.w(TAG, "libunrar_jni.so not yet compiled or failed to load: ${t.message}")
                isLibraryLoaded = false
            }
        }

        fun isNativeAvailable(): Boolean = isLibraryLoaded

        @JvmStatic external fun nativeGetVersion(): String
        @JvmStatic external fun nativeInspectArchive(archivePath: String, password: String): String
        @JvmStatic external fun nativeCheckMultipart(archivePath: String): String?
        @JvmStatic external fun nativeExtractRar(
            archivePath: String,
            destDir: String,
            password: String,
            maxRatio: Double,
            maxTotalBytes: Double
        ): String

        @JvmStatic external fun nativeListRar(archivePath: String): Array<String>
        @JvmStatic external fun nativeExtractSingle(archivePath: String, entryName: String, destDir: String): String
    }

    @ReactMethod
    fun listRarContents(path: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (!isNativeAvailable()) {
                    promise.reject("RAR_UNAVAILABLE", "Native unrar engine is not available on this device")
                    return@launch
                }
                val cleanPath = if (path.startsWith("file://")) path.substring(7) else path
                val file = File(cleanPath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "RAR file does not exist: $cleanPath")
                    return@launch
                }
                val list = nativeListRar(cleanPath)
                if (list.size == 1 && list[0].startsWith("ERROR:")) {
                    if (list[0].contains("PASSWORD_REQUIRED")) {
                        promise.reject("PASSWORD_REQUIRED", "Archive is password-protected")
                    } else {
                        promise.reject("RAR_OPEN_ERROR", list[0])
                    }
                    return@launch
                }
                val array = Arguments.createArray()
                for (entry in list) {
                    array.pushString(entry)
                }
                promise.resolve(array)
            } catch (e: Exception) {
                promise.reject("RAR_LIST_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun extractSingleFile(rarPath: String, entryName: String, promise: Promise) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (!isNativeAvailable()) {
                    promise.reject("RAR_UNAVAILABLE", "Native unrar engine is not available on this device")
                    return@launch
                }
                val cleanPath = if (rarPath.startsWith("file://")) rarPath.substring(7) else rarPath
                val file = File(cleanPath)
                if (!file.exists()) {
                    promise.reject("FILE_NOT_FOUND", "RAR file does not exist: $cleanPath")
                    return@launch
                }
                val cacheDir = File(reactContext.cacheDir, "rar_extracted")
                if (!cacheDir.exists()) cacheDir.mkdirs()

                // Create parent directories for entry if needed
                val cleanEntry = entryName.replace('\\', '/')
                val destFile = File(cacheDir, cleanEntry)
                destFile.parentFile?.mkdirs()

                val result = nativeExtractSingle(cleanPath, entryName, cacheDir.absolutePath)
                if (result.startsWith("ERROR:")) {
                    promise.reject("RAR_EXTRACT_ERROR", result)
                } else {
                    promise.resolve(result)
                }
            } catch (e: Exception) {
                promise.reject("RAR_EXTRACT_ERROR", e.message, e)
            }
        }
    }
}

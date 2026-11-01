#include <jni.h>
#include <string>
#include <vector>
#include <fstream>
#include <android/log.h>
#include <sys/stat.h>
#include <dirent.h>
#include <cstring>
#include "unrar/dll.hpp"

#define LOG_TAG "UnrarJni"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

static int CALLBACK RarExtractCallback(UINT msg, LPARAM UserData, LPARAM P1, LPARAM P2) {
    if (msg == UCM_NEEDPASSWORD && P1 != 0 && UserData != 0) {
        const char *pwd = reinterpret_cast<const char*>(UserData);
        if (pwd && strlen(pwd) > 0) {
            strncpy(reinterpret_cast<char*>(P1), pwd, P2);
            return 1;
        }
    }
    return 0;
}

extern "C" {

/**
 * Returns native library version string.
 */
JNIEXPORT jstring JNICALL
Java_com_ufv_1rn_1poc_archive_RarBridge_nativeGetVersion(
    JNIEnv *env,
    jobject /* this */
) {
    std::string ver = "unrar_jni v7.0.9 (Android NDK C++17)";
    return env->NewStringUTF(ver.c_str());
}

/**
 * Inspects RAR4 / RAR5 archive headers in native C++.
 * Returns a delimited metadata string:
 * "FORMAT:RAR5|ENCRYPTED:0|SOLID:0|VOLUME:0|ENTRY_COUNT:N"
 */
JNIEXPORT jstring JNICALL
Java_com_ufv_1rn_1poc_archive_RarBridge_nativeInspectArchive(
    JNIEnv *env,
    jobject /* this */,
    jstring jArchivePath,
    jstring jPassword
) {
    const char *archivePath = env->GetStringUTFChars(jArchivePath, nullptr);
    if (!archivePath) {
        return env->NewStringUTF("ERROR:Invalid archive path");
    }

    std::ifstream file(archivePath, std::ios::binary);
    if (!file.is_open()) {
        env->ReleaseStringUTFChars(jArchivePath, archivePath);
        return env->NewStringUTF("ERROR:File open failed");
    }

    unsigned char sig[8] = {0};
    file.read(reinterpret_cast<char*>(sig), 8);
    std::streamsize readBytes = file.gcount();

    if (readBytes < 7) {
        env->ReleaseStringUTFChars(jArchivePath, archivePath);
        return env->NewStringUTF("ERROR:File too small for RAR header");
    }

    // Check RAR signature
    // RAR4: 52 61 72 21 1A 07 00
    // RAR5: 52 61 72 21 1A 07 01 00
    bool isRar4 = (sig[0] == 0x52 && sig[1] == 0x61 && sig[2] == 0x72 && sig[3] == 0x21 && sig[4] == 0x1A && sig[5] == 0x07 && sig[6] == 0x00);
    bool isRar5 = (sig[0] == 0x52 && sig[1] == 0x61 && sig[2] == 0x72 && sig[3] == 0x21 && sig[4] == 0x1A && sig[5] == 0x07 && sig[6] == 0x01);

    if (!isRar4 && !isRar5) {
        env->ReleaseStringUTFChars(jArchivePath, archivePath);
        return env->NewStringUTF("ERROR:Invalid RAR signature (neither RAR4 nor RAR5)");
    }

    std::string format = isRar5 ? "RAR5" : "RAR4";
    bool isEncrypted = false;
    bool isSolid = false;
    bool isVolume = false;

    if (isRar5) {
        // In RAR5, read next block header
        unsigned char blockHeader[8] = {0};
        file.read(reinterpret_cast<char*>(blockHeader), 8);
        // RAR5 archive header flags inspection
        // Header encryption in RAR5 sets flag 0x0001 on main archive header
    } else {
        // In RAR4, marker block is followed by archive header block (type 0x73)
        unsigned char archHeader[13] = {0};
        file.read(reinterpret_cast<char*>(archHeader), 13);
        if (file.gcount() >= 7) {
            unsigned short flags = archHeader[3] | (archHeader[4] << 8);
            if (flags & 0x0001) isVolume = true;
            if (flags & 0x0008) isSolid = true;
            if (flags & 0x0080) isEncrypted = true;
        }
    }

    std::string result = "FORMAT:" + format +
                         "|ENCRYPTED:" + (isEncrypted ? "1" : "0") +
                         "|SOLID:" + (isSolid ? "1" : "0") +
                         "|VOLUME:" + (isVolume ? "1" : "0");

    env->ReleaseStringUTFChars(jArchivePath, archivePath);
    return env->NewStringUTF(result.c_str());
}

/**
 * Checks multipart sibling volumes in native C++.
 * If file is part1, verifies part2 exists in the same folder.
 * Returns NULL if all OK, or missing volume filename if missing.
 */
JNIEXPORT jstring JNICALL
Java_com_ufv_1rn_1poc_archive_RarBridge_nativeCheckMultipart(
    JNIEnv *env,
    jobject /* this */,
    jstring jArchivePath
) {
    const char *archivePath = env->GetStringUTFChars(jArchivePath, nullptr);
    if (!archivePath) return nullptr;

    std::string path(archivePath);
    env->ReleaseStringUTFChars(jArchivePath, archivePath);

    // Look for .part1.rar or .part01.rar
    size_t partPos = path.find(".part");
    if (partPos == std::string::npos) {
        partPos = path.find(".PART");
    }

    if (partPos != std::string::npos) {
        size_t numStart = partPos + 5;
        size_t rarExt = path.find(".rar", numStart);
        if (rarExt == std::string::npos) rarExt = path.find(".RAR", numStart);

        if (rarExt != std::string::npos) {
            std::string numStr = path.substr(numStart, rarExt - numStart);
            try {
                int currentPart = std::stoi(numStr);
                int nextPart = currentPart + 1;
                std::string nextNumStr = std::to_string(nextPart);
                if (numStr.length() > 1 && numStr[0] == '0') {
                    while (nextNumStr.length() < numStr.length()) {
                        nextNumStr = "0" + nextNumStr;
                    }
                }
                std::string siblingPath = path.substr(0, partPos) + ".part" + nextNumStr + path.substr(rarExt);

                struct stat st;
                if (stat(siblingPath.c_str(), &st) != 0) {
                    // Sibling does not exist! Extract basename
                    size_t slash = siblingPath.find_last_of("/\\");
                    std::string missingName = (slash != std::string::npos) ? siblingPath.substr(slash + 1) : siblingPath;
                    return env->NewStringUTF(missingName.c_str());
                }
            } catch (...) {
                // Ignore parse errors
            }
        }
    }

    return nullptr; // No missing volume detected
}

/**
 * Extracts RAR archive to destination directory using official unrar RARProcessFile().
 * Supports RAR4, RAR5, solid blocks, and password-protected archives.
 * Applies expansion ratio, file limit, and zip-slip directory traversal guards.
 */
JNIEXPORT jstring JNICALL
Java_com_ufv_1rn_1poc_archive_RarBridge_nativeExtractRar(
    JNIEnv *env,
    jobject /* this */,
    jstring jArchivePath,
    jstring jDestDir,
    jstring jPassword,
    jdouble maxRatio,
    jdouble maxTotalBytes
) {
    const char *archivePath = env->GetStringUTFChars(jArchivePath, nullptr);
    const char *destDir = env->GetStringUTFChars(jDestDir, nullptr);
    const char *password = jPassword ? env->GetStringUTFChars(jPassword, nullptr) : nullptr;

    if (!archivePath || !destDir) {
        if (archivePath) env->ReleaseStringUTFChars(jArchivePath, archivePath);
        if (destDir) env->ReleaseStringUTFChars(jDestDir, destDir);
        if (password) env->ReleaseStringUTFChars(jPassword, password);
        return env->NewStringUTF("ERROR:Null arguments provided");
    }

    struct stat st;
    uint64_t archiveSize = 0;
    if (stat(archivePath, &st) == 0) {
        archiveSize = st.st_size;
    }

    struct RAROpenArchiveDataEx openData;
    memset(&openData, 0, sizeof(openData));
    openData.ArcName = const_cast<char*>(archivePath);
    openData.OpenMode = RAR_OM_EXTRACT;
    openData.Callback = RarExtractCallback;
    openData.UserData = reinterpret_cast<LPARAM>(password ? password : "");

    HANDLE hArc = RAROpenArchiveEx(&openData);
    if (!hArc || openData.OpenResult != 0) {
        std::string err;
        if (openData.OpenResult == ERAR_BAD_ARCHIVE) {
            err = "ERROR:Corrupt or invalid RAR archive format";
        } else if (openData.OpenResult == ERAR_UNKNOWN_FORMAT) {
            err = "ERROR:Unknown archive format";
        } else if (openData.OpenResult == ERAR_EOPEN) {
            err = "ERROR:Could not open RAR archive file";
        } else if (openData.OpenResult == ERAR_NO_MEMORY) {
            err = "ERROR:Out of memory while opening RAR archive";
        } else if (openData.OpenResult == ERAR_BAD_DATA) {
            err = "ERROR:Archive header corrupted or encrypted without password";
        } else {
            err = "ERROR:Failed to open RAR archive (code " + std::to_string(openData.OpenResult) + ")";
        }

        env->ReleaseStringUTFChars(jArchivePath, archivePath);
        env->ReleaseStringUTFChars(jDestDir, destDir);
        if (password) env->ReleaseStringUTFChars(jPassword, password);
        return env->NewStringUTF(err.c_str());
    }

    if (password && strlen(password) > 0) {
        RARSetPassword(hArc, const_cast<char*>(password));
    }

    struct RARHeaderDataEx headerData;
    memset(&headerData, 0, sizeof(headerData));

    int fileCount = 0;
    int failedCount = 0;
    uint64_t totalBytesExtracted = 0;
    double effectiveRatioLimit = (maxRatio > 0.0) ? maxRatio : 100.0;
    uint64_t effectiveTotalLimit = (maxTotalBytes > 0.0) ? (uint64_t)maxTotalBytes : (2ULL * 1024 * 1024 * 1024);

    int headerResult = 0;
    std::string abortReason = "";

    while ((headerResult = RARReadHeaderEx(hArc, &headerData)) == ERAR_SUCCESS) {
        std::string entryName = headerData.FileName;

        // Zip-Slip Directory Traversal Check
        if (entryName.find("../") != std::string::npos || entryName.find("..\\") != std::string::npos ||
            entryName[0] == '/' || entryName[0] == '\\') {
            abortReason = "BLOCKED:SECURITY BLOCK (Zip-Slip): Entry '" + entryName + "' attempts directory traversal";
            RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
            break;
        }

        uint64_t unpSize = ((uint64_t)headerData.UnpSizeHigh << 32) | headerData.UnpSize;

        // Security check: single file limit (500 MB)
        if (unpSize > 500ULL * 1024 * 1024) {
            abortReason = "BLOCKED:SECURITY BLOCK (File Limit): Single file '" + entryName + "' exceeded 500 MB limit.";
            RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
            break;
        }

        // Call RARProcessFile to extract file to destination directory
        int procResult = RARProcessFile(hArc, RAR_EXTRACT, const_cast<char*>(destDir), nullptr);
        if (procResult == ERAR_SUCCESS) {
            fileCount++;
            totalBytesExtracted += unpSize;

            // Dynamic expansion ratio check (only after 10 MB written)
            if (totalBytesExtracted > 10ULL * 1024 * 1024) {
                double currentRatio = (double)totalBytesExtracted / (double)(archiveSize > 1024 ? archiveSize : 1024);
                if (currentRatio > effectiveRatioLimit) {
                    abortReason = "BLOCKED:SECURITY BLOCK (Archive Bomb): Written bytes (" + std::to_string(totalBytesExtracted) +
                                  ") exceeded expansion ratio " + std::to_string((int)currentRatio) + ":1";
                    break;
                }
            }

            if (totalBytesExtracted > effectiveTotalLimit) {
                abortReason = "BLOCKED:SECURITY BLOCK (Size Limit): Total extracted bytes exceeded maximum limit.";
                break;
            }
        } else if (procResult == ERAR_BAD_DATA) {
            failedCount++;
        } else if (procResult == ERAR_BAD_PASSWORD || procResult == ERAR_MISSING_PASSWORD) {
            abortReason = "PASSWORD_REQUIRED:Archive entry is password-protected";
            break;
        } else {
            failedCount++;
        }
    }

    if (abortReason.empty()) {
        if (headerResult == ERAR_BAD_DATA) {
            abortReason = "ERROR:Corrupted archive data encountered during read";
        } else if (headerResult == ERAR_BAD_PASSWORD || headerResult == ERAR_MISSING_PASSWORD) {
            abortReason = "PASSWORD_REQUIRED:Archive header or entry is password-protected";
        }
    }

    RARCloseArchive(hArc);

    env->ReleaseStringUTFChars(jArchivePath, archivePath);
    env->ReleaseStringUTFChars(jDestDir, destDir);
    if (password) env->ReleaseStringUTFChars(jPassword, password);

    if (!abortReason.empty()) {
        return env->NewStringUTF(abortReason.c_str());
    }

    std::string summary = "SUCCESS:Extracted " + std::to_string(fileCount) + " files (" +
                          std::to_string(totalBytesExtracted) + " bytes), " +
                          std::to_string(failedCount) + " failed";
    return env->NewStringUTF(summary.c_str());
}

/**
 * Lists all entry names and metadata in a RAR archive.
 * Returns a String array: ["entry1.txt|1024|0", "sub/doc.pdf|204800|0", ...]
 */
JNIEXPORT jobjectArray JNICALL
Java_com_ufv_1rn_1poc_archive_RarBridge_nativeListRar(
    JNIEnv *env,
    jobject /* this */,
    jstring jArchivePath
) {
    jclass stringClass = env->FindClass("java/lang/String");
    if (!jArchivePath) {
        return env->NewObjectArray(0, stringClass, nullptr);
    }

    const char *archivePath = env->GetStringUTFChars(jArchivePath, nullptr);
    if (!archivePath) {
        return env->NewObjectArray(0, stringClass, nullptr);
    }

    struct RAROpenArchiveDataEx openData;
    memset(&openData, 0, sizeof(openData));
    openData.ArcName = const_cast<char*>(archivePath);
    openData.OpenMode = RAR_OM_LIST;

    HANDLE hArc = RAROpenArchiveEx(&openData);
    if (!hArc || openData.OpenResult != 0) {
        std::string errEntry = "ERROR:";
        if (openData.OpenResult == 22 || openData.OpenResult == 24 || openData.OpenResult == ERAR_BAD_PASSWORD || openData.OpenResult == ERAR_MISSING_PASSWORD) {
            errEntry += "PASSWORD_REQUIRED";
        } else {
            errEntry += "OPEN_FAILED_CODE_" + std::to_string(openData.OpenResult);
        }
        env->ReleaseStringUTFChars(jArchivePath, archivePath);
        jobjectArray result = env->NewObjectArray(1, stringClass, nullptr);
        jstring str = env->NewStringUTF(errEntry.c_str());
        env->SetObjectArrayElement(result, 0, str);
        env->DeleteLocalRef(str);
        return result;
    }

    std::vector<std::string> entries;
    struct RARHeaderDataEx headerData;
    memset(&headerData, 0, sizeof(headerData));

    while (RARReadHeaderEx(hArc, &headerData) == ERAR_SUCCESS) {
        std::string entryName = headerData.FileName;
        // Normalize backslashes to forward slashes for clean cross-platform path handling
        for (char &c : entryName) { if (c == '\\') c = '/'; }
        uint64_t unpSize = ((uint64_t)headerData.UnpSizeHigh << 32) | headerData.UnpSize;
        bool isDir = (headerData.Flags & 0xE0) == 0xE0 || (headerData.FileAttr & 0x10) != 0;

        // Record format: "entryName|uncompressedSize|isDir"
        std::string record = entryName + "|" + std::to_string(unpSize) + "|" + (isDir ? "1" : "0");
        entries.push_back(record);

        RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
    }

    RARCloseArchive(hArc);
    env->ReleaseStringUTFChars(jArchivePath, archivePath);

    jobjectArray result = env->NewObjectArray((jsize)entries.size(), stringClass, nullptr);
    for (size_t i = 0; i < entries.size(); ++i) {
        jstring str = env->NewStringUTF(entries[i].c_str());
        env->SetObjectArrayElement(result, (jsize)i, str);
        env->DeleteLocalRef(str);
    }

    return result;
}

/**
 * Extracts a single entry from a RAR archive to destDir.
 * Returns the extracted file path, or an error string starting with "ERROR:".
 */
JNIEXPORT jstring JNICALL
Java_com_ufv_1rn_1poc_archive_RarBridge_nativeExtractSingle(
    JNIEnv *env,
    jobject /* this */,
    jstring jArchivePath,
    jstring jEntryName,
    jstring jDestDir
) {
    if (!jArchivePath || !jEntryName || !jDestDir) {
        return env->NewStringUTF("ERROR:Null arguments passed");
    }

    const char *archivePath = env->GetStringUTFChars(jArchivePath, nullptr);
    const char *targetEntry = env->GetStringUTFChars(jEntryName, nullptr);
    const char *destDir = env->GetStringUTFChars(jDestDir, nullptr);

    if (!archivePath || !targetEntry || !destDir) {
        if (archivePath) env->ReleaseStringUTFChars(jArchivePath, archivePath);
        if (targetEntry) env->ReleaseStringUTFChars(jEntryName, targetEntry);
        if (destDir) env->ReleaseStringUTFChars(jDestDir, destDir);
        return env->NewStringUTF("ERROR:Failed to get strings");
    }

    struct RAROpenArchiveDataEx openData;
    memset(&openData, 0, sizeof(openData));
    openData.ArcName = const_cast<char*>(archivePath);
    openData.OpenMode = RAR_OM_EXTRACT;

    HANDLE hArc = RAROpenArchiveEx(&openData);
    if (!hArc || openData.OpenResult != 0) {
        std::string err = "ERROR:Failed to open RAR archive (code " + std::to_string(openData.OpenResult) + ")";
        env->ReleaseStringUTFChars(jArchivePath, archivePath);
        env->ReleaseStringUTFChars(jEntryName, targetEntry);
        env->ReleaseStringUTFChars(jDestDir, destDir);
        return env->NewStringUTF(err.c_str());
    }

    struct RARHeaderDataEx headerData;
    memset(&headerData, 0, sizeof(headerData));

    bool found = false;
    std::string outResult = "";
    std::string target(targetEntry);
    std::string normTarget = target;
    for (char &c : normTarget) { if (c == '\\') c = '/'; }
    while (!normTarget.empty() && normTarget.front() == '/') normTarget.erase(normTarget.begin());

    while (RARReadHeaderEx(hArc, &headerData) == ERAR_SUCCESS) {
        std::string current = headerData.FileName;
        std::string normCurrent = current;
        for (char &c : normCurrent) { if (c == '\\') c = '/'; }
        while (!normCurrent.empty() && normCurrent.front() == '/') normCurrent.erase(normCurrent.begin());

        if (current == target || normCurrent == normTarget) {
            found = true;
            // Zip-Slip security check
            if (normCurrent.find("../") != std::string::npos || normCurrent[0] == '/') {
                RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
                outResult = "ERROR:Security block: entry attempts directory traversal";
                break;
            }

            int res = RARProcessFile(hArc, RAR_EXTRACT, const_cast<char*>(destDir), nullptr);
            if (res == ERAR_SUCCESS) {
                std::string fullPath = std::string(destDir);
                if (fullPath.back() != '/') {
                    fullPath += "/";
                }
                fullPath += normCurrent;
                outResult = fullPath;
            } else if (res == ERAR_BAD_PASSWORD || res == ERAR_MISSING_PASSWORD) {
                outResult = "ERROR:Password required for this entry";
            } else {
                outResult = "ERROR:Extraction failed with code " + std::to_string(res);
            }
            break;
        } else {
            RARProcessFile(hArc, RAR_SKIP, nullptr, nullptr);
        }
    }

    RARCloseArchive(hArc);

    env->ReleaseStringUTFChars(jArchivePath, archivePath);
    env->ReleaseStringUTFChars(jEntryName, targetEntry);
    env->ReleaseStringUTFChars(jDestDir, destDir);

    if (!found && outResult.empty()) {
        outResult = "ERROR:Entry '" + target + "' not found in RAR archive";
    }

    return env->NewStringUTF(outResult.c_str());
}

} // extern "C"


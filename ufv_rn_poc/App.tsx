import React, {useState, useEffect} from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Modal,
  Linking,
  AppState,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';
import {
  ArchiveEngine,
  ExtractionResult,
  ArchiveEntry,
  FolderFile,
  PickedFile,
} from './src/services/ArchiveEngine';
import { ViewersScreen } from './src/screens/ViewersScreen';
import { RarViewerScreen } from './src/screens/RarViewerScreen';
import { ZipViewerScreen } from './src/screens/ZipViewerScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { FolderBrowserScreen } from './src/screens/FolderBrowserScreen';
import { AudioMiniPlayer } from './src/components/AudioMiniPlayer';
import { MediaViewer } from './src/viewers/MediaViewer';
import { PdfViewer } from './src/viewers/PdfViewer';
import { OfficeViewer } from './src/viewers/OfficeViewer';
import { XlsxViewer } from './src/screens/XlsxViewer';
import { CsvViewer } from './src/screens/CsvViewer';
import { ImageViewer } from './src/viewers/ImageViewer';
import { TextViewer } from './src/viewers/TextViewer';
import { MMKV } from './src/services/MMKV';

interface BenchmarkRecord {
  file: string;
  format: string;
  status: string;
  latencyMs: number;
  extractedCount: number;
  log: string;
}

export default function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'HOME' | 'BROWSE' | 'STARRED' | 'VIEWERS' | 'ARCHIVE'>('HOME');
  const [records, setRecords] = useState<BenchmarkRecord[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [activeFileName, setActiveFileName] = useState<string>('');
  const [progressMsg, setProgressMsg] = useState<string>('Ready');
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [currentFolder] = useState<string>('/sdcard/Download');
  const [isScanningFolder, setIsScanningFolder] = useState<boolean>(false);

  // User Picked File & Password
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [password, setPassword] = useState<string>('');
  const [viewingArchive, setViewingArchive] = useState<{
    path: string;
    name: string;
    isRar: boolean;
  } | null>(null);
  const [activeAudioModal, setActiveAudioModal] = useState<{
    file: string;
    path: string;
  } | null>(null);

  // External Intent / WhatsApp "Open With" (Master PRD Section 2.2)
  const [externalViewer, setExternalViewer] = useState<{
    file: string;
    path: string;
    category: string;
    formatType?: any;
  } | null>(null);

  const engine = ArchiveEngine.getInstance();

  const handleIncomingUrl = async (url: string | null) => {
    if (!url) return;
    try {
      const resolved = await engine.resolveContentUri(url);
      const ext = (resolved.name.split('.').pop() || '').toLowerCase();
      let category = 'PDF';
      let formatType = undefined;

      if (['pdf'].includes(ext)) {
        category = 'PDF';
      } else if (['docx'].includes(ext)) {
        category = 'OFFICE_DOCX';
        formatType = 'DOCX';
      } else if (['doc'].includes(ext)) {
        category = 'LEGACY_OLE_DOC';
        formatType = 'DOC';
      } else if (['pptx'].includes(ext)) {
        category = 'OFFICE_PPTX';
        formatType = 'PPTX';
      } else if (['ppt'].includes(ext)) {
        category = 'LEGACY_OLE_PPT';
        formatType = 'PPT';
      } else if (['xlsx'].includes(ext)) {
        category = 'OFFICE_XLSX';
      } else if (['xls'].includes(ext)) {
        category = 'LEGACY_OLE_XLS';
      } else if (['csv', 'tsv'].includes(ext)) {
        category = 'SPREADSHEET_CSV';
      } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) {
        category = 'IMAGE';
      } else if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
        category = 'VIDEO';
      } else if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'].includes(ext)) {
        category = 'AUDIO';
      } else if (['zip'].includes(ext)) {
        category = 'ARCHIVE_ZIP';
      } else if (['rar'].includes(ext)) {
        category = 'ARCHIVE_RAR';
      } else {
        category = 'TEXT_CODE';
      }

      // Add to MMKV recents
      MMKV.addRecentFile({
        name: resolved.name,
        path: resolved.path,
        size: resolved.size || 0,
        timestamp: Date.now(),
        category,
      });

      setExternalViewer({
        file: resolved.name,
        path: resolved.path,
        category,
        formatType,
      });
    } catch (err) {
      console.warn('Failed to handle incoming file intent:', err);
    }
  };

  useEffect(() => {
    // 1. Initial cold-start URL from Linking
    Linking.getInitialURL().then(handleIncomingUrl);

    // 2. Initial Shared File from Android Intent (ACTION_VIEW / ACTION_SEND)
    engine.getInitialSharedFile().then((shared) => {
      if (shared?.uri) {
        handleIncomingUrl(shared.uri);
      }
    });

    // 3. Incoming URL when app is already running via Linking
    const urlSub = Linking.addEventListener('url', (event) => {
      handleIncomingUrl(event.url);
    });

    // 4. Native event listener for warm-start intents (ACTION_VIEW / ACTION_SEND)
    let sharedSub: any = null;
    if (Platform.OS === 'android' && NativeModules.ArchiveModule) {
      try {
        const eventEmitter = new NativeEventEmitter(NativeModules.ArchiveModule);
        sharedSub = eventEmitter.addListener('onSharedFile', (event: any) => {
          if (event?.uri) {
            handleIncomingUrl(event.uri);
          }
        });
      } catch (err) {
        console.warn('Failed to attach onSharedFile listener', err);
      }
    }

    // 5. Stop background audio on app exit/task removed
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        // App lifecycle background state
      }
    });

    return () => {
      urlSub.remove();
      sharedSub?.remove();
      appStateSub.remove();
    };
  }, []);

  const handlePickFile = async () => {
    try {
      const res = await engine.pickFile();
      setPickedFile(res);
      setProgressMsg(`Selected: ${res.name} (${(res.size / 1024).toFixed(1)} KB)`);
    } catch (err: any) {
      if (err.code !== 'PICK_CANCELLED') {
        console.warn('Pick file error:', err);
      }
    }
  };

  const loadFolderFiles = async (folderPath: string = currentFolder) => {
    setIsScanningFolder(true);
    try {
      let files = await engine.listFolder(folderPath);
      setFolderFiles(files);
    } catch (err) {
      console.warn('Failed to load folder:', err);
    } finally {
      setIsScanningFolder(false);
    }
  };

  useEffect(() => {
    loadFolderFiles('/sdcard/Download');
  }, []);

  const runArchiveTest = async (
    fileName: string,
    filePath: string,
    testPassword?: string
  ) => {
    setIsRunning(true);
    setActiveFileName(fileName);
    setProgressMsg(`Starting ${fileName}...`);
    const start = Date.now();
    const effectivePass = testPassword !== undefined ? testPassword : password;

    try {
      // 1. List
      let format = 'ZIP';
      try {
        const entries: ArchiveEntry[] = await engine.list(filePath, effectivePass);
        if (entries.length > 0 && entries[0].format) {
          format = entries[0].format;
        }
      } catch (listErr: any) {
        format = fileName.toLowerCase().endsWith('.rar') ? 'RAR' : 'ZIP';
      }

      // 2. Extract to isolated cache directory
      const destDir = `/data/data/com.ufv_rn_poc/cache/extract_${Date.now()}`;
      const res: ExtractionResult = await engine.extract(
        filePath,
        destDir,
        effectivePass,
        {maxExpansionRatio: 100.0},
        (prog) => {
          setProgressMsg(
            `Extracting ${fileName}: ${prog.entriesProcessed} entries (${(
              prog.bytesExtracted /
              (1024 * 1024)
            ).toFixed(1)} MB)`
          );
        }
      );

      const elapsed = Date.now() - start;

      const record: BenchmarkRecord = {
        file: fileName,
        format: format || 'ZIP',
        status: res.status,
        latencyMs: elapsed,
        extractedCount: res.extractedFiles ? res.extractedFiles.length : 0,
        log:
          res.error ||
          `Extracted ${res.extractedFiles?.length || 0} entries successfully (${(
            res.totalBytesExtracted /
            (1024 * 1024)
          ).toFixed(2)} MB in ${(elapsed / 1000).toFixed(1)}s).`,
      };

      setRecords((prev) => [record, ...prev]);
    } catch (err: any) {
      const elapsed = Date.now() - start;
      const record: BenchmarkRecord = {
        file: fileName,
        format: 'UNKNOWN',
        status: 'ERROR',
        latencyMs: elapsed,
        extractedCount: 0,
        log: err.message || String(err),
      };
      setRecords((prev) => [record, ...prev]);
    } finally {
      setIsRunning(false);
      setActiveFileName('');
      setProgressMsg('Extraction Finished');
    }
  };

  const cancelActiveExtraction = async () => {
    await engine.cancel();
    setProgressMsg('Extraction cancelled by user');
  };

  const testAllInFolder = async () => {
    for (const f of folderFiles) {
      if (f.isArchive || f.name.endsWith('.zip') || f.name.endsWith('.rar')) {
        await runArchiveTest(f.name, f.path, password);
      }
    }
  };

  const clearResults = () => {
    setRecords([]);
  };

  const navigation = {
    navigate: (screen: string, _params?: any) => {
      const s = (screen || '').toUpperCase();
      if (s.includes('STAR')) {
        setActiveTab('STARRED');
      } else if (s.includes('HOME')) {
        setActiveTab('HOME');
      } else if (s.includes('BROWSE') || s.includes('FOLDER') || s.includes('FILE')) {
        setActiveTab('BROWSE');
      } else if (s.includes('VIEWER') || s.includes('DETECT')) {
        setActiveTab('VIEWERS');
      } else if (s.includes('ARCHIVE')) {
        setActiveTab('ARCHIVE');
      } else {
        setActiveTab('HOME');
      }
    },
    goBack: () => {
      setActiveTab('HOME');
    },
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <View>
            <Text style={styles.title}>Universal File Viewer</Text>
            <Text style={styles.subtitle}>Fast, Offline Document & Media Reader</Text>
          </View>
          <View style={styles.offlinePill}>
            <Text style={styles.offlinePillText}>🔒 100% Offline</Text>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {activeTab === 'HOME' ? (
          <HomeScreen navigation={navigation} />
        ) : activeTab === 'BROWSE' ? (
          <FolderBrowserScreen navigation={navigation} />
        ) : activeTab === 'STARRED' ? (
          <HomeScreen navigation={navigation} initialCategory="STARRED" />
        ) : activeTab === 'VIEWERS' ? (
          <ViewersScreen />
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
        {/* Active Progress Card */}
        {isRunning && (
          <View style={styles.activeCard}>
            <View style={styles.activeHeader}>
              <ActivityIndicator color="#1a73e8" size="small" />
              <Text style={styles.activeTitle}>Extracting: {activeFileName}</Text>
            </View>
            <Text style={styles.activeMsg}>{progressMsg}</Text>
            <TouchableOpacity style={styles.cancelButton} onPress={cancelActiveExtraction}>
              <Text style={styles.cancelButtonText}>🛑 CANCEL EXTRACTION</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 1. Pick Any File From Storage */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📂 Pick Any File From Device</Text>
          <Text style={styles.cardDesc}>
            Select your own ZIP, AES-256 encrypted ZIP, or RAR file from phone storage or Downloads.
          </Text>

          <TouchableOpacity style={styles.pickButton} onPress={handlePickFile}>
            <Text style={styles.pickButtonText}>📂 SELECT FILE FROM STORAGE</Text>
          </TouchableOpacity>

          {pickedFile && (
            <View style={styles.pickedFileBox}>
              <Text style={styles.pickedFileName}>Selected: {pickedFile.name}</Text>
              <Text style={styles.pickedFileSize}>
                {(pickedFile.size / (1024 * 1024)).toFixed(2)} MB ({pickedFile.size} bytes)
              </Text>
            </View>
          )}

          <View style={styles.passwordRow}>
            <Text style={styles.inputLabel}>Password (if file is encrypted):</Text>
            <TextInput
              style={styles.passwordInput}
              placeholder="e.g. 1234"
              placeholderTextColor="#9aa0a6"
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              (!pickedFile || isRunning) && styles.disabledButton,
            ]}
            disabled={!pickedFile || isRunning}
            onPress={() => runArchiveTest(pickedFile!.name, pickedFile!.path, password)}>
            {isRunning && activeFileName === pickedFile?.name ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>⚡ EXTRACT SELECTED FILE</Text>
            )}
          </TouchableOpacity>

          {pickedFile &&
            (pickedFile.name.toLowerCase().endsWith('.rar') ||
              pickedFile.name.toLowerCase().endsWith('.zip')) && (
              <TouchableOpacity
                style={[styles.primaryButton, { backgroundColor: '#0284c7', marginTop: 8 }]}
                onPress={() =>
                  setViewingArchive({
                    path: pickedFile.path,
                    name: pickedFile.name,
                    isRar: pickedFile.name.toLowerCase().endsWith('.rar'),
                  })
                }>
                <Text style={styles.primaryButtonText}>
                  👁️ BROWSE & VIEW ARCHIVE CONTENTS
                </Text>
              </TouchableOpacity>
            )}
        </View>

        {/* 2. Live Drop Folder (/sdcard/Download) */}
        <View style={styles.card}>
          <View style={styles.folderHeader}>
            <View>
              <Text style={styles.cardTitle}>📁 Download Folder (/sdcard/Download)</Text>
              <Text style={styles.folderTip}>
                Drag & drop files from your computer onto this emulator window to test them.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.refreshButton}
              disabled={isScanningFolder}
              onPress={() => loadFolderFiles('/sdcard/Download')}>
              {isScanningFolder ? (
                <ActivityIndicator color="#1a73e8" size="small" />
              ) : (
                <Text style={styles.refreshButtonText}>🔄 Refresh</Text>
              )}
            </TouchableOpacity>
          </View>

          {folderFiles.length > 0 ? (
            <View style={styles.fileList}>
              <TouchableOpacity
                style={[styles.testAllBtn, isRunning && styles.disabledButton]}
                disabled={isRunning}
                onPress={testAllInFolder}>
                <Text style={styles.testAllBtnText}>⚡ EXTRACT ALL FILES IN DOWNLOAD FOLDER</Text>
              </TouchableOpacity>

              {folderFiles.map((f, idx) => (
                <View key={idx} style={styles.fileRow}>
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileNameText}>{f.name}</Text>
                    <Text style={styles.fileSizeText}>
                      {(f.size / (1024 * 1024)).toFixed(2)} MB • {f.extension.toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {(f.extension.toLowerCase() === 'rar' || f.extension.toLowerCase() === 'zip') && (
                      <TouchableOpacity
                        style={[styles.testSingleBtn, { backgroundColor: '#0284c7' }]}
                        onPress={() =>
                          setViewingArchive({
                            path: f.path,
                            name: f.name,
                            isRar: f.extension.toLowerCase() === 'rar',
                          })
                        }>
                        <Text style={styles.testSingleBtnText}>👁️ View</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.testSingleBtn, isRunning && styles.disabledButton]}
                      disabled={isRunning}
                      onPress={() => runArchiveTest(f.name, f.path, password)}>
                      <Text style={styles.testSingleBtnText}>▶ Extract</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyFolderText}>
                No files found in /sdcard/Download.
              </Text>
              <Text style={styles.emptyFolderSubText}>
                Drag & drop any ZIP, RAR, or test files into the emulator, then tap "Refresh".
              </Text>
            </View>
          )}
        </View>

        {/* 3. Real Results Table */}
        <View style={styles.card}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.cardTitle}>Real Extraction Results</Text>
            {records.length > 0 && (
              <TouchableOpacity onPress={clearResults}>
                <Text style={styles.clearText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {records.length === 0 ? (
            <Text style={styles.emptyText}>
              No tests run yet. Pick a file above or click Extract on any file in the Download folder.
            </Text>
          ) : (
            records.map((r, i) => (
              <View key={i} style={styles.recordRow}>
                <View style={styles.recordHeader}>
                  <Text style={styles.fileName}>{r.file}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      r.status === 'SUCCESS'
                        ? styles.passBadge
                        : r.status === 'BLOCKED'
                        ? styles.blockedBadge
                        : styles.errorBadge,
                    ]}>
                    <Text style={styles.statusBadgeText}>{r.status}</Text>
                  </View>
                </View>
                <Text style={styles.recordMeta}>
                  Format: <Text style={styles.bold}>{r.format}</Text> | Latency:{' '}
                  <Text style={styles.bold}>{r.latencyMs}ms</Text> | Entries:{' '}
                  <Text style={styles.bold}>{r.extractedCount}</Text>
                </Text>
                <Text style={styles.recordLog}>{r.log}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
      )}
      </View>

      {/* Audio Mini-Player (Floating Spotify style) */}
      <AudioMiniPlayer
        onExpand={(track) => {
          setActiveAudioModal({
            file: track.fileName,
            path: track.filePath,
          });
        }}
      />

      {/* Modern Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('HOME')}
          activeOpacity={0.7}>
          <View style={[styles.navIconBox, activeTab === 'HOME' && styles.navIconBoxActive]}>
            <Text style={styles.navIcon}>🏠</Text>
          </View>
          <Text style={[styles.navLabel, activeTab === 'HOME' && styles.navLabelActive]}>
            Home
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('BROWSE')}
          activeOpacity={0.7}>
          <View style={[styles.navIconBox, activeTab === 'BROWSE' && styles.navIconBoxActive]}>
            <Text style={styles.navIcon}>📂</Text>
          </View>
          <Text style={[styles.navLabel, activeTab === 'BROWSE' && styles.navLabelActive]}>
            Files
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('STARRED')}
          activeOpacity={0.7}>
          <View style={[styles.navIconBox, activeTab === 'STARRED' && styles.navIconBoxActiveStar]}>
            <Text style={styles.navIcon}>⭐</Text>
          </View>
          <Text style={[styles.navLabel, activeTab === 'STARRED' && styles.navLabelActiveStar]}>
            Starred
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('VIEWERS')}
          activeOpacity={0.7}>
          <View style={[styles.navIconBox, activeTab === 'VIEWERS' && styles.navIconBoxActive]}>
            <Text style={styles.navIcon}>🔍</Text>
          </View>
          <Text style={[styles.navLabel, activeTab === 'VIEWERS' && styles.navLabelActive]}>
            Detect
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('ARCHIVE')}
          activeOpacity={0.7}>
          <View style={[styles.navIconBox, activeTab === 'ARCHIVE' && styles.navIconBoxActive]}>
            <Text style={styles.navIcon}>🗜️</Text>
          </View>
          <Text style={[styles.navLabel, activeTab === 'ARCHIVE' && styles.navLabelActive]}>
            Archive
          </Text>
        </TouchableOpacity>
      </View>

      {/* Archive Viewer Modal */}
      <Modal
        visible={viewingArchive !== null}
        animationType="slide"
        statusBarTranslucent={true}
        onRequestClose={() => setViewingArchive(null)}>
        {viewingArchive && (
          <View
            style={{
              flex: 1,
              backgroundColor: '#1e293b',
              paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
            }}>
            <StatusBar barStyle="light-content" backgroundColor="#1e293b" translucent={true} />
            {viewingArchive.isRar ? (
              <RarViewerScreen
                filePath={viewingArchive.path}
                fileName={viewingArchive.name}
                onClose={() => setViewingArchive(null)}
              />
            ) : (
              <ZipViewerScreen
                filePath={viewingArchive.path}
                fileName={viewingArchive.name}
                onClose={() => setViewingArchive(null)}
              />
            )}
          </View>
        )}
      </Modal>

      {/* Audio Full Player Modal (from Mini-Player expansion) */}
      <Modal
        visible={activeAudioModal !== null}
        animationType="slide"
        statusBarTranslucent={true}
        onRequestClose={() => setActiveAudioModal(null)}>
        {activeAudioModal && (
          <MediaViewer
            filePath={activeAudioModal.path}
            fileName={activeAudioModal.file}
            category="AUDIO"
            onClose={() => setActiveAudioModal(null)}
          />
        )}
      </Modal>

      {/* External File Viewer (WhatsApp / File Manager Open With) */}
      <Modal
        visible={externalViewer !== null}
        animationType="slide"
        statusBarTranslucent={true}
        onRequestClose={() => setExternalViewer(null)}>
        {externalViewer && (
          <View
            style={{
              flex: 1,
              backgroundColor: '#0f172a',
              paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
            }}>
            <StatusBar barStyle="light-content" backgroundColor="#0f172a" translucent={true} />
            {externalViewer.category === 'PDF' && (
              <PdfViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {(externalViewer.category === 'OFFICE_DOCX' ||
              externalViewer.category === 'OFFICE_PPTX' ||
              externalViewer.category === 'LEGACY_OLE_DOC' ||
              externalViewer.category === 'LEGACY_OLE_PPT') && (
              <OfficeViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                formatType={externalViewer.formatType || 'DOCX'}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {(externalViewer.category === 'OFFICE_XLSX' ||
              externalViewer.category === 'LEGACY_OLE_XLS') && (
              <XlsxViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'SPREADSHEET_CSV' && (
              <CsvViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'IMAGE' && (
              <ImageViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {(externalViewer.category === 'AUDIO' || externalViewer.category === 'VIDEO') && (
              <MediaViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                category={externalViewer.category as any}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'ARCHIVE_ZIP' && (
              <ZipViewerScreen
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'ARCHIVE_RAR' && (
              <RarViewerScreen
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'TEXT_CODE' && (
              <TextViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  title: {fontSize: 18, fontWeight: '800', color: '#1a73e8'},
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  offlinePill: {
    backgroundColor: '#e6f4ea',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ceead6',
  },
  offlinePillText: {
    color: '#137333',
    fontSize: 11,
    fontWeight: '700',
  },
  subtitle: {fontSize: 11, color: '#5f6368', marginTop: 2},
  body: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    height: 64,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'space-around',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: -2 },
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  navIconBox: {
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 16,
  },
  navIconBoxActive: {
    backgroundColor: '#e0f2fe',
  },
  navIconBoxActiveStar: {
    backgroundColor: '#fef3c7',
  },
  navIcon: {
    fontSize: 20,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
  },
  navLabelActive: {
    color: '#0284c7',
    fontWeight: '700',
  },
  navLabelActiveStar: {
    color: '#d97706',
    fontWeight: '700',
  },
  badgeRow: {flexDirection: 'row', marginTop: 8, gap: 8},
  badge: {
    backgroundColor: '#e6f4ea',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: {fontSize: 11, fontWeight: '700', color: '#137333'},
  content: {padding: 16},
  activeCard: {
    backgroundColor: '#e8f0fe',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#1a73e8',
  },
  activeHeader: {flexDirection: 'row', alignItems: 'center', gap: 8},
  activeTitle: {fontSize: 15, fontWeight: '700', color: '#1a73e8'},
  activeMsg: {fontSize: 13, color: '#202124', marginTop: 6},
  cancelButton: {
    marginTop: 10,
    backgroundColor: '#d93025',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  cancelButtonText: {color: '#ffffff', fontWeight: '700', fontSize: 12},

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  cardTitle: {fontSize: 15, fontWeight: '700', color: '#202124'},
  cardDesc: {fontSize: 12, color: '#5f6368', marginTop: 4, marginBottom: 12},
  pickButton: {
    backgroundColor: '#e8f0fe',
    borderWidth: 1.5,
    borderColor: '#1a73e8',
    borderStyle: 'dashed',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  pickButtonText: {color: '#1a73e8', fontWeight: '700', fontSize: 13},
  pickedFileBox: {
    backgroundColor: '#f1f3f4',
    padding: 10,
    borderRadius: 6,
    marginTop: 10,
  },
  pickedFileName: {fontSize: 13, fontWeight: '700', color: '#202124'},
  pickedFileSize: {fontSize: 11, color: '#5f6368', marginTop: 2},
  passwordRow: {marginTop: 12},
  inputLabel: {fontSize: 12, fontWeight: '600', color: '#3c4043', marginBottom: 4},
  passwordInput: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#202124',
  },
  primaryButton: {
    backgroundColor: '#1a73e8',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryButtonText: {color: '#ffffff', fontWeight: '700', fontSize: 13},
  disabledButton: {opacity: 0.5},

  folderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  folderTip: {fontSize: 11, color: '#5f6368', marginTop: 3},
  refreshButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1a73e8',
  },
  refreshButtonText: {color: '#1a73e8', fontWeight: '600', fontSize: 12},
  testAllBtn: {
    backgroundColor: '#34a853',
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
    marginVertical: 10,
  },
  testAllBtnText: {color: '#ffffff', fontWeight: '700', fontSize: 12},
  fileList: {marginTop: 6},
  fileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  fileInfo: {flex: 1, marginRight: 8},
  fileNameText: {fontSize: 13, fontWeight: '700', color: '#202124'},
  fileSizeText: {fontSize: 11, color: '#5f6368', marginTop: 2},
  testSingleBtn: {
    backgroundColor: '#1a73e8',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  testSingleBtnText: {color: '#ffffff', fontWeight: '700', fontSize: 12},
  emptyBox: {paddingVertical: 20, alignItems: 'center'},
  emptyFolderText: {fontSize: 13, color: '#5f6368', fontWeight: '600'},
  emptyFolderSubText: {fontSize: 11, color: '#80868b', marginTop: 4, textAlign: 'center'},

  tableHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearText: {fontSize: 12, color: '#d93025', fontWeight: '600'},
  emptyText: {color: '#80868b', fontSize: 12, marginTop: 10, textAlign: 'center'},
  recordRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fileName: {fontSize: 13, fontWeight: '700', color: '#202124'},
  statusBadge: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4},
  passBadge: {backgroundColor: '#e6f4ea'},
  blockedBadge: {backgroundColor: '#fce8e6'},
  errorBadge: {backgroundColor: '#fef7e0'},
  statusBadgeText: {fontSize: 11, fontWeight: '700', color: '#202124'},
  recordMeta: {fontSize: 11, color: '#5f6368', marginTop: 4},
  recordLog: {
    fontSize: 11,
    color: '#3c4043',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    marginTop: 4,
    backgroundColor: '#f8f9fa',
    padding: 6,
    borderRadius: 4,
  },
  bold: {fontWeight: '700', color: '#202124'},
});

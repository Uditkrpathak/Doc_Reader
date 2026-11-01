import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
  StatusBar,
} from 'react-native';
import { ArchiveEngine, FolderFile, PickedFile } from '../services/ArchiveEngine';
import { FileDetector, DetectionResult } from '../services/FileDetector';
import { PdfViewer } from '../viewers/PdfViewer';
import { OfficeViewer } from '../viewers/OfficeViewer';
import { ImageViewer } from '../viewers/ImageViewer';
import { TextViewer } from '../viewers/TextViewer';
import { MediaViewer } from '../viewers/MediaViewer';
import { RarViewerScreen } from './RarViewerScreen';
import { ZipViewerScreen } from './ZipViewerScreen';
import { XlsxViewer } from './XlsxViewer';
import { CsvViewer } from './CsvViewer';

const getViewerHeaderTheme = (category?: string) => {
  switch (category) {
    case 'OFFICE_XLSX':
    case 'LEGACY_OLE_XLS':
      return { bg: '#107c41', barStyle: 'light-content' as const };
    case 'SPREADSHEET_CSV':
      return { bg: '#0284c7', barStyle: 'light-content' as const };
    case 'ARCHIVE_RAR':
    case 'ARCHIVE_ZIP':
    case 'OFFICE_DOCX':
    case 'OFFICE_PPTX':
    case 'LEGACY_OLE_DOC':
    case 'LEGACY_OLE_PPT':
      return { bg: '#1e293b', barStyle: 'light-content' as const };
    case 'IMAGE':
    case 'VIDEO':
    case 'AUDIO':
      return { bg: '#1f1f1f', barStyle: 'light-content' as const };
    case 'PDF':
    case 'TEXT_CODE':
    default:
      return { bg: '#ffffff', barStyle: 'dark-content' as const };
  }
};

export const ViewersScreen: React.FC = () => {
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [detection, setDetection] = useState<DetectionResult | null>(null);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);

  // Active viewer modal
  const [activeViewer, setActiveViewer] = useState<{
    file: string;
    path: string;
    category: string;
    formatType?: any;
  } | null>(null);

  const engine = ArchiveEngine.getInstance();

  const loadFolderFiles = async (folderPath: string = '/sdcard/Download') => {
    setIsScanning(true);
    try {
      const files = await engine.listFolder(folderPath);
      setFolderFiles(files);
    } catch (err) {
      console.warn('loadFolderFiles error', err);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    loadFolderFiles('/sdcard/Download');
  }, []);

  const handlePickFile = async () => {
    try {
      const res = await engine.pickFile();
      setPickedFile(res);
      await analyzeAndOpen(res.name, res.path, false);
    } catch (err) {
      console.warn('Pick file cancelled or failed');
    }
  };

  const analyzeAndOpen = async (fileName: string, filePath: string, autoLaunch: boolean = true) => {
    setIsDetecting(true);
    try {
      const result = await FileDetector.detectFile(filePath, fileName);
      setDetection(result);

      if (autoLaunch) {
        openMatchingViewer(fileName, filePath, result.category);
      }
    } catch (err: any) {
      console.warn('Detection error', err);
    } finally {
      setIsDetecting(false);
    }
  };

  const openMatchingViewer = (fileName: string, filePath: string, category: string) => {
    let formatType = undefined;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    if (ext === 'rar' || category === 'ARCHIVE_RAR') {
      setActiveViewer({ file: fileName, path: filePath, category: 'ARCHIVE_RAR' });
      return;
    }
    if (ext === 'zip' || category === 'ARCHIVE_ZIP') {
      setActiveViewer({ file: fileName, path: filePath, category: 'ARCHIVE_ZIP' });
      return;
    }
    if (ext === 'xlsx' || ext === 'xls' || category === 'OFFICE_XLSX') {
      setActiveViewer({ file: fileName, path: filePath, category: 'OFFICE_XLSX' });
      return;
    }
    if (ext === 'csv' || ext === 'tsv' || category === 'SPREADSHEET_CSV') {
      setActiveViewer({ file: fileName, path: filePath, category: 'SPREADSHEET_CSV' });
      return;
    }
    if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic', 'heif', 'avif'].includes(ext) || category === 'IMAGE') {
      setActiveViewer({ file: fileName, path: filePath, category: 'IMAGE' });
      return;
    }

    if (category === 'OFFICE_DOCX') formatType = 'DOCX';
    else if (category === 'OFFICE_PPTX') formatType = 'PPTX';
    else if (category === 'LEGACY_OLE_DOC') formatType = 'DOC';
    else if (category === 'LEGACY_OLE_PPT') formatType = 'PPT';

    setActiveViewer({
      file: fileName,
      path: filePath,
      category,
      formatType,
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 1. Pick Any Document / File */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>🔍 Universal File Detector & Viewer</Text>
        <Text style={styles.cardDesc}>
          Strictly detects files by raw magic bytes (never by extension). Sniffs inside ZIPs for DOCX/XLSX/PPTX and detects legacy OLE structures.
        </Text>

        <TouchableOpacity style={styles.pickBtn} onPress={handlePickFile}>
          <Text style={styles.pickBtnText}>📂 PICK FILE TO DETECT & RENDER</Text>
        </TouchableOpacity>

        {isDetecting && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#1a73e8" size="small" />
            <Text style={styles.loadingText}>Sniffing magic bytes & parsing container...</Text>
          </View>
        )}

        {detection && !isDetecting && (
          <View style={styles.detectionBox}>
            <View style={styles.detectHeader}>
              <Text style={styles.detectTitle}>Detected: {detection.displayName}</Text>
              <View
                style={[
                  styles.badge,
                  detection.category.startsWith('LEGACY')
                    ? styles.badgeRed
                    : detection.category.startsWith('OFFICE')
                      ? styles.badgeOrange
                      : styles.badgeGreen,
                ]}>
                <Text style={styles.badgeText}>{detection.category}</Text>
              </View>
            </View>

            <Text style={styles.detectMeta}>
              Magic Bytes: <Text style={styles.code}>{detection.magicHex}</Text>
            </Text>
            <Text style={styles.detectMeta}>
              MIME Type: <Text style={styles.bold}>{detection.mimeType}</Text>
            </Text>
            <Text style={styles.detectMeta}>
              File Size: <Text style={styles.bold}>{(detection.sizeBytes / (1024 * 1024)).toFixed(2)} MB</Text> ({detection.sizeBytes} bytes)
            </Text>

            {detection.hasExtensionMismatch && (
              <View style={styles.mismatchAlert}>
                <Text style={styles.mismatchText}>
                  ⚠️ EXTENSION MISMATCH: Declared as .{detection.extension}, but byte signature is {detection.displayName}!
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.launchBtn}
              onPress={() =>
                pickedFile && openMatchingViewer(pickedFile.name, pickedFile.path, detection.category)
              }>
              <Text style={styles.launchBtnText}>🚀 OPEN IN MATCHING VIEWER</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 2. Download / Test Assets Folder */}
      <View style={styles.card}>
        <View style={styles.folderHeader}>
          <View>
            <Text style={styles.cardTitle}>📁 Test Assets (/sdcard/Download)</Text>
            <Text style={styles.folderTip}>Tap "Detect & View" to test each file format</Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            disabled={isScanning}
            onPress={() => loadFolderFiles('/sdcard/Download')}>
            <Text style={styles.refreshBtnText}>🔄 Refresh</Text>
          </TouchableOpacity>
        </View>

        {folderFiles.length === 0 ? (
          <Text style={styles.emptyText}>No files in /sdcard/Download. Tap Refresh or pick a file above.</Text>
        ) : (
          folderFiles.map((f, i) => (
            <View key={i} style={styles.fileRow}>
              <View style={styles.fileInfo}>
                <Text style={styles.fileNameText}>{f.name}</Text>
                <Text style={styles.fileMetaText}>
                  {(f.size / (1024 * 1024)).toFixed(2)} MB • {f.extension.toUpperCase()}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.viewBtn}
                onPress={() => analyzeAndOpen(f.name, f.path, true)}>
                <Text style={styles.viewBtnText}>Detect & View ▶</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {/* Viewer Modal */}
      <Modal
        visible={activeViewer !== null}
        animationType="slide"
        statusBarTranslucent={true}
        onRequestClose={() => setActiveViewer(null)}>
        {activeViewer && (
          <View
            style={[
              styles.modalWrapper,
              { backgroundColor: getViewerHeaderTheme(activeViewer.category).bg },
            ]}>
            <StatusBar
              barStyle={getViewerHeaderTheme(activeViewer.category).barStyle}
              backgroundColor={getViewerHeaderTheme(activeViewer.category).bg}
              translucent={true}
            />
            {activeViewer.category === 'PDF' && (
              <PdfViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {(activeViewer.category === 'OFFICE_DOCX' ||
              activeViewer.category === 'OFFICE_PPTX' ||
              activeViewer.category === 'LEGACY_OLE_DOC' ||
              activeViewer.category === 'LEGACY_OLE_PPT') && (
              <OfficeViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                formatType={activeViewer.formatType || 'DOCX'}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {activeViewer.category === 'ARCHIVE_RAR' && (
              <RarViewerScreen
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {activeViewer.category === 'ARCHIVE_ZIP' && (
              <ZipViewerScreen
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {(activeViewer.category === 'OFFICE_XLSX' ||
              activeViewer.category === 'LEGACY_OLE_XLS') && (
              <XlsxViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {activeViewer.category === 'SPREADSHEET_CSV' && (
              <CsvViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {activeViewer.category === 'IMAGE' && (
              <ImageViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {activeViewer.category === 'TEXT_CODE' && (
              <TextViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {(activeViewer.category === 'VIDEO' || activeViewer.category === 'AUDIO') && (
              <MediaViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                category={activeViewer.category as any}
                onClose={() => setActiveViewer(null)}
              />
            )}

            {(activeViewer.category === 'UNSUPPORTED' ||
              activeViewer.category === 'UNKNOWN' ||
              activeViewer.category === 'ZERO_BYTE') && (
              <View style={styles.unsupportedCardWrapper}>
                <View style={styles.unsupportedHeader}>
                  <Text style={styles.unsupportedTitle} numberOfLines={1}>
                    📄 {activeViewer.file}
                  </Text>
                  <TouchableOpacity
                    style={styles.unsupportedCloseBtn}
                    onPress={() => setActiveViewer(null)}>
                    <Text style={styles.unsupportedCloseText}>✕ Close</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.unsupportedBody}>
                  <Text style={styles.unsupportedBigIcon}>📦</Text>
                  <Text style={styles.unsupportedMainTitle}>Unsupported File Format</Text>
                  <Text style={styles.unsupportedSubtitle}>
                    "{activeViewer.file}" cannot be previewed directly.
                  </Text>
                  <Text style={styles.unsupportedPath} numberOfLines={2}>
                    {activeViewer.path}
                  </Text>
                  <TouchableOpacity
                    style={styles.unsupportedBackBtn}
                    onPress={() => setActiveViewer(null)}>
                    <Text style={styles.unsupportedBackText}>Back to Files</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  content: { padding: 14 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#dadce0',
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#202124' },
  cardDesc: { fontSize: 11, color: '#5f6368', marginTop: 4, lineHeight: 16 },
  pickBtn: {
    backgroundColor: '#1a73e8',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  pickBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  loadingBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  loadingText: { fontSize: 12, color: '#1a73e8' },
  detectionBox: {
    backgroundColor: '#f1f3f4',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#e8eaed',
  },
  detectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detectTitle: { fontSize: 14, fontWeight: '700', color: '#202124' },
  detectMeta: { fontSize: 12, color: '#3c4043', marginTop: 4 },
  code: { fontFamily: 'monospace', color: '#188038' },
  bold: { fontWeight: '700' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeGreen: { backgroundColor: '#e6f4ea' },
  badgeOrange: { backgroundColor: '#fef7e0' },
  badgeRed: { backgroundColor: '#fce8e6' },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#202124' },
  mismatchAlert: {
    backgroundColor: '#fce8e6',
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#d93025',
  },
  mismatchText: { fontSize: 11, color: '#d93025', fontWeight: '700' },
  launchBtn: {
    backgroundColor: '#34a853',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 10,
  },
  launchBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  folderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  folderTip: { fontSize: 11, color: '#5f6368', marginTop: 2 },
  refreshBtn: { backgroundColor: '#e8f0fe', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  refreshBtnText: { color: '#1a73e8', fontWeight: '700', fontSize: 11 },
  fileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  fileInfo: { flex: 1, marginRight: 8 },
  fileNameText: { fontSize: 13, fontWeight: '600', color: '#202124' },
  fileMetaText: { fontSize: 11, color: '#80868b' },
  viewBtn: { backgroundColor: '#1a73e8', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  viewBtnText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  emptyText: { textAlign: 'center', color: '#80868b', fontSize: 12, marginVertical: 12 },
  logRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e8eaed' },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logFileName: { fontSize: 13, fontWeight: '700', color: '#202124' },
  logMeta: { fontSize: 11, color: '#5f6368', marginTop: 2 },
  logNotes: { fontSize: 11, color: '#3c4043', marginTop: 2 },
  modalWrapper: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
  },
  unsupportedCardWrapper: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  unsupportedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  unsupportedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    flex: 1,
    marginRight: 12,
  },
  unsupportedCloseBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  unsupportedCloseText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  unsupportedBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  unsupportedBigIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  unsupportedMainTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 8,
    textAlign: 'center',
  },
  unsupportedSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 12,
  },
  unsupportedPath: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 28,
  },
  unsupportedBackBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  unsupportedBackText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});


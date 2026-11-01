import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
  StatusBar,
} from 'react-native';
import { RNFS, ReadDirItem } from '../services/RNFS';
import { MMKV } from '../services/MMKV';
import { FileDetector } from '../services/FileDetector';
import { FileCard, FileItem } from '../components/FileCard';
import { FileDetailsModal, FileDetailsItem } from '../components/FileDetailsModal';
import { theme } from '../theme/theme';

// Viewers
import { PdfViewer } from '../viewers/PdfViewer';
import { OfficeViewer } from '../viewers/OfficeViewer';
import { ImageViewer } from '../viewers/ImageViewer';
import { MediaViewer } from '../viewers/MediaViewer';
import { TextViewer } from '../viewers/TextViewer';
import { RarViewerScreen } from './RarViewerScreen';
import { ZipViewerScreen } from './ZipViewerScreen';
import { XlsxViewer } from './XlsxViewer';
import { CsvViewer } from './CsvViewer';

interface FolderBrowserScreenProps {
  navigation?: {
    navigate: (screen: string, params?: any) => void;
    goBack?: () => void;
  };
  initialPath?: string;
}

export const FolderBrowserScreen: React.FC<FolderBrowserScreenProps> = ({
  navigation,
  initialPath,
}) => {
  const [currentPath, setCurrentPath] = useState<string>(
    initialPath || RNFS.DownloadDirectoryPath || '/sdcard/Download'
  );
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [items, setItems] = useState<ReadDirItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    return (MMKV.getString('storage_view_mode') as 'list' | 'grid') || 'list';
  });
  const [selectedDetailFile, setSelectedDetailFile] = useState<FileDetailsItem | null>(null);

  const toggleViewMode = () => {
    const next = viewMode === 'list' ? 'grid' : 'list';
    setViewMode(next);
    MMKV.set('storage_view_mode', next);
  };

  // Active viewer modal
  const [activeViewer, setActiveViewer] = useState<{
    file: string;
    path: string;
    category: string;
    formatType?: any;
  } | null>(null);

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  const loadDirectory = async (dirPath: string) => {
    setIsLoading(true);
    try {
      const files = await RNFS.readDir(dirPath);
      setItems(files);
    } catch (err) {
      console.warn('FolderBrowser readDir error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigateDeeper = (folder: ReadDirItem) => {
    setPathHistory((prev) => [...prev, currentPath]);
    setCurrentPath(folder.path);
    setSearchQuery('');
  };

  const handleNavigateUp = () => {
    if (pathHistory.length > 0) {
      const previous = pathHistory[pathHistory.length - 1];
      setPathHistory((prev) => prev.slice(0, -1));
      setCurrentPath(previous);
      setSearchQuery('');
    } else {
      // Navigate to parent directory if possible
      const parent = currentPath.substring(0, currentPath.lastIndexOf('/'));
      if (parent && parent.length >= 7) {
        setCurrentPath(parent);
      } else if (navigation?.goBack) {
        navigation.goBack();
      }
    }
  };

  const handleFileTap = async (fileItem: FileItem) => {
    try {
      const result = await FileDetector.detectFile(fileItem.path, fileItem.name);
      
      // Save to MMKV recents
      MMKV.addRecentFile({
        name: fileItem.name,
        path: fileItem.path,
        size: fileItem.size || 0,
        timestamp: Date.now(),
        category: result.category,
        mimeType: result.mimeType,
      });

      openMatchingViewer(fileItem.name, fileItem.path, result.category);
    } catch {
      // Fallback: detect by extension
      const ext = (fileItem.name.split('.').pop() || '').toLowerCase();
      openMatchingViewer(fileItem.name, fileItem.path, ext);
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

    if (ext === 'docx' || category === 'OFFICE_DOCX') {
      formatType = 'DOCX';
      category = 'OFFICE_DOCX';
    } else if (ext === 'pptx' || category === 'OFFICE_PPTX') {
      formatType = 'PPTX';
      category = 'OFFICE_PPTX';
    } else if (ext === 'doc' || category === 'LEGACY_OLE_DOC') {
      formatType = 'DOC';
      category = 'LEGACY_OLE_DOC';
    } else if (ext === 'ppt' || category === 'LEGACY_OLE_PPT') {
      formatType = 'PPT';
      category = 'LEGACY_OLE_PPT';
    } else if (ext === 'pdf' || category === 'PDF') {
      category = 'PDF';
    }

    setActiveViewer({
      file: fileName,
      path: filePath,
      category,
      formatType,
    });
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (item.isDirectory()) return true;

    const ext = (item.name.split('.').pop() || '').toLowerCase();
    switch (selectedFilter) {
      case 'PDF':
        return ext === 'pdf';
      case 'DOCS':
        return ['docx', 'doc', 'pptx', 'ppt', 'rtf', 'txt'].includes(ext);
      case 'SHEETS':
        return ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
      case 'MEDIA':
        return ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mkv', 'mp3', 'wav', 'heic', 'heif'].includes(ext);
      case 'ARCHIVES':
        return ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext);
      default:
        return true;
    }
  });

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

  return (
    <View style={styles.container}>
      {/* Top Header & Breadcrumbs */}
      <View style={styles.header}>
        <View style={styles.pathBar}>
          <TouchableOpacity
            style={styles.upBtn}
            onPress={handleNavigateUp}
            activeOpacity={0.7}>
            <Text style={styles.upBtnText}>⬆️ Up</Text>
          </TouchableOpacity>
          <View style={styles.pathTextBox}>
            <Text style={styles.pathLabel}>CURRENT FOLDER</Text>
            <Text style={styles.pathText} numberOfLines={1}>
              {currentPath}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => loadDirectory(currentPath)}
            disabled={isLoading}>
            <Text style={styles.refreshBtnText}>🔄</Text>
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Filter files in this folder..."
            placeholderTextColor={theme.colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearch}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Quick Filter Chips & View Mode Toggle */}
        <View style={styles.filterBarContainer}>
          <View style={styles.filterRow}>
            {['ALL', 'PDF', 'DOCS', 'SHEETS', 'MEDIA', 'ARCHIVES'].map((f) => (
              <TouchableOpacity
                key={f}
                style={[
                  styles.filterChip,
                  selectedFilter === f && styles.filterChipActive,
                ]}
                onPress={() => setSelectedFilter(f)}>
                <Text
                  style={[
                    styles.filterChipText,
                    selectedFilter === f && styles.filterChipTextActive,
                  ]}>
                  {f}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={toggleViewMode} style={styles.viewToggleBtn} activeOpacity={0.8}>
            <Text style={styles.viewToggleBtnText}>{viewMode === 'list' ? '⊞ Grid' : '☰ List'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Directory Item List */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Reading storage directory...</Text>
        </View>
      ) : filteredItems.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={styles.emptyIcon}>📁</Text>
          <Text style={styles.emptyTitle}>Folder is Empty</Text>
          <Text style={styles.emptySub}>
            {searchQuery ? 'No files match your search' : 'No items found in this directory'}
          </Text>
          <TouchableOpacity
            style={styles.selectFolderBtn}
            onPress={() => loadDirectory(RNFS.DownloadDirectoryPath || '/sdcard/Download')}>
            <Text style={styles.selectFolderBtnText}>📂 Open Download Folder</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          key={viewMode}
          data={filteredItems}
          numColumns={viewMode === 'grid' ? 2 : 1}
          keyExtractor={(item) => item.path}
          contentContainerStyle={[styles.listContent, viewMode === 'grid' && styles.gridListContent]}
          renderItem={({ item }) => (
            <View style={viewMode === 'grid' ? styles.gridColWrapper : undefined}>
              <FileCard
                file={{
                  name: item.name,
                  path: item.path,
                  size: item.size,
                  isDirectory: item.isDirectory(),
                }}
                viewMode={viewMode}
                isStarred={MMKV.isStarred(item.path)}
                onToggleStar={(f) => {
                  MMKV.toggleStarred({
                    name: f.name,
                    path: f.path,
                    size: f.size || 0,
                    timestamp: Date.now(),
                    category: f.category || 'UNKNOWN',
                  });
                  setItems([...items]);
                }}
                onPress={(f) => {
                  if (f.isDirectory) {
                    handleNavigateDeeper(item);
                  } else {
                    handleFileTap(f);
                  }
                }}
                onLongPress={(f) => {
                  if (!f.isDirectory) {
                    setSelectedDetailFile({
                      name: f.name,
                      path: f.path,
                      size: f.size,
                      lastModified: item.mtime,
                      category: f.category,
                      isStarred: MMKV.isStarred(f.path),
                    });
                  }
                }}
              />
            </View>
          )}
        />
      )}

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

      {/* File Details Sheet Modal */}
      <FileDetailsModal
        visible={selectedDetailFile !== null}
        file={selectedDetailFile}
        onClose={() => setSelectedDetailFile(null)}
        onOpen={(f) => handleFileTap(f)}
        onToggleStar={(f) => {
          MMKV.toggleStarred({
            name: f.name,
            path: f.path,
            size: f.size || 0,
            timestamp: Date.now(),
            category: f.category || 'UNKNOWN',
          });
          setItems([...items]);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.cardBorder,
  },
  pathBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
    gap: 8,
  },
  upBtn: {
    backgroundColor: theme.colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.md,
  },
  upBtnText: {
    ...theme.typography.titleSmall,
    color: theme.colors.primary,
  },
  pathTextBox: {
    flex: 1,
  },
  pathLabel: {
    ...theme.typography.caption,
    color: theme.colors.textMuted,
    textTransform: 'uppercase',
  },
  pathText: {
    ...theme.typography.bodyLarge,
    color: theme.colors.textPrimary,
    fontWeight: '700',
  },
  refreshBtn: {
    padding: 8,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.divider,
  },
  refreshBtnText: {
    fontSize: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    height: 40,
    marginBottom: theme.spacing.sm,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    ...theme.typography.bodyLarge,
    color: theme.colors.textPrimary,
    paddingVertical: 0,
  },
  clearSearch: {
    fontSize: 16,
    color: theme.colors.textMuted,
    paddingHorizontal: 6,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.divider,
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
  },
  filterChipText: {
    ...theme.typography.caption,
    color: theme.colors.textSecondary,
  },
  filterChipTextActive: {
    color: theme.colors.textInverse,
  },
  listContent: {
    padding: theme.spacing.lg,
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  loadingText: {
    ...theme.typography.bodyLarge,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.md,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: theme.spacing.md,
  },
  emptyTitle: {
    ...theme.typography.titleMedium,
    color: theme.colors.textPrimary,
  },
  emptySub: {
    ...theme.typography.bodyMedium,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
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
  filterBarContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  viewToggleBtn: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    marginLeft: 6,
  },
  viewToggleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  selectFolderBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  selectFolderBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  gridListContent: {
    paddingHorizontal: 8,
  },
  gridColWrapper: {
    width: '50%',
    padding: 2,
  },
});


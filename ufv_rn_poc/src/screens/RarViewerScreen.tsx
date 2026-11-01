import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  TextInput,
  Platform,
} from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { PasswordModal } from '../components/PasswordModal';

// Sub-viewers
import { PdfViewer } from '../viewers/PdfViewer';
import { ImageViewer } from '../viewers/ImageViewer';
import { MediaViewer } from '../viewers/MediaViewer';
import { OfficeViewer } from '../viewers/OfficeViewer';
import { TextViewer } from '../viewers/TextViewer';
import { XlsxViewer } from './XlsxViewer';
import { CsvViewer } from './CsvViewer';

interface RarViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

interface ArchiveItem {
  fullPath: string;
  name: string;
  size: number;
  isDirectory: boolean;
}

export const RarViewerScreen: React.FC<RarViewerProps> = ({
  filePath,
  fileName,
  onClose,
}) => {
  const [allItems, setAllItems] = useState<ArchiveItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>(''); // e.g. "" for root, "folder/"
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [extractingName, setExtractingName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Password Modal
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState<boolean>(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savedPassword, setSavedPassword] = useState<string | null>(null);
  const [pendingFileItem, setPendingFileItem] = useState<ArchiveItem | null>(null);

  // Active sub-viewer modal
  const [activeViewer, setActiveViewer] = useState<{
    type: 'PDF' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OFFICE' | 'XLSX' | 'CSV' | 'TEXT';
    path: string;
    name: string;
    formatType?: any;
  } | null>(null);

  const extractedFilesRef = useRef<string[]>([]);
  const engine = ArchiveEngine.getInstance();

  useEffect(() => {
    loadContents();
    return () => {
      // Clean up extracted files on unmount
      for (const extractedPath of extractedFilesRef.current) {
        engine.deleteCachedFile(extractedPath).catch(() => {});
      }
    };
  }, [filePath]);

  const loadContents = async (_pwd?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setPasswordError(null);

    try {
      const list = await engine.listRarContents(filePath);
      const items: ArchiveItem[] = list.map((e) => {
        // Normalize backslashes to forward slashes and strip leading slash
        const cleanPath = e.name.replace(/\\/g, '/').replace(/^\/+/, '');
        const isDir = e.isDirectory || cleanPath.endsWith('/');
        const stripped = cleanPath.replace(/\/+$/, '');
        const leafName = stripped.split('/').pop() || stripped;

        return {
          fullPath: isDir ? `${stripped}/` : stripped,
          name: leafName,
          size: e.size,
          isDirectory: isDir,
        };
      });

      setAllItems(items);
      setIsPasswordModalVisible(false);
    } catch (err: any) {
      const msg = err.message || String(err);
      if (
        msg.includes('22') ||
        msg.includes('24') ||
        msg.toLowerCase().includes('password')
      ) {
        setIsPasswordModalVisible(true);
        if (_pwd) {
          setPasswordError('Incorrect password. Please try again.');
        }
      } else {
        setErrorMsg(`Failed to list RAR contents: ${msg}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Build folder hierarchy for currentPath
  const visibleItems = useMemo(() => {
    const folders = new Map<string, ArchiveItem>();
    const files: ArchiveItem[] = [];

    // e.g. "" or "subfolder/"
    const normCurrent = currentPath
      ? (currentPath.endsWith('/') ? currentPath : `${currentPath}/`)
      : '';

    for (const item of allItems) {
      const p = item.fullPath.replace(/^\/+/, '');
      if (!p.startsWith(normCurrent)) continue;

      const rel = p.substring(normCurrent.length).replace(/^\/+/, '');
      if (!rel) continue;

      const slashIdx = rel.indexOf('/');
      if (slashIdx !== -1) {
        // It's inside a subfolder
        const folderName = rel.substring(0, slashIdx);
        if (folderName && !folders.has(folderName)) {
          folders.set(folderName, {
            fullPath: `${normCurrent}${folderName}/`,
            name: folderName,
            size: 0,
            isDirectory: true,
          });
        }
      } else {
        // It's directly in the current directory
        if (item.isDirectory) {
          const folderName = rel.replace(/\/+$/, '');
          if (folderName && !folders.has(folderName)) {
            folders.set(folderName, {
              fullPath: `${normCurrent}${folderName}/`,
              name: folderName,
              size: 0,
              isDirectory: true,
            });
          }
        } else {
          files.push({
            fullPath: item.fullPath,
            name: rel,
            size: item.size,
            isDirectory: false,
          });
        }
      }
    }

    const folderList = Array.from(folders.values()).sort((a, b) => a.name.localeCompare(b.name));
    const fileList = files.sort((a, b) => a.name.localeCompare(b.name));
    const combined = [...folderList, ...fileList];

    if (!searchQuery.trim()) return combined;
    return combined.filter((i) => i.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [allItems, currentPath, searchQuery]);

  const handleNavigateFolder = (folder: ArchiveItem) => {
    setCurrentPath(folder.fullPath);
    setSearchQuery('');
  };

  const handleNavigateUp = () => {
    if (!currentPath) return;
    const trimmed = currentPath.endsWith('/') ? currentPath.slice(0, -1) : currentPath;
    const lastSlash = trimmed.lastIndexOf('/');
    if (lastSlash === -1) {
      setCurrentPath('');
    } else {
      setCurrentPath(trimmed.substring(0, lastSlash + 1));
    }
    setSearchQuery('');
  };

  const openViewerForFile = (item: ArchiveItem, extractedPath: string) => {
    const ext = item.name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') {
      setActiveViewer({ type: 'PDF', path: extractedPath, name: item.name });
    } else if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic', 'heif'].includes(ext)) {
      setActiveViewer({ type: 'IMAGE', path: extractedPath, name: item.name });
    } else if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext)) {
      setActiveViewer({ type: 'VIDEO', path: extractedPath, name: item.name });
    } else if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'].includes(ext)) {
      setActiveViewer({ type: 'AUDIO', path: extractedPath, name: item.name });
    } else if (['xlsx', 'xls'].includes(ext)) {
      setActiveViewer({ type: 'XLSX', path: extractedPath, name: item.name });
    } else if (['csv', 'tsv'].includes(ext)) {
      setActiveViewer({ type: 'CSV', path: extractedPath, name: item.name });
    } else if (ext === 'docx') {
      setActiveViewer({ type: 'OFFICE', path: extractedPath, name: item.name, formatType: 'DOCX' });
    } else if (ext === 'pptx') {
      setActiveViewer({ type: 'OFFICE', path: extractedPath, name: item.name, formatType: 'PPTX' });
    } else {
      setActiveViewer({ type: 'TEXT', path: extractedPath, name: item.name });
    }
  };

  const handleFilePress = async (item: ArchiveItem) => {
    if (item.isDirectory) {
      handleNavigateFolder(item);
      return;
    }
    if (item.fullPath.startsWith('__NOTICE') || item.name.startsWith('...')) {
      return;
    }

    setExtractingName(item.fullPath);
    setErrorMsg(null);
    try {
      if (savedPassword) {
        // Cached password ready
      }
      const extractedPath = await engine.extractSingleRar(filePath, item.fullPath);
      extractedFilesRef.current.push(extractedPath);
      openViewerForFile(item, extractedPath);
    } catch (err: any) {
      const msg = err.message || String(err);
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('encrypt') ||
        msg.includes('22') ||
        msg.includes('24')
      ) {
        setPendingFileItem(item);
        setIsPasswordModalVisible(true);
      } else {
        setErrorMsg(`Failed to extract "${item.name}": ${msg}`);
      }
    } finally {
      setExtractingName(null);
    }
  };

  const getFileIcon = (name: string, isDir: boolean): string => {
    if (isDir) return '📁';
    const ext = name.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'pdf': return '📕';
      case 'jpg': case 'jpeg': case 'png': case 'webp': case 'bmp': case 'gif': return '🖼️';
      case 'mp4': case 'mkv': case 'webm': case 'avi': return '🎬';
      case 'mp3': case 'wav': case 'flac': case 'm4a': return '🎵';
      case 'docx': case 'doc': return '📘';
      case 'xlsx': case 'xls': return '📗';
      case 'csv': case 'tsv': return '📊';
      case 'pptx': case 'ppt': return '📙';
      case 'zip': case 'rar': case '7z': return '🗜️';
      default: return '📄';
    }
  };

  const formatSize = (bytes: number): string => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleShare = async () => {
    try {
      await engine.shareFile(filePath, 'application/vnd.rar');
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1e293b" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title} numberOfLines={1}>
            🗜️ {fileName}
          </Text>
          <Text style={styles.subtitle}>
            {allItems.length} files • RAR Archive Browser
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
            <Text style={styles.shareBtnText}>📤 Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Breadcrumbs & Navigation Bar */}
      <View style={styles.navBar}>
        {currentPath ? (
          <TouchableOpacity style={styles.upBtn} onPress={handleNavigateUp}>
            <Text style={styles.upBtnText}>⬆️ Up</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.breadcrumbText} numberOfLines={1}>
          📁 /{currentPath}
        </Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Filter files in this folder..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.clearSearch}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>Reading RAR Archive...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.centerBox}>
          <View style={styles.errorCard}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Archive Error</Text>
            <Text style={styles.errorDesc}>{errorMsg}</Text>
          </View>
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={styles.emptyIcon}>📂</Text>
          <Text style={styles.emptyTitle}>Folder is Empty</Text>
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.fullPath}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isExtractingThis = extractingName === item.fullPath;
            return (
              <TouchableOpacity
                style={styles.fileCard}
                onPress={() => handleFilePress(item)}
                disabled={extractingName !== null}
                activeOpacity={0.7}>
                <View style={styles.iconBox}>
                  <Text style={styles.fileIcon}>
                    {getFileIcon(item.name, item.isDirectory)}
                  </Text>
                </View>

                <View style={styles.fileInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {item.isDirectory ? 'Folder • Tap to open' : formatSize(item.size)}
                  </Text>
                </View>

                <View style={styles.rightAction}>
                  {isExtractingThis ? (
                    <ActivityIndicator color="#0284c7" size="small" />
                  ) : item.isDirectory ? (
                    <Text style={styles.chevron}>›</Text>
                  ) : (
                    <Text style={styles.viewBadge}>Open</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Sub-Viewer Fullscreen Overlay */}
      {activeViewer && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#ffffff', zIndex: 100 }]}>
          {activeViewer.type === 'PDF' && (
            <PdfViewer
              filePath={activeViewer.path}
              fileName={activeViewer.name}
              onClose={() => setActiveViewer(null)}
            />
          )}
          {activeViewer.type === 'IMAGE' && (
            <ImageViewer
              filePath={activeViewer.path}
              fileName={activeViewer.name}
              onClose={() => setActiveViewer(null)}
            />
          )}
          {(activeViewer.type === 'VIDEO' || activeViewer.type === 'AUDIO') && (
            <MediaViewer
              filePath={activeViewer.path}
              fileName={activeViewer.name}
              category={activeViewer.type}
              onClose={() => setActiveViewer(null)}
            />
          )}
          {activeViewer.type === 'OFFICE' && (
            <OfficeViewer
              filePath={activeViewer.path}
              fileName={activeViewer.name}
              formatType={activeViewer.formatType}
              onClose={() => setActiveViewer(null)}
            />
          )}
          {activeViewer.type === 'XLSX' && (
            <XlsxViewer
              filePath={activeViewer.path}
              fileName={activeViewer.name}
              onClose={() => setActiveViewer(null)}
            />
          )}
          {activeViewer.type === 'CSV' && (
            <CsvViewer
              filePath={activeViewer.path}
              fileName={activeViewer.name}
              onClose={() => setActiveViewer(null)}
            />
          )}
          {activeViewer.type === 'TEXT' && (
            <TextViewer
              filePath={activeViewer.path}
              fileName={activeViewer.name}
              onClose={() => setActiveViewer(null)}
            />
          )}
        </View>
      )}

      {/* Password Modal */}
      <PasswordModal
        visible={isPasswordModalVisible}
        fileName={pendingFileItem ? pendingFileItem.name : fileName}
        errorMsg={passwordError}
        isLoading={isLoading || !!extractingName}
        onUnlock={async (pwd) => {
          setPasswordError(null);
          setSavedPassword(pwd);
          if (pendingFileItem) {
            const item = pendingFileItem;
            setExtractingName(item.fullPath);
            try {
              const extractedPath = await engine.extractSingleRar(filePath, item.fullPath);
              extractedFilesRef.current.push(extractedPath);
              setIsPasswordModalVisible(false);
              setPendingFileItem(null);
              openViewerForFile(item, extractedPath);
            } catch (err: any) {
              const msg = err.message || String(err);
              setPasswordError(
                msg.toLowerCase().includes('password') || msg.toLowerCase().includes('encrypt')
                  ? 'Incorrect password. Please try again.'
                  : `Extraction failed: ${msg}`
              );
            } finally {
              setExtractingName(null);
            }
          } else {
            await loadContents(pwd);
          }
        }}
        onCancel={() => {
          setIsPasswordModalVisible(false);
          setPendingFileItem(null);
          if (allItems.length === 0) {
            onClose();
          }
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerLeft: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  shareBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  shareBtnText: {
    color: '#38bdf8',
    fontWeight: '700',
    fontSize: 12,
  },
  closeBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  closeBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  upBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
  },
  upBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  breadcrumbText: {
    flex: 1,
    fontSize: 12,
    color: '#38bdf8',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    paddingVertical: 0,
  },
  clearSearch: {
    fontSize: 14,
    color: '#64748b',
    paddingHorizontal: 4,
  },
  listContent: {
    padding: 12,
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  fileIcon: {
    fontSize: 20,
  },
  fileInfo: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  fileMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  rightAction: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewBadge: {
    fontSize: 11,
    color: '#0284c7',
    fontWeight: '700',
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  chevron: {
    fontSize: 18,
    color: '#94a3b8',
    fontWeight: '700',
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#475569',
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    maxWidth: 320,
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#b91c1c',
    marginBottom: 6,
  },
  errorDesc: {
    fontSize: 12,
    color: '#7f1d1d',
    textAlign: 'center',
    lineHeight: 18,
  },
});

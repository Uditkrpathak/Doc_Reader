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
} from 'react-native';
import { ArchiveEngine, ArchiveEntry } from '../services/ArchiveEngine';
import { PasswordModal } from '../components/PasswordModal';
import { RNFS } from '../services/RNFS';
import { FigmaTheme } from '../theme/FigmaTheme';

// Figma Extraction Modals (Figma Image 3 & 4 & 5)
import {
  ExtractionOptionsModal,
  ExtractionProgressModal,
  ExtractionResultModal,
  ArchiveRecoveryModal,
} from '../components/ExtractionModals';

// Sub-viewers
import { PdfViewer } from '../viewers/PdfViewer';
import { ImageViewer } from '../viewers/ImageViewer';
import { MediaViewer } from '../viewers/MediaViewer';
import { OfficeViewer } from '../viewers/OfficeViewer';
import { TextViewer } from '../viewers/TextViewer';
import { XlsxViewer } from './XlsxViewer';
import { CsvViewer } from './CsvViewer';

interface ZipViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

interface ArchiveItem {
  fullPath: string;
  name: string;
  size: number;
  isDirectory: boolean;
  isEncrypted?: boolean;
}

export const ZipViewerScreen: React.FC<ZipViewerProps> = ({
  filePath,
  fileName,
  onClose,
}) => {
  const [allItems, setAllItems] = useState<ArchiveItem[]>([]);
  const [currentPath, setCurrentPath] = useState<string>(''); // e.g. "" for root, "assets/"
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [extractingName, setExtractingName] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Multi-selection for extraction (Figma Image 3)
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Password Modal
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState<boolean>(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savedPassword, setSavedPassword] = useState<string | null>(null);
  const [pendingFileItem, setPendingFileItem] = useState<ArchiveItem | null>(null);

  // Extraction Modals State (Figma Image 4)
  const [isExtractionOptionsVisible, setIsExtractionOptionsVisible] = useState<boolean>(false);
  const [isExtractionProgressVisible, setIsExtractionProgressVisible] = useState<boolean>(false);
  const [extractionProgress, setExtractionProgress] = useState<{ current: number; total: number; file: string; percent: number }>({
    current: 0,
    total: 0,
    file: '',
    percent: 0,
  });
  const [isExtractionResultVisible, setIsExtractionResultVisible] = useState<boolean>(false);
  const [extractionResult, setExtractionResult] = useState<{
    successCount: number;
    totalCount: number;
    dest: string;
    failed: Array<{ name: string; reason: string }>;
  }>({ successCount: 0, totalCount: 0, dest: '', failed: [] });

  // Recovery Modal State (Figma Image 5)
  const [recoveryState, setRecoveryState] = useState<{
    visible: boolean;
    type: 'DAMAGED' | 'MISSING_PART' | 'UNSUPPORTED_METHOD' | 'TOO_LARGE' | 'INSUFFICIENT_STORAGE';
  }>({ visible: false, type: 'DAMAGED' });

  // Active sub-viewer modal
  const [activeViewer, setActiveViewer] = useState<{
    type: 'PDF' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'OFFICE' | 'XLSX' | 'CSV' | 'TEXT';
    path: string;
    name: string;
    formatType?: any;
  } | null>(null);

  const extractedFilesRef = useRef<string[]>([]);
  const engine = ArchiveEngine.getInstance();
  const defaultDownloadDest = RNFS.DownloadDirectoryPath || '/storage/emulated/0/Download';

  useEffect(() => {
    loadContents();
    return () => {
      for (const extractedPath of extractedFilesRef.current) {
        engine.deleteCachedFile(extractedPath).catch(() => {});
      }
    };
  }, [filePath]);

  const loadContents = async (password?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setPasswordError(null);

    try {
      const list: ArchiveEntry[] = await engine.list(filePath, password);
      const validEntries = list.filter((e) => {
        const p = e.path || e.name || '';
        return !p.startsWith('__NOTICE') && !p.startsWith('... and') && !(e as any).isNotice;
      });

      const items: ArchiveItem[] = validEntries.map((e) => ({
        fullPath: (e.path || e.name).replace(/\\/g, '/'),
        name: (e.path || e.name).replace(/\\/g, '/'),
        size: e.uncompressedSize || 0,
        isDirectory: e.isDirectory,
        isEncrypted: (e as any).isEncrypted || false,
      }));
      setAllItems(items);
      if (password) setSavedPassword(password);
      setIsPasswordModalVisible(false);
    } catch (err: any) {
      const msg = err.message || String(err);
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('encrypted') ||
        msg.toLowerCase().includes('aes')
      ) {
        setIsPasswordModalVisible(true);
        if (password) {
          setPasswordError('Incorrect password. Please try again.');
        }
      } else if (msg.toLowerCase().includes('corrupt') || msg.toLowerCase().includes('damage')) {
        setRecoveryState({ visible: true, type: 'DAMAGED' });
      } else {
        setErrorMsg(`Failed to list ZIP contents: ${msg}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const totalBytes = useMemo(() => {
    return allItems.reduce((acc, cur) => acc + (cur.size || 0), 0);
  }, [allItems]);

  const lockedCount = useMemo(() => {
    return allItems.filter((i) => i.isEncrypted).length;
  }, [allItems]);

  // Folder hierarchy for currentPath
  const visibleItems = useMemo(() => {
    const folders = new Map<string, ArchiveItem>();
    const files: ArchiveItem[] = [];
    const normCurrent = currentPath ? (currentPath.endsWith('/') ? currentPath : currentPath + '/') : '';

    for (const item of allItems) {
      const p = item.fullPath;
      if (!p.startsWith(normCurrent)) continue;

      const rel = p.substring(normCurrent.length);
      if (!rel || rel === '/') continue;

      const slashIdx = rel.indexOf('/');
      if (slashIdx !== -1) {
        const folderName = rel.substring(0, slashIdx);
        if (!folders.has(folderName)) {
          folders.set(folderName, {
            fullPath: normCurrent + folderName + '/',
            name: folderName,
            size: 0,
            isDirectory: true,
          });
        }
      } else {
        if (item.isDirectory) {
          if (!folders.has(rel)) {
            folders.set(rel, {
              fullPath: normCurrent + rel + '/',
              name: rel,
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
            isEncrypted: item.isEncrypted,
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

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileBadge = (name: string, isDirectory: boolean) => {
    if (isDirectory) return { label: 'DIR', bg: '#EFF6FF', text: FigmaTheme.colors.primary };
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return FigmaTheme.badges.pdf;
    if (['xlsx', 'xls', 'csv'].includes(ext)) return FigmaTheme.badges.excel;
    if (['docx', 'doc'].includes(ext)) return FigmaTheme.badges.word;
    if (['pptx', 'ppt'].includes(ext)) return FigmaTheme.badges.pptx;
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return FigmaTheme.badges.image;
    if (['mp4', 'mkv', 'avi'].includes(ext)) return FigmaTheme.badges.video;
    if (['mp3', 'wav', 'm4a'].includes(ext)) return FigmaTheme.badges.audio;
    return FigmaTheme.badges.unknown;
  };

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
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) {
      setActiveViewer({ type: 'IMAGE', path: extractedPath, name: item.name });
    } else if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
      setActiveViewer({ type: 'VIDEO', path: extractedPath, name: item.name });
    } else if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'].includes(ext)) {
      setActiveViewer({ type: 'AUDIO', path: extractedPath, name: item.name });
    } else if (['docx', 'doc'].includes(ext)) {
      setActiveViewer({
        type: 'OFFICE',
        path: extractedPath,
        name: item.name,
        formatType: ext === 'doc' ? 'DOC' : 'DOCX',
      });
    } else if (['pptx', 'ppt'].includes(ext)) {
      setActiveViewer({
        type: 'OFFICE',
        path: extractedPath,
        name: item.name,
        formatType: ext === 'ppt' ? 'PPT' : 'PPTX',
      });
    } else if (['xlsx', 'xls'].includes(ext)) {
      setActiveViewer({ type: 'XLSX', path: extractedPath, name: item.name });
    } else if (['csv', 'tsv'].includes(ext)) {
      setActiveViewer({ type: 'CSV', path: extractedPath, name: item.name });
    } else {
      setActiveViewer({ type: 'TEXT', path: extractedPath, name: item.name });
    }
  };

  const handleFilePress = async (item: ArchiveItem) => {
    if (item.isDirectory) {
      handleNavigateFolder(item);
      return;
    }

    setExtractingName(item.name);
    try {
      const extractedPath = await engine.extractSingleZip(filePath, item.fullPath, savedPassword || undefined);
      extractedFilesRef.current.push(extractedPath);
      openViewerForFile(item, extractedPath);
    } catch (err: any) {
      const msg = err.message || String(err);
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('encrypt') ||
        msg.toLowerCase().includes('aes')
      ) {
        setPendingFileItem(item);
        setIsPasswordModalVisible(true);
      } else {
        setErrorMsg(`Failed to open "${item.name}": ${msg}`);
      }
    } finally {
      setExtractingName(null);
    }
  };

  // Selection toggle
  const handleToggleSelect = (itemPath: string) => {
    const updated = new Set(selectedPaths);
    if (updated.has(itemPath)) {
      updated.delete(itemPath);
    } else {
      updated.add(itemPath);
    }
    setSelectedPaths(updated);
  };

  const handleSelectAll = () => {
    if (selectedPaths.size === visibleItems.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(visibleItems.map((i) => i.fullPath)));
    }
  };

  // Execute extraction process (Figma Image 4)
  const handleStartExtraction = async (options: {
    mode: 'ALL' | 'SELECTED';
    keepFolderStructure: boolean;
    conflictResolution: 'SKIP' | 'REPLACE' | 'KEEP_BOTH';
  }) => {
    const itemsToExtract =
      options.mode === 'SELECTED'
        ? allItems.filter((i) => selectedPaths.has(i.fullPath) && !i.isDirectory)
        : allItems.filter((i) => !i.isDirectory);

    if (itemsToExtract.length === 0) return;

    setIsExtractionProgressVisible(true);
    setExtractionProgress({ current: 0, total: itemsToExtract.length, file: '', percent: 0 });

    const failed: Array<{ name: string; reason: string }> = [];
    let successCount = 0;

    for (let i = 0; i < itemsToExtract.length; i++) {
      const item = itemsToExtract[i];
      const percent = ((i + 1) / itemsToExtract.length) * 100;
      setExtractionProgress({
        current: i + 1,
        total: itemsToExtract.length,
        file: item.name,
        percent,
      });

      try {
        await engine.extractSingleZip(filePath, item.fullPath, savedPassword || undefined);
        successCount++;
      } catch (err: any) {
        failed.push({
          name: item.name,
          reason: item.isEncrypted ? 'Needs a password' : 'Damaged entry',
        });
      }
    }

    setIsExtractionProgressVisible(false);
    setExtractionResult({
      successCount,
      totalCount: itemsToExtract.length,
      dest: defaultDownloadDest,
      failed,
    });
    setIsExtractionResultVisible(true);
  };

  // Breadcrumbs segments
  const breadcrumbSegments = useMemo(() => {
    const segments: Array<{ label: string; fullPath: string }> = [
      { label: fileName, fullPath: '' },
    ];
    if (currentPath) {
      const parts = currentPath.split('/').filter(Boolean);
      let accumulated = '';
      for (const part of parts) {
        accumulated += `${part}/`;
        segments.push({ label: part, fullPath: accumulated });
      }
    }
    return segments;
  }, [currentPath, fileName]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      {/* 1. TOP HEADER (#016EEF) */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleBox}>
          <Text style={styles.headerTitleText} numberOfLines={1}>
            {fileName}
          </Text>
          <Text style={styles.headerSubText}>
            ZIP archive • {allItems.length} items
          </Text>
        </View>

        <TouchableOpacity style={styles.headerActionBtn} activeOpacity={0.7}>
          <Text style={styles.headerActionText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* 2. BREADCRUMBS BAR (Figma Image 3) */}
      {currentPath.length > 0 && (
        <View style={styles.breadcrumbsBar}>
          <TouchableOpacity onPress={() => setCurrentPath('')} activeOpacity={0.7}>
            <Text style={styles.breadcrumbLink}>{fileName}</Text>
          </TouchableOpacity>
          {breadcrumbSegments.slice(1).map((seg, idx, arr) => {
            const isLast = idx === arr.length - 1;
            return (
              <React.Fragment key={seg.fullPath}>
                <Text style={styles.breadcrumbSep}>&gt;</Text>
                <TouchableOpacity
                  onPress={() => setCurrentPath(seg.fullPath)}
                  disabled={isLast}
                  activeOpacity={0.7}>
                  <Text style={[styles.breadcrumbLink, isLast && styles.breadcrumbActive]}>
                    {seg.label}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>
            );
          })}
        </View>
      )}

      {/* 3. ARCHIVE OVERVIEW CARD (Figma Image 3) */}
      {!currentPath && (
        <View style={styles.archiveOverviewCard}>
          <View style={styles.overviewBadge}>
            <Text style={styles.overviewBadgeText}>ZIP</Text>
          </View>
          <View style={styles.overviewInfo}>
            <Text style={styles.overviewTitle}>ZIP archive</Text>
            <Text style={styles.overviewMeta}>
              {allItems.length} items • {formatSize(totalBytes)}
            </Text>
          </View>
          {lockedCount > 0 && (
            <View style={styles.lockedPill}>
              <Text style={styles.lockedPillText}>🔒 {lockedCount} locked</Text>
            </View>
          )}
        </View>
      )}

      {/* 4. SELECTION / COUNT BAR (Figma Image 3) */}
      <View style={styles.countSelectionBar}>
        <Text style={styles.countText}>
          {selectedPaths.size > 0 ? `${selectedPaths.size} selected` : 'Contents'}
        </Text>
        <TouchableOpacity activeOpacity={0.7} onPress={handleSelectAll}>
          <Text style={styles.selectAllText}>
            {selectedPaths.size === visibleItems.length ? 'Deselect all' : 'Select all'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 5. CONTENTS LIST (Figma Image 3) */}
      {isLoading ? (
        <View style={styles.centerStatusBox}>
          <ActivityIndicator size="large" color={FigmaTheme.colors.primary} />
          <Text style={styles.loadingText}>Reading archive contents...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.centerStatusBox}>
          <Text style={styles.emptyIcon}>⚠️</Text>
          <Text style={styles.emptyTitle}>Cannot open archive</Text>
          <Text style={styles.emptySubtitle}>{errorMsg}</Text>
          <TouchableOpacity style={styles.backToArchiveBtn} activeOpacity={0.8} onPress={() => loadContents()}>
            <Text style={styles.backToArchiveBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : visibleItems.length === 0 ? (
        /* EMPTY FOLDER STATE (Figma Image 4) */
        <View style={styles.emptyFolderBox}>
          <Text style={styles.emptyIcon}>📁</Text>
          <Text style={styles.emptyTitle}>This folder is empty</Text>
          <Text style={styles.emptySubtitle}>There's nothing to extract here.</Text>
          <TouchableOpacity style={styles.backToArchiveBtn} activeOpacity={0.8} onPress={handleNavigateUp}>
            <Text style={styles.backToArchiveBtnText}>&lt; Back to archive</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.fullPath}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const badge = getFileBadge(item.name, item.isDirectory);
            const isSelected = selectedPaths.has(item.fullPath);
            const isExtracting = extractingName === item.name;

            return (
              <View style={[styles.itemRow, isSelected && styles.itemRowSelected]}>
                {/* Selection Checkbox */}
                <TouchableOpacity
                  style={styles.checkboxTouch}
                  activeOpacity={0.7}
                  onPress={() => handleToggleSelect(item.fullPath)}>
                  <View style={[styles.checkboxBox, isSelected && styles.checkboxBoxSelected]}>
                    {isSelected && <Text style={styles.checkboxCheck}>✓</Text>}
                  </View>
                </TouchableOpacity>

                {/* File Row Body */}
                <TouchableOpacity
                  style={styles.itemRowBody}
                  activeOpacity={0.7}
                  onPress={() => handleFilePress(item)}>
                  <View style={[styles.itemBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.itemBadgeText, { color: badge.text }]}>{badge.label}</Text>
                  </View>

                  <View style={styles.itemMetaBox}>
                    <Text style={styles.itemNameText} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.itemSubText}>
                      {item.isDirectory
                        ? 'Folder'
                        : `${formatSize(item.size)}${item.isEncrypted ? ' • Encrypted 🔒' : ''}`}
                    </Text>
                  </View>

                  {isExtracting ? (
                    <ActivityIndicator size="small" color={FigmaTheme.colors.primary} />
                  ) : item.isDirectory ? (
                    <Text style={styles.chevron}>&gt;</Text>
                  ) : null}
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* 6. BOTTOM DOCKED BAR: [ Extract all | Extract selected ] (Figma Image 3) */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.extractAllBtn}
          activeOpacity={0.8}
          onPress={() => setIsExtractionOptionsVisible(true)}>
          <Text style={styles.extractAllBtnText}>Extract all</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.extractSelectedBtn, selectedPaths.size === 0 && styles.extractSelectedBtnDisabled]}
          disabled={selectedPaths.size === 0}
          activeOpacity={0.8}
          onPress={() => setIsExtractionOptionsVisible(true)}>
          <Text style={styles.extractSelectedBtnText}>
            Extract selected {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 7. EXTRACTION OPTIONS MODAL (Figma Image 4) */}
      <ExtractionOptionsModal
        visible={isExtractionOptionsVisible}
        totalItemsCount={allItems.length}
        totalSizeBytes={totalBytes}
        selectedItemsCount={selectedPaths.size}
        selectedSizeBytes={allItems
          .filter((i) => selectedPaths.has(i.fullPath))
          .reduce((a, c) => a + c.size, 0)}
        destinationPath={defaultDownloadDest}
        onClose={() => setIsExtractionOptionsVisible(false)}
        onConfirmExtract={handleStartExtraction}
      />

      {/* 8. EXTRACTION PROGRESS MODAL (Figma Image 4) */}
      <ExtractionProgressModal
        visible={isExtractionProgressVisible}
        currentCount={extractionProgress.current}
        totalCount={extractionProgress.total}
        currentFileName={extractionProgress.file}
        progressPercent={extractionProgress.percent}
        onCancel={() => setIsExtractionProgressVisible(false)}
      />

      {/* 9. EXTRACTION RESULT MODAL (Figma Image 4) */}
      <ExtractionResultModal
        visible={isExtractionResultVisible}
        successCount={extractionResult.successCount}
        totalCount={extractionResult.totalCount}
        destinationPath={extractionResult.dest}
        failedItems={extractionResult.failed}
        onBrowseExtracted={() => setIsExtractionResultVisible(false)}
        onOpenExtracted={() => setIsExtractionResultVisible(false)}
        onClose={() => setIsExtractionResultVisible(false)}
      />

      {/* 10. ARCHIVE RECOVERY MODAL (Figma Image 5) */}
      <ArchiveRecoveryModal
        visible={recoveryState.visible}
        type={recoveryState.type}
        onRetry={() => {
          setRecoveryState({ visible: false, type: 'DAMAGED' });
          loadContents();
        }}
        onShare={() => engine.shareFile(filePath)}
        onClose={() => setRecoveryState({ visible: false, type: 'DAMAGED' })}
      />

      {/* 11. PASSWORD MODAL */}
      <PasswordModal
        visible={isPasswordModalVisible}
        fileName={pendingFileItem ? pendingFileItem.name : fileName}
        errorMsg={passwordError}
        isLoading={isLoading}
        onUnlock={async (pwd) => {
          setPasswordError(null);
          setSavedPassword(pwd);
          if (pendingFileItem) {
            const item = pendingFileItem;
            setExtractingName(item.name);
            try {
              const extractedPath = await engine.extractSingleZip(filePath, item.fullPath, pwd);
              extractedFilesRef.current.push(extractedPath);
              setIsPasswordModalVisible(false);
              setPendingFileItem(null);
              openViewerForFile(item, extractedPath);
            } catch (err: any) {
              setPasswordError('Incorrect password. Please try again.');
            } finally {
              setExtractingName(null);
            }
          } else {
            loadContents(pwd);
          }
        }}
        onCancel={() => {
          setIsPasswordModalVisible(false);
          setPendingFileItem(null);
        }}
      />

      {/* 12. SUB-VIEWER MODAL */}
      {activeViewer && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', zIndex: 100 }]}>
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
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FigmaTheme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: FigmaTheme.colors.headerBlue,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  backBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerTitleBox: {
    flex: 1,
    marginRight: 10,
  },
  headerTitleText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 2,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActionText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },

  breadcrumbsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    gap: 6,
  },
  breadcrumbLink: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.primary,
  },
  breadcrumbActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
  breadcrumbSep: {
    fontSize: 11,
    color: '#94A3B8',
  },

  archiveOverviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  overviewBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  overviewBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#D97706',
  },
  overviewInfo: {
    flex: 1,
  },
  overviewTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  overviewMeta: {
    fontSize: 12,
    color: '#64748B',
  },
  lockedPill: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  lockedPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },

  countSelectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  countText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...FigmaTheme.shadows.card,
  },
  itemRowSelected: {
    backgroundColor: '#EFF6FF',
    borderColor: FigmaTheme.colors.primary,
  },
  checkboxTouch: {
    paddingRight: 10,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxBoxSelected: {
    backgroundColor: FigmaTheme.colors.primary,
    borderColor: FigmaTheme.colors.primary,
  },
  checkboxCheck: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  itemRowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemBadge: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  itemBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  itemMetaBox: {
    flex: 1,
    marginRight: 8,
  },
  itemNameText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  itemSubText: {
    fontSize: 11,
    color: '#64748B',
  },
  chevron: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94A3B8',
  },

  // Bottom Action Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 12,
    ...FigmaTheme.shadows.floating,
  },
  extractAllBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  extractAllBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },
  extractSelectedBtn: {
    flex: 1,
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  extractSelectedBtnDisabled: {
    opacity: 0.5,
  },
  extractSelectedBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  centerStatusBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },

  emptyFolderBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 10,
    opacity: 0.6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 20,
  },
  backToArchiveBtn: {
    backgroundColor: FigmaTheme.colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  backToArchiveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

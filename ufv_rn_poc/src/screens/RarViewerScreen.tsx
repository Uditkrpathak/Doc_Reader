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
} from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';
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
  isEncrypted?: boolean;
}

export const RarViewerScreen: React.FC<RarViewerProps> = ({
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

  const loadContents = async (_pwd?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setPasswordError(null);

    try {
      // First check if this is part of a split RAR missing parts
      try {
        const missingVol = await engine.checkRarMissingVolume(filePath);
        if (missingVol && missingVol.isMissing) {
          setRecoveryState({ visible: true, type: 'MISSING_PART' });
          setIsLoading(false);
          return;
        }
      } catch {}

      const list = await engine.listRarContents(filePath);
      const items: ArchiveItem[] = list.map((e) => {
        const cleanPath = e.name.replace(/\\/g, '/').replace(/^\/+/, '');
        const isDir = e.isDirectory || cleanPath.endsWith('/');
        const stripped = cleanPath.replace(/\/+$/, '');
        const leafName = stripped.split('/').pop() || stripped;

        return {
          fullPath: isDir ? `${stripped}/` : stripped,
          name: leafName,
          size: e.size || 0,
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
      } else if (msg.toLowerCase().includes('corrupt') || msg.toLowerCase().includes('damage')) {
        setRecoveryState({ visible: true, type: 'DAMAGED' });
      } else {
        setErrorMsg(`Failed to list RAR contents: ${msg}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const totalBytes = useMemo(() => {
    return allItems.reduce((acc, cur) => acc + (cur.size || 0), 0);
  }, [allItems]);

  // Build folder hierarchy for currentPath
  const visibleItems = useMemo(() => {
    const folders = new Map<string, ArchiveItem>();
    const files: ArchiveItem[] = [];

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
      const extractedPath = await engine.extractSingleRar(filePath, item.fullPath);
      extractedFilesRef.current.push(extractedPath);
      openViewerForFile(item, extractedPath);
    } catch (err: any) {
      const msg = err.message || String(err);
      if (
        msg.includes('22') ||
        msg.includes('24') ||
        msg.toLowerCase().includes('password')
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
        await engine.extractSingleRar(filePath, item.fullPath);
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
            RAR archive • {allItems.length} items
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

      {/* 3. ARCHIVE OVERVIEW CARD (Figma Image 3 Archive preview) */}
      {currentPath.length === 0 && !searchQuery && (
        <View style={styles.overviewCard}>
          <View style={styles.overviewIconBox}>
            <Text style={styles.overviewIconText}>📦</Text>
          </View>
          <View style={styles.overviewTextBox}>
            <Text style={styles.overviewTitle}>RAR archive</Text>
            <View style={styles.overviewMetaRow}>
              <Text style={styles.overviewMetaText}>
                {allItems.length} items • {formatSize(totalBytes)}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* 4. SEARCH / FILTER BAR */}
      <View style={styles.searchContainer}>
        <View style={styles.searchInputBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search inside archive..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* 5. CONTENTS HEADER & SELECTION TOGGLE */}
      <View style={styles.contentsHeader}>
        <Text style={styles.contentsTitle}>Contents</Text>
        <View style={styles.contentsRightActions}>
          {selectedPaths.size > 0 && (
            <Text style={styles.selectedCountText}>
              {selectedPaths.size} selected
            </Text>
          )}
          <TouchableOpacity onPress={handleSelectAll} activeOpacity={0.7}>
            <Text style={styles.selectAllBtnText}>
              {selectedPaths.size === visibleItems.length && visibleItems.length > 0
                ? 'Deselect all'
                : 'Select all'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 6. MAIN FILE LIST / STATES */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={FigmaTheme.colors.primary} />
          <Text style={styles.centerLoadingText}>Reading RAR archive...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.centerBox}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Cannot open archive</Text>
          <Text style={styles.errorDesc}>{errorMsg}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => loadContents()} activeOpacity={0.7}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : visibleItems.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIconBox}>
            <Text style={styles.emptyIcon}>📁</Text>
          </View>
          <Text style={styles.emptyTitle}>This folder is empty</Text>
          <Text style={styles.emptySubtitle}>There's nothing to extract here.</Text>
          {currentPath.length > 0 && (
            <TouchableOpacity style={styles.emptyBackBtn} onPress={handleNavigateUp} activeOpacity={0.7}>
              <Text style={styles.emptyBackBtnText}>Back to archive</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.fullPath}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isSelected = selectedPaths.has(item.fullPath);
            const badge = getFileBadge(item.name, item.isDirectory);

            return (
              <View style={[styles.itemRow, isSelected && styles.itemRowSelected]}>
                {/* Selection Checkbox */}
                <TouchableOpacity
                  style={styles.checkboxTouch}
                  onPress={() => handleToggleSelect(item.fullPath)}
                  activeOpacity={0.7}>
                  <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </TouchableOpacity>

                {/* File / Folder Press */}
                <TouchableOpacity
                  style={styles.itemContentTouch}
                  onPress={() => handleFilePress(item)}
                  activeOpacity={0.7}>
                  <View style={[styles.badgePill, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeText, { color: badge.text }]}>
                      {badge.label}
                    </Text>
                  </View>

                  <View style={styles.itemTextBox}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <View style={styles.itemMetaRow}>
                      {item.isDirectory ? (
                        <Text style={styles.itemMetaText}>Folder</Text>
                      ) : (
                        <Text style={styles.itemMetaText}>{formatSize(item.size)}</Text>
                      )}
                    </View>
                  </View>

                  <Text style={styles.chevronIcon}>›</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* 7. BOTTOM ACTION DOCK (Figma Image 3 Archive preview) */}
      <View style={styles.bottomDock}>
        <TouchableOpacity
          style={styles.extractAllBtn}
          onPress={() => setIsExtractionOptionsVisible(true)}
          activeOpacity={0.7}>
          <Text style={styles.extractAllBtnText}>Extract all</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.extractSelectedBtn,
            selectedPaths.size === 0 && styles.extractSelectedBtnDisabled,
          ]}
          disabled={selectedPaths.size === 0}
          onPress={() => setIsExtractionOptionsVisible(true)}
          activeOpacity={0.7}>
          <Text style={styles.extractSelectedBtnText}>
            {selectedPaths.size > 0
              ? `Extract selected (${selectedPaths.size})`
              : 'Extract selected'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Extracting Indicator Overlay */}
      {extractingName && (
        <View style={styles.extractingOverlay}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={styles.extractingText}>Extracting {extractingName}...</Text>
        </View>
      )}

      {/* Password Modal */}
      <PasswordModal
        visible={isPasswordModalVisible}
        fileName={pendingFileItem ? pendingFileItem.name : fileName}
        errorMsg={passwordError}
        isLoading={isLoading}
        onUnlock={(pwd) => {
          loadContents(pwd);
        }}
        onCancel={() => {
          setIsPasswordModalVisible(false);
          setPendingFileItem(null);
        }}
      />

      {/* Extraction Options Modal (Figma Image 4) */}
      <ExtractionOptionsModal
        visible={isExtractionOptionsVisible}
        totalItemsCount={allItems.length}
        totalSizeBytes={totalBytes}
        selectedItemsCount={selectedPaths.size}
        selectedSizeBytes={Array.from(selectedPaths).reduce((acc, p) => {
          const item = allItems.find((i) => i.fullPath === p);
          return acc + (item?.size || 0);
        }, 0)}
        destinationPath={defaultDownloadDest}
        onClose={() => setIsExtractionOptionsVisible(false)}
        onConfirmExtract={(options: {
          mode: 'ALL' | 'SELECTED';
          keepFolderStructure: boolean;
          conflictResolution: 'SKIP' | 'REPLACE' | 'KEEP_BOTH';
        }) => {
          setIsExtractionOptionsVisible(false);
          handleStartExtraction(options);
        }}
      />

      {/* Extraction Progress Modal (Figma Image 4) */}
      <ExtractionProgressModal
        visible={isExtractionProgressVisible}
        currentCount={extractionProgress.current}
        totalCount={extractionProgress.total}
        currentFileName={extractionProgress.file}
        progressPercent={extractionProgress.percent}
        onCancel={() => setIsExtractionProgressVisible(false)}
      />

      {/* Extraction Result Modal (Figma Image 4) */}
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

      {/* Archive Recovery Modal (Figma Image 5) */}
      <ArchiveRecoveryModal
        visible={recoveryState.visible}
        type={recoveryState.type}
        onRetry={() => {
          setRecoveryState({ visible: false, type: 'DAMAGED' });
          loadContents();
        }}
        onClose={() => {
          setRecoveryState({ visible: false, type: 'DAMAGED' });
          onClose();
        }}
      />

      {/* Nested Sub-viewers */}
      {activeViewer && activeViewer.type === 'PDF' && (
        <View style={StyleSheet.absoluteFill}>
          <PdfViewer
            filePath={activeViewer.path}
            fileName={activeViewer.name}
            onClose={() => setActiveViewer(null)}
          />
        </View>
      )}

      {activeViewer && activeViewer.type === 'IMAGE' && (
        <View style={StyleSheet.absoluteFill}>
          <ImageViewer
            filePath={activeViewer.path}
            fileName={activeViewer.name}
            onClose={() => setActiveViewer(null)}
          />
        </View>
      )}

      {activeViewer && activeViewer.type === 'VIDEO' && (
        <View style={StyleSheet.absoluteFill}>
          <MediaViewer
            filePath={activeViewer.path}
            fileName={activeViewer.name}
            category="VIDEO"
            onClose={() => setActiveViewer(null)}
          />
        </View>
      )}

      {activeViewer && activeViewer.type === 'AUDIO' && (
        <View style={StyleSheet.absoluteFill}>
          <MediaViewer
            filePath={activeViewer.path}
            fileName={activeViewer.name}
            category="AUDIO"
            onClose={() => setActiveViewer(null)}
          />
        </View>
      )}

      {activeViewer && activeViewer.type === 'OFFICE' && (
        <View style={StyleSheet.absoluteFill}>
          <OfficeViewer
            filePath={activeViewer.path}
            fileName={activeViewer.name}
            formatType={activeViewer.formatType}
            onClose={() => setActiveViewer(null)}
          />
        </View>
      )}

      {activeViewer && activeViewer.type === 'XLSX' && (
        <View style={StyleSheet.absoluteFill}>
          <XlsxViewer
            filePath={activeViewer.path}
            fileName={activeViewer.name}
            onClose={() => setActiveViewer(null)}
          />
        </View>
      )}

      {activeViewer && activeViewer.type === 'CSV' && (
        <View style={StyleSheet.absoluteFill}>
          <CsvViewer
            filePath={activeViewer.path}
            fileName={activeViewer.name}
            onClose={() => setActiveViewer(null)}
          />
        </View>
      )}

      {activeViewer && activeViewer.type === 'TEXT' && (
        <View style={StyleSheet.absoluteFill}>
          <TextViewer
            filePath={activeViewer.path}
            fileName={activeViewer.name}
            onClose={() => setActiveViewer(null)}
          />
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
    backgroundColor: FigmaTheme.colors.headerBlue,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  headerTitleBox: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitleText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  headerSubText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 11,
    marginTop: 2,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActionText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  breadcrumbsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  breadcrumbLink: {
    fontSize: 12,
    color: FigmaTheme.colors.primary,
    fontWeight: '600',
  },
  breadcrumbActive: {
    color: '#64748B',
    fontWeight: '700',
  },
  breadcrumbSep: {
    marginHorizontal: 6,
    color: '#94A3B8',
    fontSize: 12,
  },
  overviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 6,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  overviewIconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: FigmaTheme.colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  overviewIconText: {
    fontSize: 22,
  },
  overviewTextBox: {
    flex: 1,
  },
  overviewTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  overviewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  overviewMetaText: {
    fontSize: 12,
    color: '#64748B',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  searchInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchIcon: {
    marginRight: 8,
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
  },
  searchClear: {
    fontSize: 14,
    color: '#94A3B8',
    padding: 4,
  },
  contentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  contentsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  contentsRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectedCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.primary,
  },
  selectAllBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: FigmaTheme.colors.primary,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 90,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  itemRowSelected: {
    borderColor: FigmaTheme.colors.primary,
    backgroundColor: '#F0F7FF',
  },
  checkboxTouch: {
    paddingRight: 10,
    paddingVertical: 6,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: FigmaTheme.colors.primary,
    borderColor: FigmaTheme.colors.primary,
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  itemContentTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgePill: {
    width: 38,
    height: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  itemTextBox: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 6,
  },
  itemMetaText: {
    fontSize: 11,
    color: '#64748B',
  },
  chevronIcon: {
    fontSize: 18,
    color: '#94A3B8',
    marginLeft: 6,
  },
  bottomDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 12,
  },
  extractAllBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: FigmaTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  extractAllBtnText: {
    color: FigmaTheme.colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  extractSelectedBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    backgroundColor: FigmaTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  extractSelectedBtnDisabled: {
    backgroundColor: '#94A3B8',
  },
  extractSelectedBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  extractingOverlay: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  extractingText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  centerLoadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#64748B',
  },
  errorIcon: {
    fontSize: 42,
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  errorDesc: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: FigmaTheme.colors.primary,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 40,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
    marginBottom: 16,
  },
  emptyBackBtn: {
    backgroundColor: FigmaTheme.colors.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  emptyBackBtnText: {
    color: FigmaTheme.colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
});

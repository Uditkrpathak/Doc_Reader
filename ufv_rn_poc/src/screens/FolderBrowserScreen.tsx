import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Modal,
  StatusBar,
  Linking,
  AppState,
  Animated,
  Easing,
} from 'react-native';
import { RNFS, ReadDirItem } from '../services/RNFS';
import { MMKV, RecentFile } from '../services/MMKV';
import { FileDetector } from '../services/FileDetector';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { usePermissions } from '../hooks/usePermissions';
import { FigmaTheme } from '../theme/FigmaTheme';
import {
  DocumentFileBadgeIcon,
  FolderOutlineIcon,
  LockOutlineIcon,
  SearchOutlineIcon,
  PhoneOutlineIcon,
  EmptyFolderDashedIcon,
  AudioNoteIcon,
  SelectionCheckbox,
  ShareVectorIcon,
  StarOutlineIcon,
  WarningTriangleIcon,
} from '../components/AppIcons';

// Figma Modals & Sheets
import { SortBottomSheet, SortCriteria, SortDirection } from '../components/SortBottomSheet';
import { FileActionMenuModal, ActionMenuItemFile } from '../components/FileActionMenuModal';
import { FileInformationModal, FileInfoData } from '../components/FileInformationModal';

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
import { UnsupportedFileScreen } from './UnsupportedFileScreen';

interface FolderBrowserScreenProps {
  navigation?: {
    navigate: (screen: string, params?: any) => void;
    goBack?: () => void;
  };
  initialPath?: string;
  initialCategory?: string;
  showRecents?: boolean;
  onSelectionModeChange?: (active: boolean) => void;
}

type CategoryFilter =
  | 'ALL'
  | 'DOCUMENTS'
  | 'SPREADSHEETS'
  | 'PRESENTATIONS'
  | 'IMAGES'
  | 'AUDIO'
  | 'ARCHIVES';

export const FolderBrowserScreen: React.FC<FolderBrowserScreenProps> = ({
  navigation,
  initialPath,
  initialCategory,
  showRecents,
  onSelectionModeChange,
}) => {
  const {
    permissionState,
    requestAllFilesAccess,
    refreshPermissions,
  } = usePermissions();

  const rootPath = '/storage/emulated/0';
  const defaultStartPath = initialPath || rootPath;

  const [currentPath, setCurrentPath] = useState<string>(defaultStartPath);

  useEffect(() => {
    if (initialPath) {
      setCurrentPath(initialPath);
    } else {
      setCurrentPath(rootPath);
    }
  }, [initialPath]);
  const [items, setItems] = useState<ReadDirItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchError, setSearchError] = useState<boolean>(false);
  const [selectedFilter, setSelectedFilter] = useState<CategoryFilter>(
    (initialCategory?.toUpperCase() as CategoryFilter) || 'ALL'
  );

  useEffect(() => {
    if (initialCategory) {
      setSelectedFilter((initialCategory.toUpperCase() as CategoryFilter) || 'ALL');
    }
  }, [initialCategory]);

  // Load recent files if showRecents is true (Figma Screen 4)
  useEffect(() => {
    if (showRecents) {
      const recents = MMKV.getRecentFiles();
      const mapped: ReadDirItem[] = recents.map((r) => ({
        name: r.name,
        path: r.path,
        size: r.size || 0,
        mtime: new Date(r.timestamp),
        isFile: () => true,
        isDirectory: () => false,
      }));
      setItems(mapped);
      setIsLoading(false);
    }
  }, [showRecents]);

  // Sorting
  const [isSortSheetVisible, setIsSortSheetVisible] = useState<boolean>(false);
  const [sortCriteria, setSortCriteria] = useState<SortCriteria>('NAME');
  const [sortDirection, setSortDirection] = useState<SortDirection>('ASC');

  // Multi-selection mode (Figma Screen 10)
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [starredTick, setStarredTick] = useState<number>(0);

  useEffect(() => {
    onSelectionModeChange?.(isSelectionMode);
  }, [isSelectionMode, onSelectionModeChange]);

  // Action Menu & File Info Modals (Figma Screen 12 & 16)
  const [actionMenuFile, setActionMenuFile] = useState<ActionMenuItemFile | null>(null);
  const [infoModalFile, setInfoModalFile] = useState<FileInfoData | null>(null);

  // Active viewer modal
  const [activeViewer, setActiveViewer] = useState<{
    file: string;
    path: string;
    category: string;
    formatType?: any;
  } | null>(null);

  const [folderCounts, setFolderCounts] = useState<Record<string, number>>({});
  const progressAnim = useRef(new Animated.Value(0)).current;

  const engine = ArchiveEngine.getInstance();

  const loadDirectory = useCallback(async (dirPath: string) => {
    if (showRecents) return;
    setIsLoading(true);
    setSearchError(false);
    try {
      const files = await RNFS.readDir(dirPath);
      setItems(files);
    } catch (err) {
      console.warn('FolderBrowser readDir error:', err);
      setItems([]);
      setSearchError(true);
    } finally {
      setIsLoading(false);
    }
  }, [showRecents]);

  useEffect(() => {
    if (!showRecents) {
      loadDirectory(currentPath);
    }
  }, [currentPath, loadDirectory, showRecents]);

  // Loading progress bar loop animation for Screen 3
  useEffect(() => {
    if (!isLoading) {
      return undefined;
    }
    progressAnim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [isLoading, progressAnim]);

  // AppState listener for permission reload
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshPermissions().then((perms) => {
          if (perms.allFiles || perms.documentsTreeGranted) {
            loadDirectory(currentPath);
          }
        });
      }
    });
    return () => sub.remove();
  }, [refreshPermissions, currentPath, loadDirectory]);

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatRelativeTime = (date?: Date): string => {
    if (!date) return 'Recently';
    const now = Date.now();
    const diffSec = Math.floor((now - date.getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatOpenedTime = (timestamp?: number): string => {
    if (!timestamp) return 'Opened recently';
    const now = new Date();
    const d = new Date(timestamp);
    const isToday =
      now.getDate() === d.getDate() &&
      now.getMonth() === d.getMonth() &&
      now.getFullYear() === d.getFullYear();
    if (isToday) return 'Opened today';

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      yesterday.getDate() === d.getDate() &&
      yesterday.getMonth() === d.getMonth() &&
      yesterday.getFullYear() === d.getFullYear();
    if (isYesterday) return 'Opened yesterday';

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `Opened ${d.getDate()} ${months[d.getMonth()]}`;
  };

  const getBadgeForFile = (fileName: string) => {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return FigmaTheme.badges.pdf;
    if (['xlsx', 'xls', 'csv'].includes(ext)) return FigmaTheme.badges.excel;
    if (['docx', 'doc', 'txt', 'rtf'].includes(ext)) return FigmaTheme.badges.word;
    if (['pptx', 'ppt'].includes(ext)) return FigmaTheme.badges.pptx;
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FigmaTheme.badges.archive;
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return FigmaTheme.badges.video;
    if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return FigmaTheme.badges.audio;
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return FigmaTheme.badges.image;
    return FigmaTheme.badges.unknown;
  };

  // Breadcrumb segments
  const breadcrumbSegments = useMemo(() => {
    let normalizedPath = currentPath;
    if (normalizedPath.startsWith('/sdcard')) {
      normalizedPath = normalizedPath.replace(/^\/sdcard/, '/storage/emulated/0');
    }
    const cleanRoot = '/storage/emulated/0';
    let relative = normalizedPath.startsWith(cleanRoot)
      ? normalizedPath.slice(cleanRoot.length)
      : normalizedPath;
    if (relative.startsWith('/')) relative = relative.slice(1);
    const parts = relative ? relative.split('/') : [];

    const segments: Array<{ label: string; fullPath: string }> = [
      { label: 'Internal storage', fullPath: cleanRoot },
    ];

    let accumulated = cleanRoot;
    for (const part of parts) {
      if (!part) continue;
      accumulated = `${accumulated}/${part}`;
      segments.push({ label: part, fullPath: accumulated });
    }
    return segments;
  }, [currentPath]);

  // Navigate deeper into folder
  const handleOpenFolder = (folderPath: string) => {
    setCurrentPath(folderPath);
    setSearchQuery('');
  };

  // Navigate up one folder
  const handleNavigateUp = () => {
    if (breadcrumbSegments.length > 1) {
      const parent = breadcrumbSegments[breadcrumbSegments.length - 2];
      setCurrentPath(parent.fullPath);
      setSearchQuery('');
    } else if (navigation?.goBack) {
      navigation.goBack();
    }
  };

  const openMatchingViewer = (fileName: string, filePath: string, category: string) => {
    let formatType = undefined;
    const ext = fileName.split('.').pop()?.toLowerCase() || '';

    if (ext === 'rar' || category === 'ARCHIVE_RAR' || category === 'ARCHIVE_RAR4' || category === 'ARCHIVE_RAR5') {
      setActiveViewer({ file: fileName, path: filePath, category: 'ARCHIVE_RAR' });
      return;
    }
    if (ext === 'zip' || category === 'ARCHIVE_ZIP' || category === 'ARCHIVE') {
      setActiveViewer({ file: fileName, path: filePath, category: 'ARCHIVE_ZIP' });
      return;
    }
    if (ext === 'xlsx' || ext === 'xls' || category === 'OFFICE_XLSX' || category === 'EXCEL' || category === 'LEGACY_OLE_XLS') {
      setActiveViewer({ file: fileName, path: filePath, category: 'OFFICE_XLSX' });
      return;
    }
    if (ext === 'csv' || ext === 'tsv' || category === 'SPREADSHEET_CSV') {
      setActiveViewer({ file: fileName, path: filePath, category: 'SPREADSHEET_CSV' });
      return;
    }
    if (
      ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic', 'heif', 'avif'].includes(ext) ||
      category === 'IMAGE'
    ) {
      setActiveViewer({ file: fileName, path: filePath, category: 'IMAGE' });
      return;
    }

    if (['mp4', 'mkv', 'webm', 'avi', 'mov', '3gp'].includes(ext) || category === 'VIDEO') {
      setActiveViewer({ file: fileName, path: filePath, category: 'VIDEO' });
      return;
    }
    if (['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a'].includes(ext) || category === 'AUDIO') {
      setActiveViewer({ file: fileName, path: filePath, category: 'AUDIO' });
      return;
    }

    if (ext === 'docx' || category === 'OFFICE_DOCX' || category === 'WORD') {
      formatType = 'DOCX';
      category = 'OFFICE_DOCX';
    } else if (ext === 'pptx' || category === 'OFFICE_PPTX' || category === 'PPT') {
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
    } else if (
      [
        'txt', 'log', 'json', 'xml', 'md', 'html', 'htm', 'css', 'js', 'jsx',
        'ts', 'tsx', 'java', 'kt', 'py', 'c', 'cpp', 'h', 'cs', 'sh',
        'sql', 'yaml', 'yml', 'env', 'ini', 'conf', 'gradle', 'properties',
      ].includes(ext) ||
      category === 'TEXT_CODE'
    ) {
      category = 'TEXT_CODE';
    } else {
      category = 'UNSUPPORTED';
    }

    setActiveViewer({
      file: fileName,
      path: filePath,
      category,
      formatType,
    });
  };

  const handleOpenFile = async (item: ReadDirItem) => {
    try {
      const detected = await FileDetector.detectFile(item.path, item.name);
      MMKV.addRecentFile({
        name: item.name,
        path: item.path,
        size: item.size || 0,
        timestamp: Date.now(),
        category: detected.category,
      });
      openMatchingViewer(item.name, item.path, detected.category);
    } catch {
      openMatchingViewer(item.name, item.path, 'UNKNOWN');
    }
  };

  const handleToggleStar = (file: { name: string; path: string; size?: number; category?: string }) => {
    MMKV.toggleStarred({
      name: file.name,
      path: file.path,
      size: file.size || 0,
      timestamp: Date.now(),
      category: file.category || 'UNKNOWN',
    });
    setItems([...items]);
  };

  // Selection mode helpers
  const handleToggleSelect = (filePath: string) => {
    const updated = new Set(selectedPaths);
    if (updated.has(filePath)) {
      updated.delete(filePath);
    } else {
      updated.add(filePath);
    }
    setSelectedPaths(updated);
  };

  const handleSelectAll = (filesToSelect: ReadDirItem[]) => {
    if (selectedPaths.size === filesToSelect.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(filesToSelect.map((f) => f.path)));
    }
  };

  const handleBulkShare = async () => {
    if (selectedPaths.size === 0) return;
    const paths = Array.from(selectedPaths);
    await engine.shareFiles(paths);
    setIsSelectionMode(false);
    setSelectedPaths(new Set());
  };

  const handleBulkStar = () => {
    if (selectedPaths.size === 0) return;
    const paths = Array.from(selectedPaths);
    const filesToStar: RecentFile[] = [];
    for (const path of paths) {
      const found = items.find((i) => i.path === path);
      const fileName = found ? found.name : (path.split('/').pop() || 'file');
      const ext = (fileName.split('.').pop() || '').toLowerCase();
      let cat = 'UNKNOWN';
      if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic'].includes(ext)) cat = 'IMAGE';
      else if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) cat = 'VIDEO';
      else if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) cat = 'AUDIO';
      else if (['pdf'].includes(ext)) cat = 'PDF';
      else if (['docx', 'doc', 'txt', 'rtf', 'md'].includes(ext)) cat = 'DOCUMENTS';
      else if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) cat = 'SPREADSHEETS';
      else if (['pptx', 'ppt'].includes(ext)) cat = 'PRESENTATIONS';
      else if (['zip', 'rar', '7z'].includes(ext)) cat = 'ARCHIVES';

      filesToStar.push({
        name: fileName,
        path: path,
        size: found?.size || 0,
        timestamp: Date.now(),
        category: cat,
      });
    }
    if (filesToStar.length > 0) {
      MMKV.toggleStarredBatch(filesToStar);
    }
    setIsSelectionMode(false);
    setSelectedPaths(new Set());
    setStarredTick((t) => t + 1);
    setItems([...items]);
  };

  // Separate folders and files
  const folders = useMemo(() => {
    return items.filter((i) => i.isDirectory() && !i.name.startsWith('.'));
  }, [items]);

  // Real folder items count (no mock data)
  useEffect(() => {
    let cancelled = false;
    folders.forEach(async (f) => {
      try {
        const sub = await RNFS.readDir(f.path);
        if (!cancelled) {
          const count = sub.filter((x) => !x.name.startsWith('.')).length;
          setFolderCounts((prev) => ({ ...prev, [f.path]: count }));
        }
      } catch {
        // Fallback silently if restricted
      }
    });
    return () => {
      cancelled = true;
    };
  }, [folders]);

  const rawFiles = useMemo(() => {
    return items.filter((i) => !i.isDirectory() && !i.name.startsWith('.'));
  }, [items]);

  // Filter files by category and query
  const filteredFiles = useMemo(() => {
    return rawFiles.filter((file) => {
      // Query filter
      if (searchQuery.trim().length > 0) {
        if (!file.name.toLowerCase().includes(searchQuery.toLowerCase().trim())) {
          return false;
        }
      }

      // Category filter
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      switch (selectedFilter) {
        case 'DOCUMENTS':
          return ['pdf', 'docx', 'doc', 'txt', 'rtf'].includes(ext);
        case 'SPREADSHEETS':
          return ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
        case 'PRESENTATIONS':
          return ['pptx', 'ppt'].includes(ext);
        case 'IMAGES':
          return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic'].includes(ext);
        case 'AUDIO':
          return ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext);
        case 'ARCHIVES':
          return ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext);
        case 'ALL':
        default:
          return true;
      }
    });
  }, [rawFiles, searchQuery, selectedFilter]);

  // Sort files
  const sortedFiles = useMemo(() => {
    const list = [...filteredFiles];
    list.sort((a, b) => {
      let comparison = 0;
      if (sortCriteria === 'NAME') {
        comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortCriteria === 'DATE') {
        const timeA = a.mtime ? a.mtime.getTime() : 0;
        const timeB = b.mtime ? b.mtime.getTime() : 0;
        comparison = timeA - timeB;
      } else if (sortCriteria === 'SIZE') {
        comparison = (a.size || 0) - (b.size || 0);
      }
      return sortDirection === 'ASC' ? comparison : -comparison;
    });
    return list;
  }, [filteredFiles, sortCriteria, sortDirection]);

  // Current folder name
  const currentFolderName = breadcrumbSegments[breadcrumbSegments.length - 1]?.label || 'Folder';
  const parentFolderName = breadcrumbSegments.length > 1
    ? breadcrumbSegments[breadcrumbSegments.length - 2].label
    : 'Documents';

  // 1. FIGMA SCREEN 4: PERMISSION DENIED STATE
  if (!permissionState.allFiles && !permissionState.documentsTreeGranted) {
    return (
      <View style={styles.permDeniedContainer}>
        <StatusBar hidden={true} />
        {/* Blue Header with Circle Back and Folder + Browse */}
        <View style={styles.permDeniedHeader}>
          <TouchableOpacity
            style={styles.permDeniedBackBtn}
            activeOpacity={0.7}
            onPress={() => navigation?.goBack?.()}>
            <Text style={styles.permDeniedBackIcon}>&lt;</Text>
          </TouchableOpacity>
          <View style={styles.permDeniedBrandRow}>
            <FolderOutlineIcon size={20} color="#FFFFFF" />
            <Text style={styles.permDeniedTitle}>Browse</Text>
          </View>
        </View>

        {/* White Rounded Sheet with Lock & Buttons */}
        <View style={styles.permDeniedSheet}>
          <View style={styles.permDeniedLockBox}>
            <LockOutlineIcon size={28} color="#016EEF" />
          </View>

          <Text style={styles.permDeniedHeading}>Allow access to your files</Text>
          <Text style={styles.permDeniedSubheading}>
            To browse files on this device, allow access to your files. You can still open a file shared
            from another app without it.
          </Text>

          <TouchableOpacity
            style={styles.permDeniedPrimaryBtn}
            activeOpacity={0.8}
            onPress={async () => {
              await requestAllFilesAccess();
              const perms = await refreshPermissions();
              if (perms.allFiles || perms.documentsTreeGranted) {
                loadDirectory(currentPath);
              }
            }}>
            <Text style={styles.permDeniedPrimaryBtnText}>Allow access</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.permDeniedSecondaryBtn}
            activeOpacity={0.7}
            onPress={() => Linking.openSettings()}>
            <Text style={styles.permDeniedSecondaryBtnText}>Open app settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />

      {/* 2. BLUE HEADER (#016EEF) */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.7}
            onPress={handleNavigateUp}>
            <Text style={styles.backIcon}>&lt;</Text>
          </TouchableOpacity>
          <View style={styles.brandContainer}>
            {!showRecents && <FolderOutlineIcon size={20} color="#FFFFFF" />}
            <Text style={styles.brandTitle}>
              {showRecents
                ? 'Recent Files'
                : breadcrumbSegments.length > 1
                  ? currentFolderName
                  : 'Browse'}
            </Text>
          </View>
        </View>

        {/* WHITE SEARCH PILL (Hidden in Recent Files view, Figma Screen 4) */}
        {!showRecents && (
          <View style={styles.searchBarContainer}>
            <SearchOutlineIcon size={18} color="#016EEF" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search files by name"
              placeholderTextColor="#5B6478"
              value={searchQuery}
              onChangeText={(text) => {
                setSearchQuery(text);
                setSearchError(false);
              }}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.clearSearchPill}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.clearSearchPillText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 3. BREADCRUMBS ROW (Hidden in Recent Files view, Figma Screen 4) */}
        {!showRecents && (
          <View style={styles.breadcrumbsBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.breadcrumbContent}>
              <PhoneOutlineIcon size={14} color="#FFFFFF" />
              {breadcrumbSegments.map((seg, idx) => {
                const isLast = idx === breadcrumbSegments.length - 1;
                return (
                  <React.Fragment key={seg.fullPath}>
                    <TouchableOpacity
                      onPress={() => handleOpenFolder(seg.fullPath)}
                      disabled={isLast}
                      activeOpacity={0.7}>
                      <Text style={[styles.breadcrumbText, isLast && styles.breadcrumbTextActive]}>
                        {seg.label}
                      </Text>
                    </TouchableOpacity>
                    {!isLast && <Text style={styles.breadcrumbSeparator}>&gt;</Text>}
                  </React.Fragment>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* 4. CATEGORY FILTER TABS (Figma Screen 5 & 9) */}
        <View style={styles.categoryTabsBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryTabsContent}>
            {(
              [
                { key: 'ALL', label: 'All files' },
                { key: 'DOCUMENTS', label: 'Documents' },
                { key: 'SPREADSHEETS', label: 'Spreadsheets' },
                { key: 'PRESENTATIONS', label: 'Presentations' },
                { key: 'IMAGES', label: 'Images' },
                { key: 'AUDIO', label: 'Audio' },
                { key: 'ARCHIVES', label: 'Archives' },
              ] as const
            ).map((tab) => {
              const isActive = selectedFilter === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.categoryTabChip, isActive && styles.categoryTabChipActive]}
                  activeOpacity={0.75}
                  onPress={() => setSelectedFilter(tab.key)}>
                  <Text style={[styles.categoryTabChipText, isActive && styles.categoryTabChipTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* WHITE CONTENT SHEET (Figma rounded overlapping card) */}
      <View style={styles.sheetContainer}>
        {/* 5. TOP BAR INSIDE SHEET: SELECTION MODE (Figma Screen 10) vs COUNT & SORT (Figma Screen 9) */}
        {isSelectionMode ? (
          <View style={styles.selectionTopBar}>
            <View style={styles.selectionTopLeft}>
              <TouchableOpacity
                style={styles.cancelSelectionBtn}
                activeOpacity={0.7}
                onPress={() => {
                  setIsSelectionMode(false);
                  setSelectedPaths(new Set());
                }}>
                <Text style={styles.cancelSelectionIcon}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.selectionCountText}>{selectedPaths.size} selected</Text>
            </View>

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => handleSelectAll(sortedFiles)}>
              <Text style={styles.selectAllText}>
                {selectedPaths.size === sortedFiles.length ? 'Deselect all' : 'Select all'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.countAndSortBar}>
            <Text style={styles.itemCountText}>
              {searchQuery.trim().length > 0
                ? `${sortedFiles.length} ${sortedFiles.length === 1 ? 'result' : 'results'}`
                : showRecents
                  ? `${sortedFiles.length} ${sortedFiles.length === 1 ? 'file' : 'files'}`
                  : selectedFilter === 'ALL'
                    ? `${sortedFiles.length + (searchQuery ? 0 : folders.length)} items`
                    : `${sortedFiles.length} ${selectedFilter.toLowerCase()}`}
            </Text>

            <TouchableOpacity
              style={styles.sortDropdownBtn}
              activeOpacity={0.7}
              onPress={() => setIsSortSheetVisible(true)}>
              <Text style={styles.sortDropdownText}>
                ⇅ Sort: {sortCriteria === 'NAME' ? 'Name' : sortCriteria === 'DATE' ? 'Date' : 'Size'} ▾
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* MAIN CONTENT AREA */}
        {isLoading ? (
          /* FIGMA SCREEN 7: BROWSE — LOADING */
          <View style={styles.loadingContainer}>
            {/* 3px blue progress bar at top of sheet */}
            <View style={styles.loadingProgressTrack}>
              <Animated.View
                style={[
                  styles.loadingProgressFill,
                  {
                    left: progressAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['-35%', '100%'],
                    }),
                  },
                ]}
              />
            </View>

            <Text style={styles.loadingStatusText}>Looking for files on this device...</Text>

            {/* 6 Skeleton items matching Figma */}
            <View style={styles.skeletonList}>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <View key={i} style={styles.skeletonRow}>
                  <View style={styles.skeletonBadge} />
                  <View style={styles.skeletonContent}>
                    <View style={[styles.skeletonLineLong, { width: i % 2 === 0 ? '62%' : '48%' }]} />
                    <View style={styles.skeletonLineShort} />
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>

            {/* FIGMA SCREEN 3: SEARCH — ERROR */}
            {searchError ? (
              <View style={styles.searchEmptyCenterBox}>
                <View style={styles.searchEmptyIconCircle}>
                  <WarningTriangleIcon size={26} color="#016EEF" />
                </View>
                <Text style={styles.searchEmptyTitle}>Search couldn't finish</Text>
                <Text style={styles.searchEmptySub}>
                  Something went wrong while looking through your files. Your files haven't changed.
                </Text>
                <TouchableOpacity
                  style={styles.searchTryAgainBtn}
                  activeOpacity={0.8}
                  onPress={() => loadDirectory(currentPath)}>
                  <Text style={styles.searchTryAgainBtnText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : searchQuery.trim().length > 0 && sortedFiles.length === 0 ? (
              /* FIGMA SCREEN 2: SEARCH — NO RESULTS */
              <View style={styles.searchEmptyCenterBox}>
                <View style={styles.searchEmptyIconCircle}>
                  <SearchOutlineIcon size={24} color="#016EEF" />
                </View>
                <Text style={styles.searchEmptyTitle}>No results for "{searchQuery}"</Text>
                <Text style={styles.searchEmptySub}>
                  Check the spelling, or try a different file type.
                </Text>
                <TouchableOpacity
                  style={styles.searchClearBtn}
                  activeOpacity={0.8}
                  onPress={() => setSearchQuery('')}>
                  <Text style={styles.searchClearBtnText}>Clear search</Text>
                </TouchableOpacity>
              </View>
            ) : folders.length === 0 && rawFiles.length === 0 && !showRecents ? (
              /* EMPTY FOLDER STATE (Figma Screen 6: Browse — empty folder) */
              <View style={styles.emptyFolderCenterBox}>
                <EmptyFolderDashedIcon size={64} color="#CBD5E1" />
                <Text style={styles.emptyFolderTitle}>This folder is empty</Text>
                <Text style={styles.emptyFolderSub}>
                  Files saved to {currentFolderName} will appear here.
                </Text>

                <TouchableOpacity
                  style={styles.backToParentBtn}
                  activeOpacity={0.8}
                  onPress={handleNavigateUp}>
                  <Text style={styles.backToParentBtnText}>&lt; Back to {parentFolderName}</Text>
                </TouchableOpacity>
              </View>
            ) : sortedFiles.length === 0 ? (
              /* NO FILES IN CATEGORY (Figma Screen 8: Browse — no files in category) */
              <View style={styles.emptyCategoryCenterBox}>
                <View style={styles.emptyCategoryIconBox}>
                  {selectedFilter === 'AUDIO' ? (
                    <AudioNoteIcon size={26} color="#016EEF" />
                  ) : (
                    <Text style={styles.emptyCategoryIconEmoji}>
                      {selectedFilter === 'IMAGES'
                        ? '🖼️'
                        : selectedFilter === 'SPREADSHEETS'
                          ? '📊'
                          : selectedFilter === 'PRESENTATIONS'
                            ? '📽️'
                            : selectedFilter === 'ARCHIVES'
                              ? '📦'
                              : '📄'}
                    </Text>
                  )}
                </View>
                <Text style={styles.emptyCategoryTitle}>
                  No {selectedFilter.toLowerCase()} files found
                </Text>
                <Text style={styles.emptyCategorySub}>
                  {selectedFilter.charAt(0) + selectedFilter.slice(1).toLowerCase()} files on this device
                  will appear here.
                </Text>

                <TouchableOpacity
                  style={styles.showAllFilesBtn}
                  activeOpacity={0.8}
                  onPress={() => setSelectedFilter('ALL')}>
                  <Text style={styles.showAllFilesBtnText}>Show all files</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* FIGMA SCREEN 5: BROWSE (Populated State) */
              <>
                {/* Folders Section with 2-Column Cards */}
                {folders.length > 0 && selectedFilter === 'ALL' && !searchQuery && (
                  <View style={styles.foldersSection}>
                    <Text style={styles.sectionSubtitle}>Folders</Text>
                    <View style={styles.foldersGrid}>
                      {folders.map((folder) => (
                        <TouchableOpacity
                          key={folder.path}
                          style={styles.folderCard}
                          activeOpacity={0.75}
                          onPress={() => handleOpenFolder(folder.path)}>
                          <View style={styles.folderCardTopRow}>
                            <FolderOutlineIcon size={18} color="#016EEF" />
                            <Text style={styles.folderCardChevron}>&gt;</Text>
                          </View>
                          <View style={styles.folderCardTextBox}>
                            <Text style={styles.folderCardName} numberOfLines={1}>
                              {folder.name}/
                            </Text>
                            <Text style={styles.folderCardCount}>
                              {folderCounts[folder.path] !== undefined ? `${folderCounts[folder.path]} items` : '...'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                {/* Files Section */}
                <View style={styles.filesSection}>
                  {folders.length > 0 && selectedFilter === 'ALL' && !searchQuery && (
                    <Text style={styles.sectionSubtitle}>Files</Text>
                  )}
                  <View style={styles.filesCardContainer}>
                    {sortedFiles.map((file, idx, arr) => {
                      const badge = getBadgeForFile(file.name);
                      const isStarred = starredTick >= 0 && MMKV.isStarred(file.path);
                      const isSelected = selectedPaths.has(file.path);
                      const isLast = idx === arr.length - 1;

                      return (
                        <View
                          key={file.path}
                          style={[
                            styles.fileRow,
                            !isLast && styles.fileRowDivider,
                            isSelected && styles.fileRowSelected,
                          ]}>
                          {/* Selection Checkbox (Figma Screen 10) */}
                          {isSelectionMode && (
                            <TouchableOpacity
                              style={styles.checkboxTouchBox}
                              activeOpacity={0.7}
                              onPress={() => handleToggleSelect(file.path)}>
                              <SelectionCheckbox selected={isSelected} size={20} />
                            </TouchableOpacity>
                          )}

                          {/* File Content Touch Area */}
                          <TouchableOpacity
                            style={styles.fileRowContent}
                            activeOpacity={0.7}
                            onPress={() => {
                              if (isSelectionMode) {
                                handleToggleSelect(file.path);
                              } else {
                                handleOpenFile(file);
                              }
                            }}
                            onLongPress={() => {
                              if (!isSelectionMode) {
                                setIsSelectionMode(true);
                                setSelectedPaths(new Set([file.path]));
                              }
                            }}>
                            {/* Format Badge (Figma 40x48 Document Card) */}
                            <DocumentFileBadgeIcon
                              label={badge.label}
                              badgeBg={badge.bg}
                              badgeText={badge.text}
                              width={40}
                              height={48}
                            />

                            {/* File Info */}
                            <View style={styles.fileMetaBox}>
                              <Text style={styles.fileNameText} numberOfLines={1}>
                                {file.name}
                              </Text>
                              <Text style={styles.fileSubText}>
                                {showRecents
                                  ? `${badge.label} · ${formatOpenedTime(file.mtime ? file.mtime.getTime() : undefined)}`
                                  : searchQuery.trim().length > 0
                                    ? `${badge.label} · ${formatBytes(file.size)} · ${breadcrumbSegments.map((s) => s.label).join('/')}`
                                    : `${badge.label} • ${formatBytes(file.size)} • ${formatRelativeTime(file.mtime)}`}
                              </Text>
                            </View>

                            {/* Star Icon if starred */}
                            {isStarred && <Text style={styles.starredStar}>★</Text>}
                          </TouchableOpacity>

                          {/* 3-Dot Menu Button (Figma Screen 12) */}
                          {!isSelectionMode && (
                            <TouchableOpacity
                              style={styles.moreActionBtn}
                              activeOpacity={0.7}
                              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                              onPress={() =>
                                setActionMenuFile({
                                  name: file.name,
                                  path: file.path,
                                  size: file.size || 0,
                                  lastModified: file.mtime ? file.mtime.getTime() : undefined,
                                  category: 'UNKNOWN',
                                  isStarred,
                                })
                              }>
                              <Text style={styles.moreActionDots}>⋮</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              </>
            )}

            <View style={{ height: 100 }} />
          </ScrollView>
        )}
      </View>

      {/* 6. BOTTOM DOCKED BAR IN SELECTION MODE (Figma Screen 10) */}
      {isSelectionMode && (
        <View style={styles.selectionBottomDock}>
          <TouchableOpacity
            style={styles.selectionDockBtn}
            activeOpacity={0.7}
            onPress={handleBulkShare}>
            <ShareVectorIcon size={20} color="#016EEF" />
            <Text style={styles.selectionDockText}>
              {selectedPaths.size > 1 ? `Share (${selectedPaths.size})` : 'Share'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.selectionDockBtn}
            activeOpacity={0.7}
            onPress={handleBulkStar}>
            <StarOutlineIcon size={20} color="#016EEF" />
            <Text style={styles.selectionDockText}>
              {selectedPaths.size > 0 && MMKV.areAllStarred(Array.from(selectedPaths))
                ? 'Unfavourite'
                : 'Favourite'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 7. FIGMA SORT BOTTOM SHEET (Figma Screen 11) */}
      <SortBottomSheet
        visible={isSortSheetVisible}
        criteria={sortCriteria}
        direction={sortDirection}
        onSelectCriteria={(c) => setSortCriteria(c)}
        onSelectDirection={(d) => setSortDirection(d)}
        onClose={() => setIsSortSheetVisible(false)}
      />

      {/* 8. FIGMA ACTION MENU MODAL (Figma Screen 12) */}
      <FileActionMenuModal
        visible={actionMenuFile !== null}
        file={actionMenuFile}
        onClose={() => setActionMenuFile(null)}
        onOpen={(f) => {
          const found = items.find((i) => i.path === f.path);
          if (found) handleOpenFile(found);
        }}
        onShare={(f) => engine.shareFile(f.path)}
        onToggleStar={(f) => handleToggleStar(f)}
        onFileInfo={(f) => {
          setInfoModalFile({
            name: f.name,
            path: f.path,
            size: f.size,
            lastModified: f.lastModified,
            category: f.category,
          });
        }}
      />

      {/* 9. FIGMA FILE INFORMATION MODAL (Figma Screen 16) */}
      <FileInformationModal
        visible={infoModalFile !== null}
        file={infoModalFile}
        onClose={() => setInfoModalFile(null)}
        onOpen={(f) => {
          const found = items.find((i) => i.path === f.path);
          if (found) handleOpenFile(found);
        }}
        onShare={(f) => engine.shareFile(f.path)}
      />

      {/* 10. DOCUMENT & MEDIA VIEWERS */}
      <Modal
        visible={activeViewer !== null}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => setActiveViewer(null)}>
        {activeViewer && (
          <View style={styles.viewerWrapper}>
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
            {activeViewer.category === 'OFFICE_XLSX' && (
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
            {activeViewer.category === 'IMAGE' && (
              <ImageViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}
            {(activeViewer.category === 'VIDEO' || activeViewer.category === 'AUDIO') && (
              <MediaViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                category={activeViewer.category as 'VIDEO' | 'AUDIO'}
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
            {activeViewer.category === 'UNSUPPORTED' && (
              <UnsupportedFileScreen
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => setActiveViewer(null)}
              />
            )}
          </View>
        )}
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FigmaTheme.colors.background,
  },
  viewerWrapper: {
    flex: 1,
    backgroundColor: '#016EEF',
    paddingTop: 0,
  },

  // 1. Blue Header (#016EEF)
  header: {
    backgroundColor: '#016EEF',
    paddingTop: 12,
    paddingBottom: 0,
    paddingHorizontal: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 14,
  },
  backBtn: {
    width: 34,
    height: 42,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backIcon: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: -2,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    fontSize: 20,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Search Bar (White pill with bright blue icon)
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    paddingHorizontal: 20,
    height: 50,
    marginBottom: 14,
    ...FigmaTheme.shadows.card,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
    color: '#016EEF',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
    paddingVertical: 0,
    marginLeft: 14,
  },
  clearSearchIcon: {
    fontSize: 13,
    color: '#64748B',
    padding: 4,
  },
  clearSearchPill: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearSearchPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748B',
    marginTop: -1,
  },

  // Search Empty & Error States (Figma Screen 2 & Screen 3)
  searchEmptyCenterBox: {
    paddingVertical: 56,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchEmptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  searchEmptySub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
    marginBottom: 20,
  },
  searchClearBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#016EEF',
    backgroundColor: '#FFFFFF',
  },
  searchClearBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#016EEF',
  },
  searchTryAgainBtn: {
    paddingHorizontal: 28,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#016EEF',
  },
  searchTryAgainBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Selection Mode Top Bar (inside white sheet, Figma Screen 10)
  selectionTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  selectionTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cancelSelectionBtn: {
    padding: 4,
  },
  cancelSelectionIcon: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  selectionCountText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  selectAllText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#016EEF',
  },
  checkboxTouchBox: {
    paddingRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Breadcrumbs Bar (inside blue header)
  breadcrumbsBar: {
    backgroundColor: 'transparent',
    paddingVertical: 0,
    marginBottom: 12,
  },
  breadcrumbContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breadcrumbRootIcon: {
    fontSize: 13,
    color: '#FFFFFF',
    marginRight: 4,
  },
  breadcrumbText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.90)',
  },
  breadcrumbTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  breadcrumbSeparator: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.65)',
  },

  // Category Filter Tabs (inside blue header)
  categoryTabsBar: {
    backgroundColor: 'transparent',
    paddingTop: 4,
    paddingBottom: 0,
  },
  categoryTabsContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingBottom: 0,
  },
  categoryTabChip: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.20)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  categoryTabChipActive: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    height: 40,
    marginBottom: 0,
    paddingBottom: 2,
  },
  categoryTabChipText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  categoryTabChipTextActive: {
    color: '#016EEF',
    fontWeight: '700',
  },

  // Overlapping White Content Sheet (Figma Screen 5)
  sheetContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 0,
    borderTopRightRadius: 20,
    marginTop: 0,
    overflow: 'hidden',
  },

  // Count & Sort Bar
  countAndSortBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  itemCountText: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.textSecondary,
  },
  sortDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortDropdownText: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  // Scroll Content
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
  },

  // Section Subtitles (Folders & Files)
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  foldersSection: {
    marginBottom: 12,
  },
  foldersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  folderCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  folderCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  folderCardChevron: {
    fontSize: 14,
    fontWeight: '700',
    color: '#016EEF',
  },
  folderCardTextBox: {
    marginTop: 10,
  },
  folderCardName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  folderCardCount: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  filesSection: {
    gap: 8,
  },

  // Files List Card (Figma Screen 5 & 9)
  filesCardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    overflow: 'hidden',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  fileRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: FigmaTheme.colors.divider,
  },
  fileRowSelected: {
    backgroundColor: FigmaTheme.colors.primaryLight,
  },
  checkboxBox: {
    paddingRight: 10,
  },
  checkboxCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: FigmaTheme.colors.cardBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxCircleSelected: {
    backgroundColor: FigmaTheme.colors.primary,
    borderColor: FigmaTheme.colors.primary,
  },
  checkboxCheck: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  fileRowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  fileMetaBox: {
    flex: 1,
    marginLeft: 12,
  },
  fileNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 3,
  },
  fileSubText: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
  },
  starredStar: {
    fontSize: 16,
    color: '#F59E0B',
    marginLeft: 6,
  },
  moreActionBtn: {
    padding: 8,
  },
  moreActionDots: {
    fontSize: 18,
    fontWeight: '800',
    color: FigmaTheme.colors.textSecondary,
  },

  // Figma Screen 6: Browse — empty folder
  emptyFolderCenterBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingBottom: 60,
    paddingHorizontal: 24,
  },
  emptyFolderTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 18,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyFolderSub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
  },
  backToParentBtn: {
    backgroundColor: '#016EEF',
    paddingHorizontal: 24,
    height: 42,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backToParentBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Figma Screen 8: Browse — no files in category
  emptyCategoryCenterBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingBottom: 60,
    paddingHorizontal: 24,
  },
  emptyCategoryIconBox: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyCategoryIconEmoji: {
    fontSize: 26,
  },
  emptyCategoryTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyCategorySub: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
  },
  showAllFilesBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#016EEF',
    paddingHorizontal: 24,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  showAllFilesBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#016EEF',
  },

  // Figma Screen 7: Browse — loading
  loadingContainer: {
    flex: 1,
  },
  loadingProgressTrack: {
    height: 3,
    width: '100%',
    backgroundColor: '#E2E8F0',
    position: 'relative',
    overflow: 'hidden',
  },
  loadingProgressFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 100,
    backgroundColor: '#016EEF',
  },
  loadingStatusText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  skeletonList: {
    paddingHorizontal: 16,
    gap: 16,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeletonBadge: {
    width: 40,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  skeletonContent: {
    flex: 1,
    marginLeft: 14,
    gap: 8,
  },
  skeletonLineLong: {
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
  },
  skeletonLineShort: {
    width: '32%',
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F1F5F9',
  },

  // Permission Denied View (Figma Screen 4)
  permDeniedContainer: {
    flex: 1,
    backgroundColor: '#016EEF',
  },
  permDeniedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
    gap: 14,
  },
  permDeniedBackBtn: {
    width: 34,
    height: 42,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permDeniedBackIcon: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginTop: -2,
  },
  permDeniedBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  permDeniedTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  permDeniedSheet: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  permDeniedLockBox: {
    width: 68,
    height: 68,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  permDeniedHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  permDeniedSubheading: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    maxWidth: 290,
  },
  permDeniedPrimaryBtn: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: '#016EEF',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  permDeniedPrimaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  permDeniedSecondaryBtn: {
    width: '100%',
    maxWidth: 280,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#016EEF',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
  },
  permDeniedSecondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#016EEF',
  },

  // Selection Bottom Dock (Figma Screen 10)
  selectionBottomDock: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 60,
  },
  selectionDockBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 36,
  },
  selectionDockText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#016EEF',
  },

  centerStatusBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  centerStatusText: {
    fontSize: 14,
    color: FigmaTheme.colors.textSecondary,
  },
});

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
  StatusBar,
} from 'react-native';
import { MMKV, RecentFile } from '../services/MMKV';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { FileDetector } from '../services/FileDetector';
import { FileDetailsModal, FileDetailsItem } from '../components/FileDetailsModal';
import { StorageService, DashboardCounts, StorageUsage } from '../services/StorageService';
import { usePermissions } from '../hooks/usePermissions';

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

interface HomeScreenProps {
  navigation?: {
    navigate: (screen: string, params?: any) => void;
  };
  initialCategory?: string;
}

interface CategoryItem {
  id: string;
  name: string;
  badgeLabel: string;
  badgeColor: string;
  badgeTextColor: string;
  isBadgeIcon?: boolean;
  countKey: keyof DashboardCounts;
  extensions: string[];
}

const CATEGORIES: CategoryItem[] = [
  {
    id: 'PDF',
    name: 'PDF',
    badgeLabel: 'PDF',
    badgeColor: '#ef4444',
    badgeTextColor: '#ffffff',
    countKey: 'pdf',
    extensions: ['pdf'],
  },
  {
    id: 'WORD',
    name: 'Word',
    badgeLabel: 'W',
    badgeColor: '#2563eb',
    badgeTextColor: '#ffffff',
    countKey: 'word',
    extensions: ['docx', 'doc', 'txt', 'rtf'],
  },
  {
    id: 'EXCEL',
    name: 'Excel',
    badgeLabel: 'X',
    badgeColor: '#10b981',
    badgeTextColor: '#ffffff',
    countKey: 'excel',
    extensions: ['xlsx', 'xls', 'csv', 'tsv'],
  },
  {
    id: 'PPT',
    name: 'PowerPoint',
    badgeLabel: 'P',
    badgeColor: '#f97316',
    badgeTextColor: '#ffffff',
    countKey: 'pptx',
    extensions: ['pptx', 'ppt'],
  },
  {
    id: 'ARCHIVE',
    name: 'ZIP • RAR',
    badgeLabel: 'ZIP',
    badgeColor: '#8b5cf6',
    badgeTextColor: '#ffffff',
    countKey: 'archive',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz'],
  },
  {
    id: 'AUDIO',
    name: 'Audio',
    badgeLabel: '🎵',
    badgeColor: '#a855f7',
    badgeTextColor: '#ffffff',
    isBadgeIcon: true,
    countKey: 'audio',
    extensions: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'],
  },
  {
    id: 'VIDEO',
    name: 'Video',
    badgeLabel: '▶',
    badgeColor: '#f43f5e',
    badgeTextColor: '#ffffff',
    isBadgeIcon: true,
    countKey: 'video',
    extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'],
  },
  {
    id: 'IMAGE',
    name: 'Images',
    badgeLabel: '🖼️',
    badgeColor: '#14b8a6',
    badgeTextColor: '#ffffff',
    isBadgeIcon: true,
    countKey: 'image',
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif'],
  },
];

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation, initialCategory }) => {
  const { permissionState, requestMediaPermissions, requestDocumentsTree } = usePermissions();

  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [starredFiles, setStarredFiles] = useState<RecentFile[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearchVisible, setIsSearchVisible] = useState<boolean>(false);
  const [continueFiles, setContinueFiles] = useState<Array<RecentFile & { pos: any }>>([]);

  // Storage Dashboard
  const [dashboardCounts, setDashboardCounts] = useState<DashboardCounts | null>(() =>
    StorageService.getInstance().getCachedDashboardCounts()
  );
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [isScanningDashboard, setIsScanningDashboard] = useState<boolean>(false);

  // Modals & Details
  const [selectedDetailFile, setSelectedDetailFile] = useState<FileDetailsItem | null>(null);
  const [categoryFiles, setCategoryFiles] = useState<any[]>([]);
  const [isLoadingCategoryFiles, setIsLoadingCategoryFiles] = useState<boolean>(false);
  const [isPermissionBannerDismissed, setIsPermissionBannerDismissed] = useState<boolean>(false);
  const [isCleanModalVisible, setIsCleanModalVisible] = useState<boolean>(false);
  const [cleanedAmount, setCleanedAmount] = useState<string>('');
  const [isCleaning, setIsCleaning] = useState<boolean>(false);

  // Active viewer modal
  const [activeViewer, setActiveViewer] = useState<{
    file: string;
    path: string;
    category: string;
    formatType?: any;
  } | null>(null);

  const engine = ArchiveEngine.getInstance();
  const storageService = StorageService.getInstance();

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatRelativeTime = (timestamp?: number): string => {
    if (!timestamp) return 'Recently';
    const now = Date.now();
    const diffSec = Math.floor((now - timestamp) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const getBadgeForFile = (category?: string, fileName?: string) => {
    const ext = (fileName?.split('.').pop() || '').toLowerCase();
    if (category === 'PDF' || ext === 'pdf') {
      return { label: 'PDF', bg: '#ef4444', isIcon: false };
    }
    if (
      category === 'OFFICE_DOCX' ||
      category === 'LEGACY_OLE_DOC' ||
      ['docx', 'doc', 'txt', 'rtf'].includes(ext)
    ) {
      return { label: 'W', bg: '#2563eb', isIcon: false };
    }
    if (
      category === 'OFFICE_XLSX' ||
      category === 'LEGACY_OLE_XLS' ||
      category === 'SPREADSHEET_CSV' ||
      ['xlsx', 'xls', 'csv', 'tsv'].includes(ext)
    ) {
      return { label: 'X', bg: '#10b981', isIcon: false };
    }
    if (
      category === 'OFFICE_PPTX' ||
      category === 'LEGACY_OLE_PPT' ||
      ['pptx', 'ppt'].includes(ext)
    ) {
      return { label: 'P', bg: '#f97316', isIcon: false };
    }
    if (
      category === 'ARCHIVE_ZIP' ||
      category === 'ARCHIVE_RAR' ||
      ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)
    ) {
      return { label: 'ZIP', bg: '#8b5cf6', isIcon: false };
    }
    if (category === 'AUDIO' || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'].includes(ext)) {
      return { label: '🎵', bg: '#a855f7', isIcon: true };
    }
    if (category === 'VIDEO' || ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
      return { label: '▶', bg: '#f43f5e', isIcon: true };
    }
    if (category === 'IMAGE' || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) {
      return { label: '🖼️', bg: '#14b8a6', isIcon: true };
    }
    return { label: 'DOC', bg: '#64748b', isIcon: false };
  };

  const loadData = useCallback(() => {
    setRecentFiles(MMKV.getRecentFiles());
    setStarredFiles(MMKV.getStarredFiles());
    setContinueFiles(MMKV.getContinueReadingFiles());
  }, []);

  const loadStorageData = useCallback(async () => {
    setIsScanningDashboard(true);
    try {
      const [counts, usage] = await Promise.all([
        storageService.getStorageDashboardCounts(),
        storageService.getStorageUsage(),
      ]);
      setDashboardCounts(counts);
      setStorageUsage(usage);
    } catch (err) {
      console.warn('loadStorageData error', err);
    } finally {
      setIsScanningDashboard(false);
    }
  }, [storageService]);

  useEffect(() => {
    loadData();
    loadStorageData();
  }, [loadData, loadStorageData]);

  // When a specific category is selected, query device files
  useEffect(() => {
    if (selectedCategory !== 'ALL' && selectedCategory !== 'STARRED') {
      setIsLoadingCategoryFiles(true);
      storageService
        .queryCategoryFiles(selectedCategory, 0, 100)
        .then((files) => {
          setCategoryFiles(files);
        })
        .catch((err) => {
          console.warn('queryCategoryFiles error', err);
          setCategoryFiles([]);
        })
        .finally(() => {
          setIsLoadingCategoryFiles(false);
        });
    } else {
      setCategoryFiles([]);
    }
  }, [selectedCategory, storageService]);

  const handleRecentTap = async (recent: RecentFile) => {
    try {
      let targetPath = recent.path;
      if (targetPath.startsWith('content://')) {
        const resolved = await storageService.resolveToLocalFile(targetPath);
        targetPath = resolved.localPath;
      }
      const detected = await FileDetector.detectFile(targetPath, recent.name);
      MMKV.addRecentFile({
        ...recent,
        path: targetPath,
        timestamp: Date.now(),
        category: detected.category,
      });
      loadData();
      openMatchingViewer(recent.name, targetPath, detected.category);
    } catch {
      openMatchingViewer(recent.name, recent.path, recent.category || 'UNKNOWN');
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
    loadData();
  };

  const handleClearRecents = () => {
    MMKV.clearRecentFiles();
    loadData();
  };

  const handleCleanUpStorage = async () => {
    setIsCleaning(true);
    try {
      const res = await engine.cleanTemporaryCache();
      const freed = res.freedBytes;
      if (freed > 0) {
        setCleanedAmount(`Freed ${formatBytes(freed)} of temporary files`);
      } else {
        setCleanedAmount('Cache is already clean and optimal (0 B)');
      }
      setIsCleanModalVisible(true);
      loadStorageData();
    } catch {
      setCleanedAmount('Cache optimized');
      setIsCleanModalVisible(true);
    } finally {
      setIsCleaning(false);
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
    if (
      ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic', 'heif', 'avif'].includes(ext) ||
      category === 'IMAGE'
    ) {
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

  // Files to display in Recent/Category section
  const displayedFiles = useMemo(() => {
    let baseList: RecentFile[] = selectedCategory === 'STARRED' ? starredFiles : recentFiles;

    if (selectedCategory !== 'ALL' && selectedCategory !== 'STARRED') {
      if (categoryFiles.length > 0) {
        baseList = categoryFiles.map((cf) => ({
          name: cf.name,
          path: cf.uri,
          size: cf.size,
          timestamp: cf.modified,
          category: cf.category,
          mimeType: cf.mime,
        }));
      } else {
        const cat = CATEGORIES.find((c) => c.id === selectedCategory);
        if (cat) {
          baseList = recentFiles.filter((f) => {
            const ext = (f.name.split('.').pop() || '').toLowerCase();
            return cat.extensions.includes(ext);
          });
        }
      }
    }

    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      baseList = baseList.filter((f) => f.name.toLowerCase().includes(q));
    }

    return baseList;
  }, [recentFiles, starredFiles, selectedCategory, searchQuery, categoryFiles]);

  // Real storage numbers from device (zero mock data)
  const usedGB = storageUsage && storageUsage.totalBytes > 0
    ? (storageUsage.usedBytes / (1024 * 1024 * 1024)).toFixed(0)
    : '0';
  const totalGB = storageUsage && storageUsage.totalBytes > 0
    ? (storageUsage.totalBytes / (1024 * 1024 * 1024)).toFixed(0)
    : '0';
  const freeGB = storageUsage && storageUsage.totalBytes > 0
    ? (storageUsage.freeBytes / (1024 * 1024 * 1024)).toFixed(0)
    : '0';
  const progressPercent = storageUsage && storageUsage.totalBytes > 0
    ? Math.min(100, Math.round((storageUsage.usedBytes / storageUsage.totalBytes) * 100))
    : 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />

      {/* 1. Header Bar: App Title + Search & Profile Avatar */}
      <View style={styles.topHeader}>
        <Text style={styles.appTitle}>Universal File Viewer</Text>
        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setIsSearchVisible((prev) => !prev)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.headerSearchIcon}>🔍</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Expandable Instant Search Bar */}
      {(isSearchVisible || searchQuery.length > 0) && (
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search documents, sheets, media..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus={isSearchVisible && searchQuery.length === 0}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.clearSearchIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Storage Used Elevated Card */}
      <View style={styles.storageCard}>
        <View style={styles.storageTopRow}>
          <View style={styles.storageIconBox}>
            <Text style={styles.storageIcon}>📰</Text>
          </View>
          <View style={styles.storageTextBox}>
            <Text style={styles.storageLabel}>Storage Used</Text>
            <Text style={styles.storageUsedValue}>
              {usedGB} GB of {totalGB} GB used
            </Text>
          </View>
        </View>

        {/* Progress Bar */}
        <View style={styles.storageProgressTrack}>
          <View style={[styles.storageProgressFill, { width: `${progressPercent}%` }]} />
        </View>

        {/* Action Link */}
        <TouchableOpacity
          onPress={handleCleanUpStorage}
          disabled={isCleaning}
          activeOpacity={0.7}
          style={styles.cleanupRow}>
          <Text style={styles.cleanupText}>
            {freeGB} GB free • <Text style={styles.cleanupAction}>Tap to clean up &gt;</Text>
          </Text>
        </TouchableOpacity>
      </View>

      {/* Permission Recommendation Banner (if needed) */}
      {!isPermissionBannerDismissed &&
        (permissionState.media !== 'granted' || !permissionState.documentsTreeGranted) && (
          <View style={styles.permissionCard}>
            <View style={styles.permissionHeader}>
              <Text style={styles.permissionIcon}>🛡️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.permissionTitle}>Full Storage Access Recommended</Text>
                <Text style={styles.permissionDesc}>
                  Grant access to Documents & Media so Universal File Viewer can discover all office files
                  and archives across your device.
                </Text>
              </View>
              <TouchableOpacity onPress={() => setIsPermissionBannerDismissed(true)}>
                <Text style={styles.dismissText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.permissionBtnRow}>
              {permissionState.media !== 'granted' && (
                <TouchableOpacity style={styles.permActionBtn} onPress={requestMediaPermissions}>
                  <Text style={styles.permActionBtnText}>Grant Media</Text>
                </TouchableOpacity>
              )}
              {!permissionState.documentsTreeGranted && (
                <TouchableOpacity
                  style={[styles.permActionBtn, { backgroundColor: '#10b981' }]}
                  onPress={requestDocumentsTree}>
                  <Text style={styles.permActionBtnText}>Select Documents Folder</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

      {/* 4. Categories Section (2-Column Grid of 8 Cards) */}
      <View style={styles.categoriesSection}>
        <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.sectionTitle}>Categories</Text>
            {isScanningDashboard && <ActivityIndicator color="#2563eb" size="small" />}
          </View>
          {selectedCategory !== 'ALL' && (
            <TouchableOpacity onPress={() => setSelectedCategory('ALL')}>
              <Text style={styles.resetFilterText}>Show All</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.categoriesGrid}>
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            const fileCount =
              dashboardCounts && dashboardCounts[cat.countKey]
                ? dashboardCounts[cat.countKey].count
                : 0;

            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryCard,
                  isSelected && styles.categoryCardSelected,
                ]}
                onPress={() => setSelectedCategory(isSelected ? 'ALL' : cat.id)}
                activeOpacity={0.75}>
                {/* Square Icon Badge */}
                <View
                  style={[
                    styles.categoryBadge,
                    { backgroundColor: cat.badgeColor },
                  ]}>
                  <Text
                    style={[
                      styles.categoryBadgeText,
                      cat.isBadgeIcon && styles.categoryBadgeIconText,
                    ]}>
                    {cat.badgeLabel}
                  </Text>
                </View>

                {/* Name & Count */}
                <View style={styles.categoryInfo}>
                  <Text style={styles.categoryName} numberOfLines={1}>
                    {cat.name}
                  </Text>
                  <Text style={styles.categoryCount}>
                    {fileCount} files
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 4.5 Continue Reading (if any) */}
      {continueFiles.length > 0 && selectedCategory === 'ALL' && !searchQuery && (
        <View style={styles.continueSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Continue Reading</Text>
            <Text style={styles.continueSub}>Pick up where you left off</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.continueScroll}>
            {continueFiles.map((item) => {
              const badgeInfo = getBadgeForFile(item.category, item.name);
              return (
                <TouchableOpacity
                  key={`continue-${item.path}`}
                  style={styles.continueCard}
                  onPress={() => openMatchingViewer(item.name, item.path, item.category)}
                  activeOpacity={0.8}>
                  <View style={styles.continueCardHeader}>
                    <View style={[styles.miniBadge, { backgroundColor: badgeInfo.bg }]}>
                      <Text style={styles.miniBadgeText}>{badgeInfo.label}</Text>
                    </View>
                    <Text style={styles.continueProgress}>Resume</Text>
                  </View>
                  <Text style={styles.continueFileName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <View style={styles.continueFooter}>
                    <Text style={styles.continueResumeText}>Open ➔</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 5. Recent Files Section (Card Container) */}
      <View style={styles.recentSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            {selectedCategory === 'STARRED'
              ? 'Starred files'
              : selectedCategory !== 'ALL'
              ? `${selectedCategory} files`
              : 'Recent files'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {recentFiles.length > 0 && selectedCategory === 'ALL' && (
              <TouchableOpacity onPress={handleClearRecents} activeOpacity={0.7}>
                <Text style={styles.clearRecentsText}>Clear</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => navigation?.navigate('FolderBrowser')}
              activeOpacity={0.7}>
              <Text style={styles.seeAllText}>See all &gt;</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isLoadingCategoryFiles ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#2563eb" size="small" />
            <Text style={styles.loadingText}>Scanning files...</Text>
          </View>
        ) : displayedFiles.length === 0 ? (
          <View style={styles.emptyRecentCard}>
            <Text style={styles.emptyRecentIcon}>📂</Text>
            <Text style={styles.emptyRecentTitle}>
              {selectedCategory === 'STARRED'
                ? 'No Starred Files'
                : selectedCategory !== 'ALL'
                ? `No ${selectedCategory} files found`
                : 'No Recent Files'}
            </Text>
            <Text style={styles.emptyRecentSub}>
              {selectedCategory === 'STARRED'
                ? 'Tap the star on any file to quickly access your favorite documents here.'
                : 'Files you open will appear here for fast offline reading.'}
            </Text>
          </View>
        ) : (
          <View style={styles.recentFilesCard}>
            {displayedFiles.slice(0, 10).map((item, idx, arr) => {
              const badge = getBadgeForFile(item.category, item.name);
              const isLast = idx === arr.length - 1;
              const isStarred = MMKV.isStarred(item.path);

              return (
                <TouchableOpacity
                  key={`${item.path}-${idx}`}
                  style={[styles.recentItemRow, !isLast && styles.recentItemDivider]}
                  onPress={() => handleRecentTap(item)}
                  onLongPress={() =>
                    setSelectedDetailFile({
                      name: item.name,
                      path: item.path,
                      size: item.size,
                      lastModified: item.timestamp,
                      mimeType: item.mimeType,
                      category: item.category,
                      isStarred,
                    })
                  }
                  activeOpacity={0.7}>
                  {/* Badge */}
                  <View style={[styles.fileBadge, { backgroundColor: badge.bg }]}>
                    <Text
                      style={[
                        styles.fileBadgeText,
                        badge.isIcon && styles.fileBadgeIconText,
                      ]}>
                      {badge.label}
                    </Text>
                  </View>

                  {/* File Info */}
                  <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.fileMeta}>
                      {formatRelativeTime(item.timestamp)} • {formatBytes(item.size)}
                    </Text>
                  </View>

                  {/* Star Favorite Button */}
                  <TouchableOpacity
                    onPress={() => handleToggleStar(item)}
                    style={styles.starActionBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={[styles.starActionText, isStarred && styles.starActive]}>
                      {isStarred ? '★' : '☆'}
                    </Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Quick Action Buttons (Browse & Pick) */}
      <View style={styles.quickActionRow}>
        <TouchableOpacity
          style={styles.quickActionBtnPrimary}
          onPress={() => navigation?.navigate('FolderBrowser')}
          activeOpacity={0.8}>
          <Text style={styles.quickActionIcon}>📁</Text>
          <View>
            <Text style={styles.quickActionTitlePrimary}>Browse Folders</Text>
            <Text style={styles.quickActionSubPrimary}>Explore SD card & Downloads</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickActionBtnSecondary}
          onPress={async () => {
            try {
              const res = await engine.pickFile();
              const detected = await FileDetector.detectFile(res.path, res.name);
              MMKV.addRecentFile({
                name: res.name,
                path: res.path,
                size: res.size || 0,
                timestamp: Date.now(),
                category: detected.category,
                mimeType: detected.mimeType,
              });
              loadData();
              openMatchingViewer(res.name, res.path, detected.category);
            } catch (err) {
              console.warn('Pick file cancelled or failed', err);
            }
          }}
          activeOpacity={0.8}>
          <Text style={styles.quickActionIconSecondary}>📂</Text>
          <View>
            <Text style={styles.quickActionTitleSecondary}>Pick Any File</Text>
            <Text style={styles.quickActionSubSecondary}>Open offline instantly</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Clean Up Feedback Modal */}
      <Modal
        visible={isCleanModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsCleanModalVisible(false)}>
        <View style={styles.cleanModalOverlay}>
          <View style={styles.cleanModalCard}>
            <View style={styles.cleanIconBox}>
              <Text style={styles.cleanIconText}>✨</Text>
            </View>
            <Text style={styles.cleanModalTitle}>Storage Cleaned!</Text>
            <Text style={styles.cleanModalDesc}>
              Successfully cleaned temporary preview caches and unzipped temp files.
            </Text>
            <View style={styles.cleanStatsRow}>
              <Text style={styles.cleanSavedText}>{cleanedAmount || 'Cache is already clean and optimal (0 B)'}</Text>
            </View>
            <TouchableOpacity
              style={styles.cleanModalBtn}
              onPress={() => setIsCleanModalVisible(false)}>
              <Text style={styles.cleanModalBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
              {
                backgroundColor:
                  activeViewer.category === 'OFFICE_XLSX' || activeViewer.category === 'LEGACY_OLE_XLS'
                    ? '#107c41'
                    : activeViewer.category === 'PDF' || activeViewer.category === 'TEXT_CODE'
                    ? '#ffffff'
                    : '#1e293b',
              },
            ]}>
            <StatusBar
              barStyle={
                activeViewer.category === 'PDF' || activeViewer.category === 'TEXT_CODE'
                  ? 'dark-content'
                  : 'light-content'
              }
              backgroundColor={
                activeViewer.category === 'OFFICE_XLSX' || activeViewer.category === 'LEGACY_OLE_XLS'
                  ? '#107c41'
                  : activeViewer.category === 'PDF' || activeViewer.category === 'TEXT_CODE'
                  ? '#ffffff'
                  : '#1e293b'
              }
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
          </View>
        )}
      </Modal>

      {/* File Details Sheet Modal */}
      <FileDetailsModal
        visible={selectedDetailFile !== null}
        file={selectedDetailFile}
        onClose={() => setSelectedDetailFile(null)}
        onOpen={(f) =>
          handleRecentTap({
            name: f.name,
            path: f.path,
            size: f.size || 0,
            timestamp: Date.now(),
            category: f.category || 'UNKNOWN',
          })
        }
        onToggleStar={(f) => handleToggleStar(f)}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 32,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingTop: Platform.OS === 'android' ? 6 : 0,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.3,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSearchIcon: {
    fontSize: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
    padding: 0,
  },
  clearSearchIcon: {
    fontSize: 14,
    color: '#94a3b8',
    paddingHorizontal: 4,
    fontWeight: '700',
  },
  storageCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 2,
    shadowColor: '#64748b',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  storageTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  storageIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#dbeafe',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  storageIcon: {
    fontSize: 20,
  },
  storageTextBox: {
    flex: 1,
  },
  storageLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  storageUsedValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  storageProgressTrack: {
    height: 7,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 12,
    marginBottom: 10,
  },
  storageProgressFill: {
    height: '100%',
    backgroundColor: '#2563eb',
    borderRadius: 4,
  },
  cleanupRow: {
    marginTop: 2,
  },
  cleanupText: {
    fontSize: 13,
    color: '#64748b',
  },
  cleanupAction: {
    color: '#2563eb',
    fontWeight: '600',
  },
  categoriesSection: {
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  resetFilterText: {
    fontSize: 13,
    color: '#2563eb',
    fontWeight: '600',
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  categoryCard: {
    width: '48.5%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  categoryCardSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  categoryBadge: {
    width: 42,
    height: 42,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  categoryBadgeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  categoryBadgeIconText: {
    fontSize: 18,
  },
  categoryInfo: {
    flex: 1,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  categoryCount: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  recentSection: {
    marginBottom: 20,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563eb',
  },
  clearRecentsText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#94a3b8',
  },
  recentFilesCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    overflow: 'hidden',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  recentItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  recentItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  fileBadge: {
    width: 38,
    height: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fileBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  fileBadgeIconText: {
    fontSize: 16,
  },
  fileInfo: {
    flex: 1,
    marginRight: 8,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  fileMeta: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  starActionBtn: {
    padding: 6,
  },
  starActionText: {
    fontSize: 18,
    color: '#cbd5e1',
  },
  starActive: {
    color: '#f59e0b',
  },
  loadingBox: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748b',
  },
  emptyRecentCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 1,
  },
  emptyRecentIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyRecentTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  emptyRecentSub: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  continueSection: {
    marginBottom: 20,
  },
  continueSub: {
    fontSize: 11,
    color: '#64748b',
  },
  continueScroll: {
    gap: 10,
    paddingVertical: 2,
  },
  continueCard: {
    width: 170,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  continueCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  miniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  miniBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#ffffff',
  },
  continueProgress: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16a34a',
  },
  continueFileName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
    lineHeight: 16,
    marginBottom: 8,
  },
  continueFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  continueResumeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  quickActionBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  quickActionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  quickActionIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  quickActionIconSecondary: {
    fontSize: 20,
    marginRight: 8,
  },
  quickActionTitlePrimary: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e40af',
  },
  quickActionSubPrimary: {
    fontSize: 10,
    color: '#3b82f6',
  },
  quickActionTitleSecondary: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  quickActionSubSecondary: {
    fontSize: 10,
    color: '#64748b',
  },
  cleanModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  cleanModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  cleanIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  cleanIconText: {
    fontSize: 28,
  },
  cleanModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
  },
  cleanModalDesc: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
  },
  cleanStatsRow: {
    backgroundColor: '#f0fdf4',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 20,
  },
  cleanSavedText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#16a34a',
  },
  cleanModalBtn: {
    backgroundColor: '#2563eb',
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cleanModalBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  permissionCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  permissionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  permissionIcon: {
    fontSize: 22,
  },
  permissionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e40af',
  },
  permissionDesc: {
    fontSize: 11,
    color: '#3b82f6',
    marginTop: 2,
    lineHeight: 16,
  },
  dismissText: {
    fontSize: 14,
    color: '#94a3b8',
    padding: 4,
  },
  permissionBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  permActionBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  permActionBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  modalWrapper: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0,
  },
});

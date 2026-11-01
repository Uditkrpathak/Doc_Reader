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
  Dimensions,
} from 'react-native';
import { MMKV, RecentFile } from '../services/MMKV';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { FileDetector } from '../services/FileDetector';
import { FileCard } from '../components/FileCard';
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface HomeScreenProps {
  navigation?: {
    navigate: (screen: string, params?: any) => void;
  };
  initialCategory?: string;
}

interface CategoryCard {
  id: string;
  name: string;
  sub: string;
  icon: string;
  color: string;
  bgColor: string;
  extensions: string[];
}

const CATEGORIES: CategoryCard[] = [
  {
    id: 'PDF',
    name: 'PDF Docs',
    sub: 'Reports & Ebooks',
    icon: '📕',
    color: '#dc2626',
    bgColor: '#fef2f2',
    extensions: ['pdf'],
  },
  {
    id: 'WORD',
    name: 'Word Docs',
    sub: 'DOCX, DOC, TXT',
    icon: '📘',
    color: '#2563eb',
    bgColor: '#eff6ff',
    extensions: ['docx', 'doc', 'txt', 'rtf'],
  },
  {
    id: 'EXCEL',
    name: 'Excel & CSV',
    sub: 'XLSX, XLS, CSV',
    icon: '📗',
    color: '#16a34a',
    bgColor: '#f0fdf4',
    extensions: ['xlsx', 'xls', 'csv', 'tsv'],
  },
  {
    id: 'PPT',
    name: 'PowerPoint',
    sub: 'PPTX, PPT Slides',
    icon: '📙',
    color: '#ea580c',
    bgColor: '#fff7ed',
    extensions: ['pptx', 'ppt'],
  },
  {
    id: 'IMAGE',
    name: 'Photos & Img',
    sub: 'JPG, PNG, GIF, HEIC',
    icon: '🖼️',
    color: '#9333ea',
    bgColor: '#faf5ff',
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif'],
  },
  {
    id: 'AUDIO',
    name: 'Music & Audio',
    sub: 'MP3, WAV, AAC',
    icon: '🎵',
    color: '#0891b2',
    bgColor: '#ecfeff',
    extensions: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a'],
  },
  {
    id: 'ARCHIVE',
    name: 'ZIP & RAR',
    sub: 'Compressed Files',
    icon: '🗜️',
    color: '#475569',
    bgColor: '#f8fafc',
    extensions: ['zip', 'rar', '7z', 'tar', 'gz'],
  },
];

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation, initialCategory }) => {
  const { permissionState, requestMediaPermissions, requestDocumentsTree } = usePermissions();
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [starredFiles, setStarredFiles] = useState<RecentFile[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isPicking, setIsPicking] = useState<boolean>(false);
  const [continueFiles, setContinueFiles] = useState<Array<RecentFile & { pos: any }>>([]);

  // Phase 1: Storage Dashboard & View Mode
  const [dashboardCounts, setDashboardCounts] = useState<DashboardCounts | null>(() =>
    StorageService.getInstance().getCachedDashboardCounts()
  );
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [isScanningDashboard, setIsScanningDashboard] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    return (MMKV.getString('ufv_home_view_mode') as 'list' | 'grid') || 'list';
  });
  const [selectedDetailFile, setSelectedDetailFile] = useState<FileDetailsItem | null>(null);
  const [categoryFiles, setCategoryFiles] = useState<any[]>([]);
  const [isLoadingCategoryFiles, setIsLoadingCategoryFiles] = useState<boolean>(false);
  const [isPermissionBannerDismissed, setIsPermissionBannerDismissed] = useState<boolean>(false);

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
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

  const toggleViewMode = () => {
    const next = viewMode === 'list' ? 'grid' : 'list';
    setViewMode(next);
    MMKV.set('ufv_home_view_mode', next);
  };

  // When a specific category is selected, query device files for that category
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

  const handlePickFile = async () => {
    setIsPicking(true);
    try {
      const res = await engine.pickFile();
      const detected = await FileDetector.detectFile(res.path, res.name);

      const recentItem: RecentFile = {
        name: res.name,
        path: res.path,
        size: res.size || 0,
        timestamp: Date.now(),
        category: detected.category,
        mimeType: detected.mimeType,
      };

      MMKV.addRecentFile(recentItem);
      loadData();
      openMatchingViewer(res.name, res.path, detected.category);
    } catch (err) {
      console.warn('Pick file cancelled or failed', err);
    } finally {
      setIsPicking(false);
    }
  };

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

  // Filtered list based on selected category & search query
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
        return { bg: '#111827', barStyle: 'light-content' as const };
      case 'PDF':
      case 'TEXT_CODE':
      default:
        return { bg: '#ffffff', barStyle: 'dark-content' as const };
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 1. Instant Search Bar */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search documents, sheets, media..."
          placeholderTextColor="#9ca3af"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.clearSearchIcon}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 2. Quick Action Tiles (Browse & Pick) */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionCardPrimary}
          onPress={() => navigation?.navigate('FolderBrowser')}
          activeOpacity={0.8}>
          <View style={styles.actionIconPillPrimary}>
            <Text style={styles.actionIconText}>📁</Text>
          </View>
          <View style={styles.actionTextBox}>
            <Text style={styles.actionTitlePrimary}>Browse Folders</Text>
            <Text style={styles.actionSubPrimary}>Explore SD card & Downloads</Text>
          </View>
          <Text style={styles.actionChevronPrimary}>→</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionCardSecondary}
          onPress={handlePickFile}
          disabled={isPicking}
          activeOpacity={0.8}>
          <View style={styles.actionIconPillSecondary}>
            {isPicking ? (
              <ActivityIndicator color="#0284c7" size="small" />
            ) : (
              <Text style={styles.actionIconText}>📂</Text>
            )}
          </View>
          <View style={styles.actionTextBox}>
            <Text style={styles.actionTitleSecondary}>Pick Any File</Text>
            <Text style={styles.actionSubSecondary}>Open offline instantly</Text>
          </View>
          <Text style={styles.actionChevronSecondary}>→</Text>
        </TouchableOpacity>
      </View>

      {/* 2.5 Storage Usage Meter Bar */}
      {storageUsage && storageUsage.totalBytes > 0 && (
        <View style={styles.storageMeterCard}>
          <View style={styles.storageMeterHeader}>
            <Text style={styles.storageMeterTitle}>💾 Internal Storage</Text>
            <Text style={styles.storageMeterText}>
              {(storageUsage.usedBytes / (1024 * 1024 * 1024)).toFixed(1)} GB /{' '}
              {(storageUsage.totalBytes / (1024 * 1024 * 1024)).toFixed(1)} GB used
            </Text>
          </View>
          <View style={styles.storageProgressTrack}>
            <View
              style={[
                styles.storageProgressFill,
                {
                  width: `${Math.min(
                    100,
                    Math.round((storageUsage.usedBytes / storageUsage.totalBytes) * 100)
                  )}%`,
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* 2.8 Permission Recommendation Banner */}
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

      {/* 3. Category Dashboard Grid */}
      <View style={styles.categorySection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>📂 File Categories</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {isScanningDashboard && <ActivityIndicator color="#0284c7" size="small" />}
            {selectedCategory !== 'ALL' && (
              <TouchableOpacity onPress={() => setSelectedCategory('ALL')}>
                <Text style={styles.resetFilterText}>Show All</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.categoryGrid}>
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            let countObj = null;
            if (dashboardCounts) {
              if (cat.id === 'PDF') countObj = dashboardCounts.pdf;
              else if (cat.id === 'WORD') countObj = dashboardCounts.word;
              else if (cat.id === 'EXCEL') countObj = dashboardCounts.excel;
              else if (cat.id === 'PPT') countObj = dashboardCounts.pptx;
              else if (cat.id === 'ARCHIVE') countObj = dashboardCounts.archive;
              else if (cat.id === 'AUDIO') countObj = dashboardCounts.audio;
              else if (cat.id === 'VIDEO') countObj = dashboardCounts.video;
              else if (cat.id === 'IMAGE') countObj = dashboardCounts.image;
            }
            const displaySub = countObj
              ? `${countObj.count} files • ${formatBytes(countObj.totalBytes)}`
              : cat.sub;

            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryCard,
                  { borderColor: isSelected ? cat.color : '#e2e8f0' },
                  isSelected && { backgroundColor: cat.bgColor },
                ]}
                onPress={() => setSelectedCategory(isSelected ? 'ALL' : cat.id)}
                activeOpacity={0.75}>
                <View style={[styles.categoryIconBox, { backgroundColor: cat.bgColor }]}>
                  <Text style={styles.categoryIcon}>{cat.icon}</Text>
                </View>
                <Text style={[styles.categoryName, isSelected && { color: cat.color }]}>
                  {cat.name}
                </Text>
                <Text style={styles.categorySub} numberOfLines={1}>
                  {displaySub}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 3.5. Continue Reading Section (Master PRD Section 2.2) */}
      {continueFiles.length > 0 && selectedCategory === 'ALL' && !searchQuery && (
        <View style={styles.continueSection}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>📖 Continue Reading</Text>
            <Text style={styles.continueSub}>Pick up where you left off</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.continueScroll}>
            {continueFiles.map((item) => {
              const ext = (item.name.split('.').pop() || '').toUpperCase();
              const progressText =
                item.pos.page !== undefined
                  ? `Page ${item.pos.page + 1}${item.pos.total ? ` / ${item.pos.total}` : ''}`
                  : item.pos.slide !== undefined
                  ? `Slide ${item.pos.slide}${item.pos.total ? ` / ${item.pos.total}` : ''}`
                  : item.pos.timeMs !== undefined
                  ? `${Math.floor(item.pos.timeMs / 60000)}:${String(Math.floor((item.pos.timeMs % 60000) / 1000)).padStart(2, '0')}`
                  : 'Resume';
              return (
                <TouchableOpacity
                  key={`continue-${item.path}`}
                  style={styles.continueCard}
                  onPress={() => openMatchingViewer(item.name, item.path, item.category)}
                  activeOpacity={0.8}>
                  <View style={styles.continueCardHeader}>
                    <Text style={styles.continueBadge}>{ext}</Text>
                    <Text style={styles.continueProgress}>{progressText}</Text>
                  </View>
                  <Text style={styles.continueFileName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <View style={styles.continueFooter}>
                    <Text style={styles.continueResumeText}>Resume ➔</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* 4. Filter Pills Bar */}
      <View style={styles.pillsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillsScroll}>
          <TouchableOpacity
            style={[styles.pill, selectedCategory === 'ALL' && styles.pillActive]}
            onPress={() => setSelectedCategory('ALL')}>
            <Text style={[styles.pillText, selectedCategory === 'ALL' && styles.pillTextActive]}>
              ⚡ All Files ({recentFiles.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.pill, selectedCategory === 'STARRED' && styles.pillActiveStar]}
            onPress={() => setSelectedCategory('STARRED')}>
            <Text style={[styles.pillText, selectedCategory === 'STARRED' && styles.pillTextActive]}>
              ⭐ Starred ({starredFiles.length})
            </Text>
          </TouchableOpacity>

          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.pill, selectedCategory === cat.id && styles.pillActive]}
              onPress={() => setSelectedCategory(cat.id)}>
              <Text style={[styles.pillText, selectedCategory === cat.id && styles.pillTextActive]}>
                {cat.icon} {cat.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 5. Files List Section */}
      <View style={styles.filesSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            {selectedCategory === 'STARRED'
              ? `⭐ Starred Favorites (${displayedFiles.length})`
              : selectedCategory !== 'ALL'
              ? `${selectedCategory} Files (${displayedFiles.length})`
              : `🕒 Recent Files (${displayedFiles.length})`}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={toggleViewMode} style={styles.viewToggleBtn}>
              <Text style={styles.viewToggleBtnText}>{viewMode === 'list' ? '⊞ Grid' : '☰ List'}</Text>
            </TouchableOpacity>
            {recentFiles.length > 0 && selectedCategory !== 'STARRED' && (
              <TouchableOpacity onPress={handleClearRecents}>
                <Text style={styles.clearRecentsText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {isLoadingCategoryFiles ? (
          <View style={{ paddingVertical: 24, alignItems: 'center' }}>
            <ActivityIndicator color="#0284c7" size="small" />
            <Text style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>Scanning device files...</Text>
          </View>
        ) : displayedFiles.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyEmoji}>
              {selectedCategory === 'STARRED' ? '⭐' : searchQuery ? '🔍' : '📂'}
            </Text>
            <Text style={styles.emptyTitle}>
              {selectedCategory === 'STARRED'
                ? 'No Starred Files'
                : searchQuery
                ? 'No matching files found'
                : 'No files found'}
            </Text>
            <Text style={styles.emptyDesc}>
              {selectedCategory === 'STARRED'
                ? 'Tap the ☆ star on any file to add it to your favorites for quick access.'
                : 'Open any document from "Browse Folders" or "Pick Any File" above to read offline.'}
            </Text>
          </View>
        ) : viewMode === 'grid' ? (
          <View style={styles.gridContainer}>
            {displayedFiles.map((item, idx) => (
              <View key={`${item.path}-${idx}`} style={{ width: '50%' }}>
                <FileCard
                  file={{
                    name: item.name,
                    path: item.path,
                    size: item.size,
                    isDirectory: false,
                    category: item.category,
                  }}
                  viewMode="grid"
                  isStarred={MMKV.isStarred(item.path)}
                  onToggleStar={handleToggleStar}
                  onPress={() => handleRecentTap(item)}
                  onLongPress={(f) =>
                    setSelectedDetailFile({
                      name: f.name,
                      path: f.path,
                      size: f.size,
                      lastModified: item.timestamp,
                      mimeType: item.mimeType,
                      category: f.category,
                      isStarred: MMKV.isStarred(f.path),
                    })
                  }
                />
              </View>
            ))}
          </View>
        ) : (
          displayedFiles.map((item, idx) => (
            <FileCard
              key={`${item.path}-${idx}`}
              file={{
                name: item.name,
                path: item.path,
                size: item.size,
                isDirectory: false,
                category: item.category,
              }}
              viewMode="list"
              isStarred={MMKV.isStarred(item.path)}
              onToggleStar={handleToggleStar}
              onPress={() => handleRecentTap(item)}
              onLongPress={(f) =>
                setSelectedDetailFile({
                  name: f.name,
                  path: f.path,
                  size: f.size,
                  lastModified: item.timestamp,
                  mimeType: item.mimeType,
                  category: f.category,
                  isStarred: MMKV.isStarred(f.path),
                })
              }
            />
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

      {/* 6. File Details Sheet Modal */}
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
    paddingTop: 12,
    paddingBottom: 24,
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
    fontSize: 16,
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
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  actionCardPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#0284c7',
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  actionIconPillPrimary: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  actionIconText: {
    fontSize: 18,
  },
  actionTextBox: {
    flex: 1,
  },
  actionTitlePrimary: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  actionSubPrimary: {
    fontSize: 10,
    color: '#e0f2fe',
    marginTop: 1,
  },
  actionChevronPrimary: {
    fontSize: 16,
    color: '#ffffff',
    fontWeight: '700',
    marginLeft: 4,
  },
  actionCardSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#0284c7',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  actionIconPillSecondary: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f0f9ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  actionTitleSecondary: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0284c7',
  },
  actionSubSecondary: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 1,
  },
  actionChevronSecondary: {
    fontSize: 16,
    color: '#0284c7',
    fontWeight: '700',
    marginLeft: 4,
  },
  categorySection: {
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  resetFilterText: {
    fontSize: 12,
    color: '#0284c7',
    fontWeight: '600',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryCard: {
    width: (SCREEN_WIDTH - 48) / 3,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  categoryIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  categoryIcon: {
    fontSize: 20,
  },
  categoryName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'center',
  },
  categorySub: {
    fontSize: 9,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 2,
  },
  continueSection: {
    marginBottom: 16,
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
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    justifyContent: 'space-between',
  },
  continueCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  continueBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: '#0284c7',
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
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
    color: '#0284c7',
  },
  pillsContainer: {
    marginBottom: 16,
  },
  pillsScroll: {
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  pillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#0284c7',
  },
  pillActiveStar: {
    backgroundColor: '#eab308',
    borderColor: '#eab308',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  pillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  filesSection: {
    marginBottom: 20,
  },
  clearRecentsText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  emptyEmoji: {
    fontSize: 36,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  emptyDesc: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
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
  storageMeterCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  storageMeterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  storageMeterTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  storageMeterText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  storageProgressTrack: {
    height: 8,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  storageProgressFill: {
    height: '100%',
    backgroundColor: '#0284c7',
    borderRadius: 4,
  },
  permissionCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
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
  viewToggleBtn: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  viewToggleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
  },
});

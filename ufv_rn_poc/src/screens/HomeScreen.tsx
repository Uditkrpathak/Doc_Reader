import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Modal,
  StatusBar,
  AppState,
} from 'react-native';
import { MMKV, RecentFile, LastPosition } from '../services/MMKV';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { FileDetector } from '../services/FileDetector';
import { StorageService, DashboardCounts, StorageUsage } from '../services/StorageService';
import { usePermissions } from '../hooks/usePermissions';
import { WalletService } from '../services/WalletService';
import { AdService, SponsorCard } from '../services/AdService';
import { FigmaTheme } from '../theme/FigmaTheme';

// Figma Modals & Components
import { FileActionMenuModal, ActionMenuItemFile } from '../components/FileActionMenuModal';
import { FileInformationModal, FileInfoData } from '../components/FileInformationModal';
import { WalletModal } from '../components/WalletModal';
import { SettingsScreen } from './SettingsScreen';
import { RewardsScreen } from './RewardsScreen';
import { PremiumPaywallScreen } from './PremiumPaywallScreen';
import { AuthScreen, AuthMode } from './AuthScreen';
import {
  FolderOutlineIcon,
  CoinIcon,
  SettingsGearIcon,
  DocumentFileBadgeIcon,
  SearchOutlineIcon,
  CategoryDocIcon,
  CategorySheetIcon,
  CategoryImgIcon,
  CategoryArchiveIcon,
  HardDriveStorageIcon,
  DocScannerIcon,
  EmptyDocOutlineIcon,
  RightArrowIcon,
} from '../components/AppIcons';

// Strict State Machine
import { useFileOpeningStateMachine } from '../hooks/useFileOpeningStateMachine';
import { FileOpeningStateView } from '../components/FileOpeningStateView';

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

interface HomeScreenProps {
  navigation?: {
    navigate: (screen: string, params?: any) => void;
  };
  initialCategory?: string;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({ navigation, initialCategory: _initialCategory }) => {
  const {
    permissionState,
    requestAllFilesAccess,
    refreshPermissions,
  } = usePermissions();

  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [continueFiles, setContinueFiles] = useState<Array<RecentFile & { pos: LastPosition }>>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const displayedRecentFiles = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return recentFiles;
    return recentFiles.filter((f) => f.name.toLowerCase().includes(q));
  }, [recentFiles, searchQuery]);

  // Populated state only when user actually has opened files (Zero mock data on initial start)
  const isPopulated = displayedRecentFiles.length > 0;
  const effectiveRecentFiles = displayedRecentFiles;
  const effectiveContinueFile = continueFiles.length > 0 ? continueFiles[0] : null;

  const walletService = WalletService.getInstance();
  const adService = AdService.getInstance();

  const [isWalletVisible, setIsWalletVisible] = useState<boolean>(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState<boolean>(false);
  const [isRewardsVisible, setIsRewardsVisible] = useState<boolean>(false);
  const [isPaywallVisible, setIsPaywallVisible] = useState<boolean>(false);
  const [authModalState, setAuthModalState] = useState<{ visible: boolean; mode?: AuthMode }>({
    visible: false,
  });
  const [walletBalance, setWalletBalance] = useState<number>(() => walletService.getBalance());
  const [isAdFreeActive, setIsAdFreeActive] = useState<boolean>(() => walletService.isAdFreeActive());
  const [sponsorCard, setSponsorCard] = useState<SponsorCard | null>(() =>
    adService.getRandomSponsorCard()
  );

  // Storage data
  const [_dashboardCounts, setDashboardCounts] = useState<DashboardCounts | null>(() =>
    StorageService.getInstance().getCachedDashboardCounts()
  );
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);

  // Action Menu & Info Modals
  const [actionMenuFile, setActionMenuFile] = useState<ActionMenuItemFile | null>(null);
  const [infoModalFile, setInfoModalFile] = useState<FileInfoData | null>(null);

  // Active file viewer
  const [activeViewer, setActiveViewer] = useState<{
    file: string;
    path: string;
    category: string;
    formatType?: any;
  } | null>(null);

  const engine = ArchiveEngine.getInstance();
  const storageService = StorageService.getInstance();

  // Strict state machine
  const stateMachine = useFileOpeningStateMachine();

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
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(timestamp).toLocaleDateString();
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

  const loadData = useCallback(() => {
    // Zero mock data: only real files stored when opened on device
    const recents = MMKV.getRecentFiles();
    const cont = MMKV.getContinueReadingFiles();
    setRecentFiles(recents);
    setContinueFiles(cont);
  }, []);

  const loadStorageData = useCallback(async () => {
    try {
      const [counts, usage] = await Promise.all([
        storageService.getStorageDashboardCounts(),
        storageService.getStorageUsage(),
      ]);
      setDashboardCounts(counts);
      setStorageUsage(usage);
    } catch (err) {
      console.warn('loadStorageData error', err);
    }
  }, [storageService]);

  useEffect(() => {
    loadData();
    loadStorageData();
  }, [loadData, loadStorageData]);

  // Handle app coming to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        refreshPermissions().then(() => {
          loadStorageData();
        });
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refreshPermissions, loadStorageData]);


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

  const handleOpenFile = async (file: { name: string; path: string; size?: number }) => {
    try {
      let targetPath = file.path;
      if (targetPath.startsWith('content://')) {
        const resolved = await storageService.resolveToLocalFile(targetPath);
        targetPath = resolved.localPath;
      }
      const detected = await FileDetector.detectFile(targetPath, file.name);
      MMKV.addRecentFile({
        name: file.name,
        path: targetPath,
        size: file.size || 0,
        timestamp: Date.now(),
        category: detected.category,
      });
      loadData();
      openMatchingViewer(file.name, targetPath, detected.category);
    } catch {
      openMatchingViewer(file.name, file.path, 'UNKNOWN');
    }
  };

  const handlePickAnyFile = async () => {
    try {
      const res = await engine.pickFile();
      await handleOpenFile(res);
    } catch (err) {
      console.warn('Pick file cancelled or failed', err);
    }
  };

  const handleShareFile = async (file: ActionMenuItemFile | FileInfoData) => {
    try {
      await engine.shareFile(file.path);
    } catch (err) {
      console.warn('Share file failed', err);
    }
  };

  const handleToggleStar = (file: ActionMenuItemFile) => {
    MMKV.toggleStarred({
      name: file.name,
      path: file.path,
      size: file.size || 0,
      timestamp: Date.now(),
      category: file.category || 'UNKNOWN',
    });
    loadData();
  };

  const handleRemoveRecent = (file: ActionMenuItemFile) => {
    MMKV.removeRecentFile(file.path);
    loadData();
  };

  // Real StatFs Storage Numbers (Zero Mock Data)
  const totalGb = storageUsage ? (storageUsage.totalBytes / (1024 * 1024 * 1024)).toFixed(1) : null;
  const usedGb = storageUsage ? (storageUsage.usedBytes / (1024 * 1024 * 1024)).toFixed(1) : null;

  // Real Category Breakdown (Zero Mock Data)
  const mediaBytes = _dashboardCounts
    ? (_dashboardCounts.image?.totalBytes || 0) +
    (_dashboardCounts.video?.totalBytes || 0) +
    (_dashboardCounts.audio?.totalBytes || 0)
    : 0;

  const docsBytes = _dashboardCounts
    ? (_dashboardCounts.pdf?.totalBytes || 0) +
    (_dashboardCounts.word?.totalBytes || 0) +
    (_dashboardCounts.excel?.totalBytes || 0) +
    (_dashboardCounts.pptx?.totalBytes || 0) +
    (_dashboardCounts.archive?.totalBytes || 0)
    : 0;

  const totalUsedBytes = storageUsage?.usedBytes || 0;
  const totalCapacityBytes = storageUsage?.totalBytes || (totalUsedBytes > 0 ? totalUsedBytes : 1);
  const otherBytes = Math.max(0, totalUsedBytes - (mediaBytes + docsBytes));
  const freeBytes = storageUsage?.freeBytes || 0;

  const mediaFlex = Math.max(0.005, mediaBytes / totalCapacityBytes);
  const docsFlex = Math.max(0.005, docsBytes / totalCapacityBytes);
  const otherFlex = Math.max(0.005, otherBytes / totalCapacityBytes);
  const freeFlex = Math.max(0.01, freeBytes / totalCapacityBytes);

  const mediaGbText = formatBytes(mediaBytes);
  const docsGbText = formatBytes(docsBytes);
  const othersGbText = formatBytes(otherBytes);

  // Permission-aware navigation handlers
  const handleHeroBrowse = () => {
    if (navigation?.navigate) {
      navigation.navigate('Browse');
    } else {
      handlePickAnyFile();
    }
  };

  const handleBrowseDeviceFiles = async () => {
    if (navigation?.navigate) {
      if (permissionState.allFiles || permissionState.documentsTreeGranted) {
        navigation.navigate('Browse');
        return;
      }
      await requestAllFilesAccess();
      navigation.navigate('Browse');
    } else {
      await handlePickAnyFile();
    }
  };

  const handleCategoryPress = (category: string) => {
    navigation?.navigate('Browse', { category });
  };

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />

      {/* 1. FIGMA HEADER (White Header with My Files & Coins) */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.brandContainer}>
            <FolderOutlineIcon size={22} color="#016EEF" />
            <Text style={styles.brandTitle}>My Files</Text>
          </View>

          <View style={styles.headerRightActions}>
            {/* Coin Balance Pill (Figma Screen 2 & 3: (🪙 120)) */}
            <TouchableOpacity
              style={styles.coinPill}
              activeOpacity={0.8}
              onPress={() => setIsRewardsVisible(true)}>
              <CoinIcon size={15} color="#016EEF" />
              <Text style={styles.coinValue}>{walletBalance}</Text>
            </TouchableOpacity>

            {/* Settings Gear Icon */}
            <TouchableOpacity
              style={styles.settingsBtn}
              activeOpacity={0.7}
              onPress={() => setIsSettingsVisible(true)}>
              <SettingsGearIcon size={18} color="#0F172A" />
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. SEARCH PILL (Figma: Search files by name) */}
        <View style={styles.searchBarContainer}>
          <SearchOutlineIcon size={18} color="#016EEF" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search files by name"
            placeholderTextColor="#5B6478"
            value={searchQuery}
            onChangeText={setSearchQuery}
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
      </View>

      {/* MAIN SCROLLABLE CONTENT */}
      <ScrollView
        style={styles.scrollBody}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* 3. HERO CARD (Figma: Browse your files with folder tab) */}
        <View style={styles.heroWrap}>
          {/* Top Folder Tab with smooth slope */}
          <View style={styles.heroTabRow}>
            <View style={styles.heroTabBody} />
            <View style={styles.heroTabSlope} />
          </View>
          <View style={styles.heroCard}>
            <View style={styles.heroLeft}>
              <Text style={styles.heroTitle}>Browse your files</Text>
              <Text style={styles.heroSubtitle}>Find files and folders on your device</Text>

              {/* Format Pills Row */}
              <View style={styles.formatPillsRow}>
                {['PDF', 'DOCX', 'XLSX', 'ZIP', 'MP4'].map((fmt) => (
                  <View key={fmt} style={styles.heroFormatPill}>
                    <Text style={styles.heroFormatPillText}>{fmt}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Figma Circle Action Button with Royal Blue Arrow */}
            <TouchableOpacity
              style={styles.heroActionBtn}
              activeOpacity={0.85}
              onPress={handleHeroBrowse}>
              <RightArrowIcon size={20} color="#016EEF" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 4. 4 CATEGORY QUICK BUTTONS (Figma: Documents, Sheets, Images, Archives) */}
        <View style={styles.categoryGrid}>
          {/* Documents */}
          <TouchableOpacity
            style={styles.categoryItem}
            activeOpacity={0.75}
            onPress={() => handleCategoryPress('DOCUMENTS')}>
            <View style={[styles.categoryIconBox, { backgroundColor: '#FEE2E2' }]}>
              <CategoryDocIcon size={24} color="#DC2626" />
            </View>
            <Text style={styles.categoryLabel}>Documents</Text>
          </TouchableOpacity>

          {/* Sheets */}
          <TouchableOpacity
            style={styles.categoryItem}
            activeOpacity={0.75}
            onPress={() => handleCategoryPress('SPREADSHEETS')}>
            <View style={[styles.categoryIconBox, { backgroundColor: '#DCFCE7' }]}>
              <CategorySheetIcon size={24} color="#16A34A" />
            </View>
            <Text style={styles.categoryLabel}>Sheets</Text>
          </TouchableOpacity>

          {/* Images */}
          <TouchableOpacity
            style={styles.categoryItem}
            activeOpacity={0.75}
            onPress={() => handleCategoryPress('IMAGES')}>
            <View style={[styles.categoryIconBox, { backgroundColor: '#EDE9FE' }]}>
              <CategoryImgIcon size={24} color="#7C3AED" />
            </View>
            <Text style={styles.categoryLabel}>Images</Text>
          </TouchableOpacity>

          {/* Archives */}
          <TouchableOpacity
            style={styles.categoryItem}
            activeOpacity={0.75}
            onPress={() => handleCategoryPress('ARCHIVES')}>
            <View style={[styles.categoryIconBox, { backgroundColor: '#FEF3C7' }]}>
              <CategoryArchiveIcon size={24} color="#D97706" />
            </View>
            <Text style={styles.categoryLabel}>Archives</Text>
          </TouchableOpacity>
        </View>

        {/* 5. CONTINUE READING (Figma Image 1: Populated State Only) */}
        {isPopulated && effectiveContinueFile && (
          <View style={styles.sectionContainer}>
            <Text style={styles.continueSectionTitle}>Continue reading</Text>
            <TouchableOpacity
              style={styles.continueCard}
              activeOpacity={0.8}
              onPress={() => handleOpenFile(effectiveContinueFile)}>
              <DocumentFileBadgeIcon
                label="PDF"
                badgeBg="#DC2626"
                badgeText="#FFFFFF"
                width={40}
                height={48}
              />
              <View style={styles.continueInfo}>
                <Text style={styles.continueName} numberOfLines={1}>
                  {effectiveContinueFile.name}
                </Text>
                <Text style={styles.continueMeta}>
                  {effectiveContinueFile.pos?.page && effectiveContinueFile.pos?.total ? `Page ${effectiveContinueFile.pos.page} of ${effectiveContinueFile.pos.total} · ${formatRelativeTime(effectiveContinueFile.pos.timestamp)}` : formatRelativeTime(effectiveContinueFile.timestamp)}
                </Text>
                {/* Figma blue progress line */}
                <View style={styles.continueProgressLineTrack}>
                  <View style={[styles.continueProgressLineFill, { width: effectiveContinueFile?.pos?.page && effectiveContinueFile?.pos?.total ? `${Math.round((effectiveContinueFile.pos.page / effectiveContinueFile.pos.total) * 100)}%` : '25%' }]} />
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* 6. RECENT FILES (Figma Image 1 Populated vs Image 2 First Launch) */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent files</Text>
            {isPopulated && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => navigation?.navigate('Browse', { showRecents: true })}>
                <Text style={styles.seeAllLink}>See all &gt;</Text>
              </TouchableOpacity>
            )}
          </View>

          {searchQuery.trim().length > 0 && effectiveRecentFiles.length === 0 ? (
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
          ) : !isPopulated ? (
            /* FIGMA IMAGE 2: FIRST LAUNCH EMPTY STATE */
            <View style={styles.emptyContainer}>
              <View style={styles.emptyDashedBox}>
                {/* Top Row: Folded Doc Outline + Title/Sub */}
                <View style={styles.emptyTopRow}>
                  <EmptyDocOutlineIcon size={40} color="#94A3B8" />
                  <View style={styles.emptyTextCol}>
                    <Text style={styles.emptyTitle}>Nothing opened yet</Text>
                    <Text style={styles.emptySubtitle}>Files you open will show up here.</Text>
                  </View>
                </View>

                {/* Steps 1 & 2 */}
                <View style={styles.emptyStepsBox}>
                  <View style={styles.emptyStepRow}>
                    <View style={styles.emptyStepNumCircle}>
                      <Text style={styles.emptyStepNum}>1</Text>
                    </View>
                    <Text style={styles.emptyStepText}>
                      Tap <Text style={styles.emptyStepBold}>Browse your files</Text> and pick a document, image or archive.
                    </Text>
                  </View>

                  <View style={styles.emptyStepRow}>
                    <View style={styles.emptyStepNumCircle}>
                      <Text style={styles.emptyStepNum}>2</Text>
                    </View>
                    <Text style={styles.emptyStepText}>
                      Or choose this app when opening a file from another app.
                    </Text>
                  </View>
                </View>

                {/* Primary Action Button */}
                <TouchableOpacity
                  style={styles.browseDeviceBtn}
                  activeOpacity={0.8}
                  onPress={handleBrowseDeviceFiles}>
                  <FolderOutlineIcon size={16} color="#FFFFFF" />
                  <Text style={styles.browseDeviceBtnText}>Browse device files</Text>
                </TouchableOpacity>

                {/* Footnote divider and text INSIDE the dashed container (Figma Image 1) */}
                <View style={styles.emptyFootnoteDivider} />
                <Text style={styles.emptyFooterNote}>No account or sign-in needed.</Text>
              </View>
            </View>
          ) : (
            /* FIGMA IMAGE 1: POPULATED RECENT FILES LIST */
            <View style={styles.recentFilesListCard}>
              {effectiveRecentFiles.slice(0, 5).map((file: RecentFile, idx: number, arr: RecentFile[]) => {
                const badge = getBadgeForFile(file.name);
                const isStarred = MMKV.isStarred(file.path);
                const isLast = idx === arr.length - 1;

                return (
                  <View key={`${file.path}-${idx}`} style={[styles.recentRow, !isLast && styles.recentRowDivider]}>
                    <TouchableOpacity
                      style={styles.recentRowContent}
                      activeOpacity={0.7}
                      onPress={() => handleOpenFile(file)}>
                      {/* Figma 40x48 Document Card with Folded Corner & Pinned Badge */}
                      <DocumentFileBadgeIcon
                        label={badge.label}
                        badgeBg={badge.bg}
                        badgeText={badge.text}
                        width={40}
                        height={48}
                      />

                      {/* File Info */}
                      <View style={styles.recentMetaBox}>
                        <Text style={styles.recentFileName} numberOfLines={1}>
                          {file.name}
                        </Text>
                        <Text style={styles.recentFileSub}>
                          {badge.label} · {formatBytes(file.size)} · {formatRelativeTime(file.timestamp)}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* 3-Dot Action Menu (Figma Menu Modal trigger) */}
                    <TouchableOpacity
                      style={styles.moreActionBtn}
                      activeOpacity={0.7}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      onPress={() =>
                        setActionMenuFile({
                          name: file.name,
                          path: file.path,
                          size: file.size || 0,
                          lastModified: file.timestamp,
                          category: file.category,
                          isStarred,
                        })
                      }>
                      <Text style={styles.moreActionDots}>⋮</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* 7. INTERNAL STORAGE GAUGE (Figma Image 1 & 2: Header inside card) */}
        <View style={styles.sectionContainer}>
          <View style={styles.storageCard}>
            {/* Header row INSIDE the storage card (Figma layout) */}
            <View style={styles.storageHeaderRow}>
              <View style={styles.storageHeaderLeft}>
                <HardDriveStorageIcon size={18} color="#0F172A" />
                <Text style={styles.storageTitle}>Internal Storage</Text>
              </View>
              <Text style={styles.storageAvailableText}>Available</Text>
            </View>

            {/* Multi-segment Progress Bar: Blue, Green, Slate, Light Grey Track (Figma: 6px height) */}
            <View style={styles.storageProgressBarTrack}>
              <View style={[styles.storageSegmentMedia, { flex: mediaFlex }]} />
              <View style={[styles.storageSegmentDocs, { flex: docsFlex }]} />
              <View style={[styles.storageSegmentOther, { flex: otherFlex }]} />
              <View style={[styles.storageSegmentFree, { flex: freeFlex }]} />
            </View>

            {/* Storage Numbers Row */}
            <View style={styles.storageNumbersRow}>
              <Text style={styles.storageUsedText}>
                {usedGb ? `${usedGb} GB used` : '-- GB used'}
              </Text>
              <Text style={styles.storageTotalText}>
                {totalGb ? `${totalGb} GB total` : '-- GB total'}
              </Text>
            </View>

            {/* Storage Legend Row: Media, Docs, System */}
            <View style={styles.storageLegendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#016EEF' }]} />
                <Text style={styles.legendText}>{`Media (${mediaGbText})`}</Text>
              </View>

              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#86EFAC' }]} />
                <Text style={styles.legendText}>{`Docs (${docsGbText})`}</Text>
              </View>

              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#475569' }]} />
                <Text style={styles.legendText}>{`System (${othersGbText})`}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 8. SPONSORED BANNER CARD (Figma Image 1: Populated State Only) */}
        {isPopulated && !isAdFreeActive && sponsorCard && (
          <View style={styles.sponsorCard}>
            <View style={styles.sponsorTopRow}>
              <View style={styles.sponsorBadge}>
                <Text style={styles.sponsorBadgeText}>Sponsored</Text>
              </View>
              <View style={styles.sponsorRightTop}>
                <TouchableOpacity
                  onPress={() => setIsWalletVisible(true)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.whyThisAdText}>Why this ad?</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setSponsorCard(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.sponsorCloseIcon}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.sponsorContentRow}>
              <View style={styles.sponsorAppIcon}>
                <DocScannerIcon size={22} color="#7C3AED" />
              </View>
              <View style={styles.sponsorTextBox}>
                <Text style={styles.sponsorHeadline}>{sponsorCard.headline || 'Scan paper documents in seconds'}</Text>
                <Text style={styles.sponsorSubline}>{sponsorCard.body || 'ExampleScan · Free on the Play Store'}</Text>
              </View>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* 9. FIGMA ACTION MENU MODAL (Open, Share, Star, Remove, File Information) */}
      <FileActionMenuModal
        visible={actionMenuFile !== null}
        file={actionMenuFile}
        isRecentItem={true}
        onClose={() => setActionMenuFile(null)}
        onOpen={(f) => handleOpenFile(f)}
        onShare={(f) => handleShareFile(f)}
        onToggleStar={(f) => handleToggleStar(f)}
        onRemoveRecent={(f) => handleRemoveRecent(f)}
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

      {/* 10. FIGMA FILE INFORMATION MODAL */}
      <FileInformationModal
        visible={infoModalFile !== null}
        file={infoModalFile}
        onClose={() => setInfoModalFile(null)}
        onOpen={(f) => handleOpenFile(f)}
        onShare={(f) => handleShareFile(f)}
      />

      {/* 11. WALLET MODAL */}
      <WalletModal
        visible={isWalletVisible}
        onClose={() => setIsWalletVisible(false)}
        onStateChanged={() => {
          setWalletBalance(walletService.getBalance());
          setIsAdFreeActive(walletService.isAdFreeActive());
        }}
      />

      {/* 12. IN-APP SETTINGS MODAL */}
      <Modal
        visible={isSettingsVisible}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => setIsSettingsVisible(false)}>
        <SettingsScreen
          onBack={() => setIsSettingsVisible(false)}
          onOpenAuth={(mode) => {
            setAuthModalState({ visible: true, mode: (mode as AuthMode) || 'SIGN_IN' });
          }}
          onOpenRewards={() => {
            setIsSettingsVisible(false);
            setIsRewardsVisible(true);
          }}
          onOpenPaywall={() => {
            setIsSettingsVisible(false);
            setIsPaywallVisible(true);
          }}
        />
      </Modal>

      {/* 13. REWARDS & COINS SCREEN MODAL */}
      <Modal
        visible={isRewardsVisible}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => {
          setIsRewardsVisible(false);
          setWalletBalance(walletService.getBalance());
          setIsAdFreeActive(walletService.isAdFreeActive());
        }}>
        <RewardsScreen
          onBack={() => {
            setIsRewardsVisible(false);
            setWalletBalance(walletService.getBalance());
            setIsAdFreeActive(walletService.isAdFreeActive());
          }}
          onOpenPaywall={() => {
            setIsRewardsVisible(false);
            setIsPaywallVisible(true);
          }}
        />
      </Modal>

      {/* 14. PREMIUM PAYWALL SCREEN MODAL */}
      <Modal
        visible={isPaywallVisible}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => setIsPaywallVisible(false)}>
        <PremiumPaywallScreen
          onClose={() => setIsPaywallVisible(false)}
          onUpgradeSuccess={() => {
            setIsPaywallVisible(false);
            setWalletBalance(walletService.getBalance());
            setIsAdFreeActive(walletService.isAdFreeActive());
          }}
        />
      </Modal>

      {/* 15. AUTH & ACCOUNT MODAL */}
      <Modal
        visible={authModalState.visible}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => setAuthModalState({ visible: false })}>
        <AuthScreen
          initialMode={authModalState.mode || 'SIGN_IN'}
          onBack={() => setAuthModalState({ visible: false })}
          onAuthSuccess={() => {
            setAuthModalState({ visible: false });
          }}
        />
      </Modal>


      {/* 14. DOCUMENT & MEDIA VIEWERS */}
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
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
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
                  onClose={() => {
                    setActiveViewer(null);
                    loadData();
                  }}
                />
              )}
            {activeViewer.category === 'OFFICE_XLSX' && (
              <XlsxViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
              />
            )}
            {activeViewer.category === 'SPREADSHEET_CSV' && (
              <CsvViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
              />
            )}
            {activeViewer.category === 'ARCHIVE_RAR' && (
              <RarViewerScreen
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
              />
            )}
            {activeViewer.category === 'ARCHIVE_ZIP' && (
              <ZipViewerScreen
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
              />
            )}
            {activeViewer.category === 'IMAGE' && (
              <ImageViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
              />
            )}
            {(activeViewer.category === 'VIDEO' || activeViewer.category === 'AUDIO') && (
              <MediaViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                category={activeViewer.category as 'VIDEO' | 'AUDIO'}
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
              />
            )}
            {activeViewer.category === 'TEXT_CODE' && (
              <TextViewer
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
              />
            )}
            {activeViewer.category === 'UNSUPPORTED' && (
              <UnsupportedFileScreen
                filePath={activeViewer.path}
                fileName={activeViewer.file}
                onClose={() => {
                  setActiveViewer(null);
                  loadData();
                }}
              />
            )}
          </View>
        )}
      </Modal>

      {/* 15. STRICT STATE MACHINE LOADING / RECOVERY OVERLAY */}
      {stateMachine.state !== 'IDLE' && stateMachine.state !== 'READY' && (
        <FileOpeningStateView
          state={stateMachine.state}
          context={stateMachine.context}
          onRetry={stateMachine.retry}
          onCancel={stateMachine.cancel}
          onRequestAccess={requestAllFilesAccess}
        />
      )}
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

  // 1. Header (White in Figma Screen 2)
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  brandIcon: {
    fontSize: 22,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  coinEmoji: {
    fontSize: 14,
  },
  coinValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#016EEF',
  },
  settingsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsIcon: {
    fontSize: 18,
  },

  // Search Bar (White with soft border in Figma)
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
    borderRadius: 25,
    paddingHorizontal: 20,
    height: 50,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
    color: '#016EEF',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: FigmaTheme.colors.textPrimary,
    paddingVertical: 0,
    marginLeft: 14,
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
  searchEmptyCenterBox: {
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
  clearSearchIcon: {
    fontSize: 14,
    color: FigmaTheme.colors.textMuted,
    padding: 4,
  },

  // Scroll Content
  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 16,
  },

  // 3. Hero Card with Folder Tab (Figma)
  heroWrap: {
    width: '100%',
    paddingTop: 4,
  },
  heroTabRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 13,
    marginBottom: -1,
    zIndex: 2,
  },
  heroTabBody: {
    width: 104,
    height: 13,
    backgroundColor: FigmaTheme.colors.primary,
    borderTopLeftRadius: 16,
  },
  heroTabSlope: {
    width: 0,
    height: 0,
    borderBottomWidth: 13,
    borderBottomColor: FigmaTheme.colors.primary,
    borderRightWidth: 11,
    borderRightColor: 'transparent',
  },
  heroCard: {
    backgroundColor: FigmaTheme.colors.primary,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...FigmaTheme.shadows.floating,
  },
  heroLeft: {
    flex: 1,
    paddingRight: 12,
  },
  heroTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 12.5,
    color: 'rgba(255, 255, 255, 0.90)',
    marginBottom: 14,
  },
  formatPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  heroFormatPill: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  heroFormatPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  heroActionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
  },

  // 4. 4 Category Quick Buttons
  categoryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  categoryItem: {
    flex: 1,
    alignItems: 'center',
  },
  categoryIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryIconEmoji: {
    fontSize: 22,
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },

  // Section Headers
  sectionContainer: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: FigmaTheme.colors.textPrimary,
  },
  seeAllLink: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  // Continue Reading Card
  continueSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  continueCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.card,
  },
  continueInfo: {
    flex: 1,
    marginHorizontal: 12,
  },
  continueName: {
    fontSize: 14,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 3,
  },
  continueMeta: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
  },
  continueProgressText: {
    color: FigmaTheme.colors.primary,
    fontWeight: '600',
  },
  continueProgressLineTrack: {
    height: 4,
    width: '100%',
    backgroundColor: '#E2E8F0',
    borderRadius: 2,
    marginTop: 6,
    overflow: 'hidden',
  },
  continueProgressLineFill: {
    height: '100%',
    backgroundColor: '#016EEF',
    borderRadius: 2,
  },
  continueArrow: {
    fontSize: 16,
    color: FigmaTheme.colors.primary,
    fontWeight: '700',
  },

  // 6. Recent Files Card & List
  recentFilesListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    overflow: 'hidden',
    ...FigmaTheme.shadows.card,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  recentRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: FigmaTheme.colors.divider,
  },
  recentRowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  recentMetaBox: {
    flex: 1,
    marginLeft: 12,
  },
  recentFileName: {
    fontSize: 14,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 3,
  },
  recentFileSub: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
  },
  moreActionBtn: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreActionDots: {
    fontSize: 18,
    fontWeight: '800',
    color: FigmaTheme.colors.textSecondary,
  },

  // Format Badge
  fileBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },

  // Empty Recent Files (Figma Image 2: Home — first launch...)
  emptyContainer: {
    width: '100%',
  },
  emptyDashedBox: {
    backgroundColor: '#FAFCFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#38BDF8',
    borderStyle: 'dashed',
    padding: 16,
  },
  emptyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  emptyTextCol: {
    flex: 1,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 2,
  },
  emptySubtitle: {
    fontSize: 12.5,
    color: '#64748B',
  },
  emptyStepsBox: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 12,
    gap: 12,
    marginBottom: 14,
  },
  emptyStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  emptyStepNumCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E0F2FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  emptyStepNum: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#016EEF',
  },
  emptyStepText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: '#334155',
  },
  emptyStepBold: {
    fontWeight: '700',
    color: '#0F172A',
  },
  browseDeviceBtn: {
    width: '100%',
    height: 40,
    backgroundColor: '#016EEF',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  browseDeviceBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  emptyFootnoteDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    width: '100%',
    marginTop: 14,
    marginBottom: 10,
  },
  emptyFooterNote: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },

  // 7. Internal Storage Card (Figma Screen 2 & 3)
  storageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  storageHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  storageHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  storageTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  storageAvailableText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  storageProgressBarTrack: {
    flexDirection: 'row',
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
    marginBottom: 10,
  },
  storageSegmentMedia: {
    backgroundColor: '#016EEF',
  },
  storageSegmentDocs: {
    backgroundColor: '#86EFAC',
  },
  storageSegmentOther: {
    backgroundColor: '#475569',
  },
  storageSegmentFree: {
    backgroundColor: 'transparent',
  },
  storageNumbersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  storageUsedText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  storageTotalText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
  },
  storageLegendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 2,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 11.5,
    color: '#475569',
    fontWeight: '500',
  },

  // 8. Sponsored Banner Card
  sponsorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.card,
  },
  sponsorTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sponsorBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sponsorBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: FigmaTheme.colors.textSecondary,
  },
  sponsorRightTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  whyThisAdText: {
    fontSize: 11,
    color: FigmaTheme.colors.textMuted,
  },
  sponsorCloseIcon: {
    fontSize: 13,
    color: FigmaTheme.colors.textMuted,
  },
  sponsorContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  sponsorAppIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F3E8FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  sponsorAppIconText: {
    fontSize: 22,
  },
  sponsorTextBox: {
    flex: 1,
  },
  sponsorHeadline: {
    fontSize: 14,
    fontWeight: '800',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 3,
  },
  sponsorSubline: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
  },
  sponsorCtaBtn: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  sponsorCtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },
});


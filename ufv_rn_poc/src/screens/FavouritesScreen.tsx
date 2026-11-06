import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  StatusBar,
  Modal,
} from 'react-native';
import { MMKV, RecentFile } from '../services/MMKV';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { FileDetector } from '../services/FileDetector';
import { FigmaTheme } from '../theme/FigmaTheme';
import {
  DocumentFileBadgeIcon,
  StarOutlineIcon,
  SearchOutlineIcon,
  PhoneOutlineIcon,
  SelectionCheckbox,
  ShareVectorIcon,
} from '../components/AppIcons';

// Figma Modals
import { FileActionMenuModal, ActionMenuItemFile } from '../components/FileActionMenuModal';
import { FileInformationModal, FileInfoData } from '../components/FileInformationModal';
import { SortBottomSheet, SortCriteria, SortDirection } from '../components/SortBottomSheet';

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

interface FavouritesScreenProps {
  navigation?: {
    navigate: (screen: string, params?: any) => void;
  };
}

type CategoryTab =
  | 'ALL'
  | 'DOCUMENTS'
  | 'SPREADSHEETS'
  | 'PRESENTATIONS'
  | 'IMAGES'
  | 'AUDIO'
  | 'ARCHIVES';

export const FavouritesScreen: React.FC<FavouritesScreenProps> = ({ navigation }) => {
  const [starredFiles, setStarredFiles] = useState<RecentFile[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTab, setSelectedTab] = useState<CategoryTab>('ALL');

  // Sorting
  const [isSortSheetVisible, setIsSortSheetVisible] = useState<boolean>(false);
  const [sortCriteria, setSortCriteria] = useState<SortCriteria>('NAME');
  const [sortDirection, setSortDirection] = useState<SortDirection>('ASC');

  // Multi-selection mode
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Action Menu & File Info Modals
  const [actionMenuFile, setActionMenuFile] = useState<ActionMenuItemFile | null>(null);
  const [infoModalFile, setInfoModalFile] = useState<FileInfoData | null>(null);

  // Active viewer
  const [activeViewer, setActiveViewer] = useState<{
    file: string;
    path: string;
    category: string;
    formatType?: any;
  } | null>(null);

  const engine = ArchiveEngine.getInstance();

  const loadStarred = useCallback(() => {
    setStarredFiles(MMKV.getStarredFiles());
  }, []);

  const handleToggleSelect = (filePath: string) => {
    const updated = new Set(selectedPaths);
    if (updated.has(filePath)) {
      updated.delete(filePath);
    } else {
      updated.add(filePath);
    }
    setSelectedPaths(updated);
  };

  const handleSelectAll = (filesToSelect: RecentFile[]) => {
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

  const handleBulkRemoveStarred = () => {
    if (selectedPaths.size === 0) return;
    const paths = Array.from(selectedPaths);
    MMKV.removeStarredBatch(paths);
    setIsSelectionMode(false);
    setSelectedPaths(new Set());
    loadStarred();
  };

  useEffect(() => {
    loadStarred();
  }, [loadStarred]);

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const getBadgeForFile = (fileName: string) => {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return FigmaTheme.badges.pdf;
    if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return FigmaTheme.badges.excel;
    if (['docx', 'doc', 'txt', 'rtf', 'md'].includes(ext)) return FigmaTheme.badges.word;
    if (['pptx', 'ppt'].includes(ext)) return FigmaTheme.badges.pptx;
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FigmaTheme.badges.archive;
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return FigmaTheme.badges.video;
    if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return FigmaTheme.badges.audio;
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) return FigmaTheme.badges.image;
    return FigmaTheme.badges.unknown;
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

  const handleOpenFile = async (file: { name: string; path: string; size?: number; category?: string }) => {
    try {
      const detected = await FileDetector.detectFile(file.path, file.name);
      MMKV.addRecentFile({
        name: file.name,
        path: file.path,
        size: file.size || 0,
        timestamp: Date.now(),
        category: detected.category,
      });
      openMatchingViewer(file.name, file.path, detected.category);
    } catch {
      openMatchingViewer(file.name, file.path, file.category || 'UNKNOWN');
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
    loadStarred();
  };

  // Filtered files
  const filteredFiles = useMemo(() => {
    return starredFiles.filter((file) => {
      // Search query
      if (searchQuery.trim().length > 0) {
        if (!file.name.toLowerCase().includes(searchQuery.toLowerCase().trim())) {
          return false;
        }
      }

      // Category tab
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      switch (selectedTab) {
        case 'DOCUMENTS':
          return ['pdf', 'docx', 'doc', 'txt', 'rtf', 'md'].includes(ext);
        case 'SPREADSHEETS':
          return ['xlsx', 'xls', 'csv', 'tsv'].includes(ext);
        case 'PRESENTATIONS':
          return ['pptx', 'ppt'].includes(ext);
        case 'IMAGES':
          return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'].includes(ext);
        case 'AUDIO':
          return ['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext);
        case 'ARCHIVES':
          return ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext);
        case 'ALL':
        default:
          return true;
      }
    });
  }, [starredFiles, searchQuery, selectedTab]);

  // Sorted files
  const sortedFiles = useMemo(() => {
    const list = [...filteredFiles];
    list.sort((a, b) => {
      let comparison = 0;
      if (sortCriteria === 'NAME') {
        comparison = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      } else if (sortCriteria === 'DATE') {
        comparison = (a.timestamp || 0) - (b.timestamp || 0);
      } else if (sortCriteria === 'SIZE') {
        comparison = (a.size || 0) - (b.size || 0);
      }
      return sortDirection === 'ASC' ? comparison : -comparison;
    });
    return list;
  }, [filteredFiles, sortCriteria, sortDirection]);

  const isSearching = searchQuery.trim().length > 0;

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />

      {/* FIGMA BLUE HEADER (#016EEF) */}
      <View style={styles.header}>
        {/* Top row: [ < ]  ★ Favorites */}
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backBtn}
            activeOpacity={0.7}
            onPress={() => navigation?.navigate('Home')}>
            <Text style={styles.backIcon}>&lt;</Text>
          </TouchableOpacity>
          <View style={styles.brandContainer}>
            <Text style={styles.brandStar}>★</Text>
            <Text style={styles.brandTitle}>Favorites</Text>
          </View>
        </View>

        {/* WHITE SEARCH PILL */}
        <View style={styles.searchBarContainer}>
          <SearchOutlineIcon size={18} color={FigmaTheme.colors.primary} />
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

        {/* BREADCRUMBS ROW (📱 Internal storage) */}
        <View style={styles.breadcrumbsBar}>
          <View style={styles.breadcrumbContent}>
            <PhoneOutlineIcon size={14} color="#FFFFFF" />
            <Text style={styles.breadcrumbText}>Internal storage</Text>
          </View>
        </View>

        {/* CATEGORY TABS BAR INSIDE BLUE HEADER */}
        <View style={styles.categoryTabsBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryTabsContent}>
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
              const isActive = selectedTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.categoryTabChip, isActive && styles.categoryTabChipActive]}
                  activeOpacity={0.75}
                  onPress={() => setSelectedTab(tab.key)}>
                  <Text style={[styles.categoryTabChipText, isActive && styles.categoryTabChipTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>

      {/* OVERLAPPING WHITE CONTENT SHEET */}
      <View
        style={[
          styles.sheetContainer,
          { borderTopLeftRadius: selectedTab === 'ALL' ? 0 : 20 },
        ]}>
        {/* CASE 1: SEARCH WITH NO RESULTS */}
        {isSearching && sortedFiles.length === 0 ? (
          <View style={styles.emptySearchCard}>
            <View style={styles.emptyIconCircle}>
              <SearchOutlineIcon size={26} color={FigmaTheme.colors.primary} />
            </View>
            <Text style={styles.emptySearchTitle}>No results for "{searchQuery}"</Text>
            <Text style={styles.emptySearchSubtitle}>
              Check the spelling, or try a different file type.
            </Text>
            <TouchableOpacity
              style={styles.clearSearchBtn}
              activeOpacity={0.8}
              onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearchBtnText}>Clear search</Text>
            </TouchableOpacity>
          </View>
        ) : !isSearching && starredFiles.length === 0 ? (
          /* CASE 2: EMPTY FAVOURITES STATE (Figma Screen 15) */
          <View style={styles.emptyFavouritesCard}>
            <View style={styles.emptyIconCircle}>
              <StarOutlineIcon size={28} color={FigmaTheme.colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>No favourites yet</Text>
            <Text style={styles.emptySubtitle}>
              Add a file to favourites from its menu to keep it here.
            </Text>

            <TouchableOpacity
              style={styles.browseFilesBtn}
              activeOpacity={0.8}
              onPress={() => navigation?.navigate('Browse')}>
              <Text style={styles.browseFilesBtnText}>Browse files</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* CASE 3: POPULATED FAVOURITES LIST */
          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {/* COUNT & SORT BAR OR SELECTION TOP BAR */}
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
                  {sortedFiles.length} {sortedFiles.length === 1 ? 'favourite' : 'favourites'}
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

            {/* LIST OF FAVOURITES */}
            <View style={styles.favouritesListCard}>
              {sortedFiles.map((file, idx, arr) => {
                const badge = getBadgeForFile(file.name);
                const isSelected = selectedPaths.has(file.path);
                const isLast = idx === arr.length - 1;

                return (
                  <View
                    key={`${file.path}-${idx}`}
                    style={[
                      styles.favouriteRow,
                      !isLast && styles.favouriteRowDivider,
                      isSelected && styles.favouriteRowSelected,
                    ]}>
                    {/* Selection Checkbox */}
                    {isSelectionMode && (
                      <TouchableOpacity
                        style={styles.checkboxTouchBox}
                        activeOpacity={0.7}
                        onPress={() => handleToggleSelect(file.path)}>
                        <SelectionCheckbox selected={isSelected} size={20} />
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      style={styles.favouriteRowContent}
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
                      <View style={styles.favouriteMetaBox}>
                        <Text style={styles.favouriteFileName} numberOfLines={1}>
                          {file.name}
                        </Text>
                        <Text style={styles.favouriteFileSub}>
                          {badge.label} · {formatBytes(file.size)}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Non-selection Actions */}
                    {!isSelectionMode && (
                      <>
                        {/* Purple Star Icon (Figma #7C3AED) */}
                        <TouchableOpacity
                          activeOpacity={0.7}
                          hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                          onPress={() => handleToggleStar(file)}>
                          <Text style={styles.starPurpleIcon}>★</Text>
                        </TouchableOpacity>

                        {/* 3-Dot Action Menu */}
                        <TouchableOpacity
                          style={styles.moreActionBtn}
                          activeOpacity={0.7}
                          hitSlop={{ top: 12, bottom: 12, left: 10, right: 12 }}
                          onPress={() =>
                            setActionMenuFile({
                              name: file.name,
                              path: file.path,
                              size: file.size || 0,
                              lastModified: file.timestamp,
                              category: file.category,
                              isStarred: true,
                            })
                          }>
                          <Text style={styles.moreActionDots}>⋮</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={{ height: 100 }} />
          </ScrollView>
        )}
      </View>

      {/* BOTTOM DOCKED BAR IN SELECTION MODE */}
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
            onPress={handleBulkRemoveStarred}>
            <StarOutlineIcon size={20} color="#EF4444" />
            <Text style={[styles.selectionDockText, { color: '#EF4444' }]}>
              {selectedPaths.size > 1 ? `Remove (${selectedPaths.size})` : 'Remove'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SORT BOTTOM SHEET */}
      <SortBottomSheet
        visible={isSortSheetVisible}
        criteria={sortCriteria}
        direction={sortDirection}
        onSelectCriteria={(c) => setSortCriteria(c)}
        onSelectDirection={(d) => setSortDirection(d)}
        onClose={() => setIsSortSheetVisible(false)}
      />

      {/* ACTION MENU MODAL */}
      <FileActionMenuModal
        visible={actionMenuFile !== null}
        file={actionMenuFile}
        onClose={() => setActionMenuFile(null)}
        onOpen={(f) => handleOpenFile({ name: f.name, path: f.path, size: f.size, category: f.category || 'UNKNOWN' })}
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

      {/* FILE INFORMATION MODAL */}
      <FileInformationModal
        visible={infoModalFile !== null}
        file={infoModalFile}
        onClose={() => setInfoModalFile(null)}
        onOpen={(f) => handleOpenFile({ name: f.name, path: f.path, size: f.size, category: f.category || 'UNKNOWN' })}
        onShare={(f) => engine.shareFile(f.path)}
      />

      {/* VIEWERS MODAL */}
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
    backgroundColor: FigmaTheme.colors.headerBlue,
  },
  viewerWrapper: {
    flex: 1,
    backgroundColor: '#016EEF',
    paddingTop: 0,
  },

  // 1. Blue Header (#016EEF)
  header: {
    backgroundColor: FigmaTheme.colors.headerBlue,
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
  brandStar: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },

  // Search Bar (White Pill 50px, border radius 25)
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 25,
    paddingHorizontal: 20,
    height: 50,
    marginBottom: 14,
    ...FigmaTheme.shadows.card,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
    paddingVertical: 0,
    marginLeft: 12,
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
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    marginTop: -1,
  },

  // Breadcrumbs Row
  breadcrumbsBar: {
    marginBottom: 14,
  },
  breadcrumbContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breadcrumbText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Category Tabs inside blue header
  categoryTabsBar: {
    backgroundColor: 'transparent',
    paddingTop: 2,
    paddingBottom: 0,
  },
  categoryTabsContent: {
    gap: 8,
    paddingRight: 16,
    alignItems: 'flex-end',
  },
  categoryTabChip: {
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 18,
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
    color: FigmaTheme.colors.primary,
    fontWeight: '700',
  },

  // Overlapping White Content Sheet
  sheetContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopRightRadius: 20,
    marginTop: 0,
    overflow: 'hidden',
  },

  // Count & Sort
  countAndSortBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  itemCountText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
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
    paddingBottom: 20,
  },

  // Favourites List Card
  favouritesListCard: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  favouriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  favouriteRowSelected: {
    backgroundColor: '#EFF6FF',
  },
  checkboxTouchBox: {
    paddingRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favouriteRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  favouriteRowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  favouriteMetaBox: {
    flex: 1,
    marginLeft: 12,
  },
  favouriteFileName: {
    fontSize: 14.5,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 3,
  },
  favouriteFileSub: {
    fontSize: 12,
    color: '#64748B',
  },
  starPurpleIcon: {
    fontSize: 18,
    color: '#7C3AED',
    marginRight: 10,
  },
  moreActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  moreActionDots: {
    fontSize: 18,
    fontWeight: '800',
    color: '#64748B',
  },

  // Empty Favourites State (Figma Screen 15)
  emptyFavouritesCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    maxWidth: 280,
  },
  browseFilesBtn: {
    backgroundColor: FigmaTheme.colors.primary,
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 36,
    justifyContent: 'center',
    alignItems: 'center',
    ...FigmaTheme.shadows.card,
  },
  browseFilesBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Empty Search State
  emptySearchCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 60,
  },
  emptySearchTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySearchSubtitle: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 20,
    maxWidth: 260,
  },
  clearSearchBtn: {
    borderWidth: 1.5,
    borderColor: FigmaTheme.colors.primary,
    paddingHorizontal: 22,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  clearSearchBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  // Selection Mode Styles
  selectionTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
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
    color: '#64748B',
  },
  selectionCountText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  selectAllText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#016EEF',
  },
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
});

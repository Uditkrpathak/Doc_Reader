import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Dimensions,
  StatusBar,
  Modal,
  TextInput,
  ViewToken,
  Platform,
} from 'react-native';
import { NativeModules } from 'react-native';
import { PasswordModal } from '../components/PasswordModal';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { MMKV } from '../services/MMKV';
import { FigmaTheme } from '../theme/FigmaTheme';
import {
  SearchOutlineIcon,
  ZoomInIcon,
  ZoomOutIcon,
  DocListOutlineIcon,
  WarningTriangleIcon,
} from '../components/AppIcons';

const { ArchiveModule } = NativeModules;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PdfViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

interface SearchMatch {
  pageIndex: number;
  matchIndex: number;
  snippet: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Single virtualized PDF page item
const PdfPageItem = memo(({
  pageIndex,
  filePath,
  pageWidth,
  isNightMode,
  isSearchMode,
  pageMatches,
  currentMatchIdx,
}: {
  pageIndex: number;
  filePath: string;
  pageWidth: number;
  isNightMode: boolean;
  isSearchMode: boolean;
  pageMatches: SearchMatch[];
  currentMatchIdx: number;
}) => {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number>(1.414);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    setHasError(false);

    ArchiveModule.renderPdfPage(filePath, pageIndex, Math.round(pageWidth * 2))
      .then((res: any) => {
        if (!isMounted) return;
        if (res?.imagePath) {
          setImageUri(res.imagePath);
          if (res.width && res.height && res.width > 0) {
            setAspectRatio(res.height / res.width);
          }
        }
        setIsLoading(false);
      })
      .catch((err: any) => {
        if (!isMounted) return;
        console.warn(`Error rendering PDF page ${pageIndex + 1}:`, err);
        setHasError(true);
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [filePath, pageIndex, pageWidth]);

  const pageHeight = Math.round(pageWidth * aspectRatio);
  const hasMatches = isSearchMode && pageMatches.length > 0;

  return (
    <View
      style={[
        styles.pageCard,
        {
          width: pageWidth,
          minHeight: pageHeight,
          backgroundColor: isNightMode ? '#1E293B' : '#FFFFFF',
          borderColor: hasMatches ? '#F59E0B' : isNightMode ? '#334155' : '#E2E8F0',
          borderWidth: hasMatches ? 2 : 1,
        },
      ]}>
      {isLoading && (
        <View style={[styles.pagePlaceholder, { height: pageHeight }]}>
          <ActivityIndicator size="small" color={isNightMode ? '#38BDF8' : FigmaTheme.colors.primary} />
          <Text style={[styles.placeholderText, isNightMode && styles.textMutedNight]}>
            Loading Page {pageIndex + 1}...
          </Text>
        </View>
      )}

      {hasError && !isLoading && (
        <View style={[styles.pagePlaceholder, { height: pageHeight }]}>
          <Text style={styles.errorIconSmall}>⚠️</Text>
          <Text style={[styles.placeholderText, isNightMode && styles.textMutedNight]}>
            Could not render page {pageIndex + 1}
          </Text>
        </View>
      )}

      {imageUri && (
        <Image
          source={{ uri: imageUri }}
          style={[
            styles.pageImage,
            { width: pageWidth, height: pageHeight },
            isNightMode && styles.imageNight,
          ]}
          resizeMode="contain"
          onLoadEnd={() => setIsLoading(false)}
        />
      )}

      {/* In-Place Yellow Text Highlights matching Figma Screen 2 */}
      {isSearchMode &&
        pageMatches.map((m) => {
          const isActive = m.matchIndex === currentMatchIdx;
          return (
            <View
              key={`match-rect-${m.matchIndex}`}
              pointerEvents="none"
              style={[
                styles.highlightBox,
                {
                  left: `${m.x}%`,
                  top: `${m.y}%`,
                  width: `${m.width}%`,
                  height: `${m.height}%`,
                  backgroundColor: isActive ? '#FDE047' : 'rgba(254, 240, 138, 0.70)',
                  borderWidth: isActive ? 1.5 : 0,
                  borderColor: '#B45309',
                },
              ]}
            />
          );
        })}
    </View>
  );
});

export const PdfViewer: React.FC<PdfViewerProps> = ({ filePath, fileName, onClose }) => {
  const [pageCount, setPageCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState<boolean>(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Real Search Mode State (Figma Screen 2)
  const [isSearchMode, setIsSearchMode] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [totalMatches, setTotalMatches] = useState<number>(0);
  const [matchingPages, setMatchingPages] = useState<number[]>([]);
  const [matchesList, setMatchesList] = useState<SearchMatch[]>([]);
  const [pageMatchCounts, setPageMatchCounts] = useState<{ [page: number]: number }>({});
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Jump to page modal state
  const [showJumpModal, setShowJumpModal] = useState<boolean>(false);
  const [jumpPageInput, setJumpPageInput] = useState<string>('');
  const [isNightMode, setIsNightMode] = useState<boolean>(false);
  const [zoomScale, setZoomScale] = useState<number>(1.0);

  // Action Menu Popover
  const [showActionMenu, setShowActionMenu] = useState<boolean>(false);

  const flatListRef = useRef<FlatList<any>>(null);
  const searchDebounceRef = useRef<any>(null);
  const engine = ArchiveEngine.getInstance();

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const loadPdf = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setPasswordError(null);

    try {
      const info = await ArchiveModule.getPdfInfo(filePath);
      if (info.status === 'PASSWORD_REQUIRED') {
        setIsPasswordModalVisible(true);
        setIsLoading(false);
        return;
      }
      if (info.status === 'ERROR') {
        setErrorMsg(info.error || 'Corrupted or unreadable PDF document.');
        setIsLoading(false);
        return;
      }

      const total = info.pageCount || 0;
      setPageCount(total);
      if (info.fileSize) {
        setFileSizeBytes(info.fileSize);
      }

      // Restore last read position
      const lastPos = MMKV.getPosition(filePath);
      const startPage =
        lastPos && lastPos.page !== undefined && lastPos.page < total ? lastPos.page : 0;
      setCurrentPage(startPage);

      if (startPage > 0) {
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index: startPage, animated: false });
        }, 150);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize PDF renderer.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPdf();
  }, [filePath]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems && viewableItems.length > 0) {
        const visibleIdx = viewableItems[0].index;
        if (visibleIdx !== null && visibleIdx !== undefined && visibleIdx !== currentPage) {
          setCurrentPage(visibleIdx);
          if (pageCount > 0) {
            MMKV.savePosition(filePath, { page: visibleIdx, total: pageCount });
          }
        }
      }
    },
    [currentPage, pageCount, filePath]
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
  }).current;

  // Real PDF search execution via Native Module
  const executeSearch = useCallback((query: string) => {
    const q = query.trim();
    if (!q) {
      setTotalMatches(0);
      setMatchingPages([]);
      setMatchesList([]);
      setPageMatchCounts({});
      setCurrentMatchIdx(0);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    ArchiveModule.searchPdfText(filePath, q)
      .then((res: any) => {
        const total = res.totalMatches || 0;
        const pages: number[] = res.matchingPages || [];
        const matches: SearchMatch[] = res.matches || [];
        const countsMap: { [page: number]: number } = {};

        if (res.pageMatchCounts && Array.isArray(res.pageMatchCounts)) {
          res.pageMatchCounts.forEach((item: any) => {
            countsMap[item.pageIndex] = item.count;
          });
        }

        setTotalMatches(total);
        setMatchingPages(pages);
        setMatchesList(matches);
        setPageMatchCounts(countsMap);
        setCurrentMatchIdx(total > 0 ? 0 : -1);

        if (matches.length > 0) {
          const targetPage = matches[0].pageIndex;
          setCurrentPage(targetPage);
          flatListRef.current?.scrollToIndex({ index: targetPage, animated: true });
        }
      })
      .catch((err: any) => {
        console.warn('Real PDF search error:', err);
        setTotalMatches(0);
        setMatchingPages([]);
        setMatchesList([]);
        setPageMatchCounts({});
        setCurrentMatchIdx(-1);
      })
      .finally(() => {
        setIsSearching(false);
      });
  }, [filePath]);

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }
    searchDebounceRef.current = setTimeout(() => {
      executeSearch(text);
    }, 200);
  };

  const handleNextMatch = () => {
    if (matchesList.length === 0) return;
    const nextIdx = (currentMatchIdx + 1) % matchesList.length;
    setCurrentMatchIdx(nextIdx);
    const targetPage = matchesList[nextIdx].pageIndex;
    setCurrentPage(targetPage);
    flatListRef.current?.scrollToIndex({ index: targetPage, animated: true });
  };

  const handlePrevMatch = () => {
    if (matchesList.length === 0) return;
    const prevIdx = (currentMatchIdx - 1 + matchesList.length) % matchesList.length;
    setCurrentMatchIdx(prevIdx);
    const targetPage = matchesList[prevIdx].pageIndex;
    setCurrentPage(targetPage);
    flatListRef.current?.scrollToIndex({ index: targetPage, animated: true });
  };

  const handleJumpSubmit = () => {
    const p = parseInt(jumpPageInput.trim(), 10);
    if (!isNaN(p) && p >= 1 && p <= pageCount) {
      const targetIndex = p - 1;
      setCurrentPage(targetIndex);
      flatListRef.current?.scrollToIndex({ index: targetIndex, animated: true });
      setShowJumpModal(false);
      setJumpPageInput('');
    }
  };

  const handleShare = async () => {
    try {
      await engine.shareFile(filePath, 'application/pdf');
    } catch (err) {
      console.warn('PDF Share error', err);
    }
  };

  const pageWidth = Math.round((SCREEN_WIDTH - 24) * zoomScale);
  const matchesOnCurrentPage = pageMatchCounts[currentPage] || 0;

  return (
    <View style={[styles.container, isNightMode && styles.containerNight]}>
      <StatusBar hidden={true} />

      {/* 1. TOP HEADER (FIGMA BLUE #016EEF, COMPACT STATUS-BAR SAFE) */}
      <View style={styles.header}>
        {isSearchMode ? (
          /* FIGMA SCREEN 2: PDF VIEWER — SEARCH HEADER */
          <View style={styles.searchHeaderRow}>
            {/* Back button from search */}
            <TouchableOpacity
              style={styles.backBtn}
              activeOpacity={0.7}
              onPress={() => {
                setIsSearchMode(false);
                setSearchQuery('');
                setTotalMatches(0);
                setMatchingPages([]);
                setPageMatchCounts({});
              }}>
              <Text style={styles.backIcon}>&lt;</Text>
            </TouchableOpacity>

            {/* White Search Pill */}
            <View style={styles.searchPillContainer}>
              <SearchOutlineIcon size={16} color={FigmaTheme.colors.primary} />
              <TextInput
                style={styles.searchPillInput}
                placeholder="Search..."
                placeholderTextColor="#64748B"
                value={searchQuery}
                onChangeText={handleSearchChange}
                autoFocus
                returnKeyType="search"
              />
              {isSearching ? (
                <ActivityIndicator size="small" color={FigmaTheme.colors.primary} style={{ marginLeft: 6 }} />
              ) : searchQuery.trim().length > 0 ? (
                <Text style={styles.searchMatchCountText}>
                  {totalMatches > 0 ? `${currentMatchIdx + 1} of ${totalMatches}` : '0 of 0'}
                </Text>
              ) : null}
            </View>

            {/* Up / Down Navigation Buttons */}
            <View style={styles.searchNavArrows}>
              <TouchableOpacity
                style={styles.searchArrowBtn}
                activeOpacity={0.7}
                disabled={matchingPages.length === 0}
                onPress={handlePrevMatch}>
                <Text style={styles.searchArrowText}>∧</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.searchArrowBtn}
                activeOpacity={0.7}
                disabled={matchingPages.length === 0}
                onPress={handleNextMatch}>
                <Text style={styles.searchArrowText}>∨</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* FIGMA SCREEN 1: NORMAL VIEWER HEADER */
          <View style={styles.headerTopRow}>
            {/* Oval Back Button */}
            <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.backIcon}>&lt;</Text>
            </TouchableOpacity>

            {/* File info (Title + Subtitle) */}
            <View style={styles.headerInfoCol}>
              <Text style={styles.fileName} numberOfLines={1}>
                {fileName}
              </Text>
              <Text style={styles.fileSubtitle}>
                {`PDF · ${formatBytes(fileSizeBytes)}`}
              </Text>
            </View>

            {/* White Circular Action Menu Button [ ⋮ ] */}
            <TouchableOpacity
              style={styles.actionMenuBtn}
              activeOpacity={0.7}
              onPress={() => setShowActionMenu(true)}>
              <Text style={styles.actionMenuDots}>⋮</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* 2. MAIN CONTENT AREA */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={FigmaTheme.colors.primary} />
          <Text style={[styles.loadingText, isNightMode && styles.textLight]}>
            Loading PDF Document...
          </Text>
        </View>
      ) : errorMsg ? (
        /* FIGMA SCREEN 6: PDF CANNOT DISPLAY ERROR STATE */
        <View style={styles.errorContainer}>
          <View style={styles.errorIconCircle}>
            <WarningTriangleIcon size={30} color="#EA580C" innerColor="#FFF7ED" />
          </View>
          <Text style={styles.errorHeading}>Some content can't be shown</Text>
          <Text style={styles.errorSubheading}>
            This PDF uses features that aren't supported here. You can still share the original file.
          </Text>

          <TouchableOpacity
            style={styles.errorShareBtn}
            activeOpacity={0.8}
            onPress={handleShare}>
            <Text style={styles.errorShareBtnText}>Share file</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.errorBackBtn}
            activeOpacity={0.8}
            onPress={onClose}>
            <Text style={styles.errorBackBtnText}>Back to files</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* PDF DOCUMENT CANVAS WITH FLOATING PILLS */
        <View style={styles.viewportContainer}>
          {/* Top Floating Page Indicator Pill (Figma Screen 1 & 2) */}
          {pageCount > 0 && !isSearchMode && (
            <TouchableOpacity
              style={styles.topFloatingPill}
              activeOpacity={0.8}
              onPress={() => {
                setJumpPageInput(String(currentPage + 1));
                setShowJumpModal(true);
              }}>
              <Text style={styles.topFloatingPillText}>
                Page {currentPage + 1} of {pageCount}
              </Text>
            </TouchableOpacity>
          )}

          {/* Top Floating Match Indicator in Search Mode (Figma Screen 2) */}
          {isSearchMode && searchQuery.trim().length > 0 && (
            <View style={styles.topSearchMatchPill}>
              <Text style={styles.topSearchMatchText}>
                {totalMatches === 0
                  ? 'No matches found'
                  : matchesOnCurrentPage > 0
                  ? `${matchesOnCurrentPage} matches on this page`
                  : '0 matches on this page'}
              </Text>
            </View>
          )}

          {/* Virtualized Pages FlatList */}
          <FlatList
            ref={flatListRef}
            data={Array.from({ length: pageCount }).map((_, i) => i)}
            keyExtractor={(idx) => `pdf-page-${idx}`}
            showsVerticalScrollIndicator={true}
            contentContainerStyle={styles.listContent}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            initialNumToRender={2}
            maxToRenderPerBatch={3}
            windowSize={5}
            removeClippedSubviews={true}
            onScrollToIndexFailed={(info) => {
              const itemHeight = Math.round(pageWidth * 1.414) + 8;
              flatListRef.current?.scrollToOffset({
                offset: info.index * itemHeight,
                animated: true,
              });
              setTimeout(() => {
                flatListRef.current?.scrollToIndex({ index: info.index, animated: true });
              }, 120);
            }}
            renderItem={({ item: pageIdx }) => {
              const pageMatches = matchesList.filter((m) => m.pageIndex === pageIdx);
              return (
                <PdfPageItem
                  pageIndex={pageIdx}
                  filePath={filePath}
                  pageWidth={pageWidth}
                  isNightMode={isNightMode}
                  isSearchMode={isSearchMode}
                  pageMatches={pageMatches}
                  currentMatchIdx={currentMatchIdx}
                />
              );
            }}
          />

          {/* 3. FIGMA FLOATING BOTTOM TOOLBAR (#0D084C) */}
          {pageCount > 0 && (
            <View style={styles.bottomToolbarContainer}>
              <View style={styles.darkBottomToolbar}>
                {/* 1. Search */}
                <TouchableOpacity
                  style={styles.toolbarBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  onPress={() => setIsSearchMode(true)}>
                  <SearchOutlineIcon size={19} color="#FFFFFF" />
                </TouchableOpacity>

                {/* 2. Zoom Out */}
                <TouchableOpacity
                  style={styles.toolbarBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  disabled={zoomScale <= 0.75}
                  onPress={() => setZoomScale((s) => Math.max(0.75, Number((s - 0.15).toFixed(2))))}>
                  <ZoomOutIcon size={19} color="#FFFFFF" />
                </TouchableOpacity>

                {/* 3. Zoom In */}
                <TouchableOpacity
                  style={styles.toolbarBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  disabled={zoomScale >= 2.0}
                  onPress={() => setZoomScale((s) => Math.min(2.0, Number((s + 0.15).toFixed(2))))}>
                  <ZoomInIcon size={19} color="#FFFFFF" />
                </TouchableOpacity>

                {/* Thin vertical separator */}
                <View style={styles.toolbarDivider} />

                {/* 4. Document / TOC / Jump */}
                <TouchableOpacity
                  style={styles.toolbarBtn}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  onPress={() => {
                    setJumpPageInput(String(currentPage + 1));
                    setShowJumpModal(true);
                  }}>
                  <DocListOutlineIcon size={19} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* JUMP TO PAGE MODAL */}
      <Modal visible={showJumpModal} transparent animationType="fade" onRequestClose={() => setShowJumpModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.jumpCard}>
            <Text style={styles.jumpTitle}>Jump to Page</Text>
            <Text style={styles.jumpSubtitle}>Enter page number (1 to {pageCount}):</Text>

            <TextInput
              style={styles.jumpInput}
              keyboardType="number-pad"
              autoFocus
              value={jumpPageInput}
              onChangeText={setJumpPageInput}
              placeholder={`1 - ${pageCount}`}
              placeholderTextColor="#94A3B8"
            />

            <View style={styles.jumpBtnRow}>
              <TouchableOpacity
                style={styles.jumpCancelBtn}
                activeOpacity={0.7}
                onPress={() => setShowJumpModal(false)}>
                <Text style={styles.jumpCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.jumpGoBtn}
                activeOpacity={0.8}
                onPress={handleJumpSubmit}>
                <Text style={styles.jumpGoText}>Go</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 3-DOTS ACTION MENU POPOVER */}
      <Modal visible={showActionMenu} transparent animationType="fade" onRequestClose={() => setShowActionMenu(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowActionMenu(false)}>
          <View style={styles.menuPopover}>
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => {
                setShowActionMenu(false);
                setJumpPageInput(String(currentPage + 1));
                setShowJumpModal(true);
              }}>
              <Text style={styles.menuRowText}>📄  Jump to page</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => {
                setShowActionMenu(false);
                handleShare();
              }}>
              <Text style={styles.menuRowText}>📤  Share PDF</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => {
                setShowActionMenu(false);
                setIsNightMode(!isNightMode);
              }}>
              <Text style={styles.menuRowText}>
                {isNightMode ? '☀️  Light mode' : '🌙  Dark mode'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* PASSWORD PROTECTION MODAL (Figma Screen 3, 4, 5) */}
      <PasswordModal
        visible={isPasswordModalVisible}
        fileName={fileName}
        errorMsg={passwordError}
        isLoading={isLoading}
        onUnlock={(_pwd) => loadPdf()}
        onCancel={() => {
          setIsPasswordModalVisible(false);
          onClose();
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  containerNight: {
    backgroundColor: '#0F172A',
  },

  // 1. Blue Header (#016EEF) - Compact Status-Bar Safe
  header: {
    backgroundColor: FigmaTheme.colors.headerBlue,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 34,
    height: 40,
    borderRadius: 14,
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
  headerInfoCol: {
    flex: 1,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  fileSubtitle: {
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.82)',
    marginTop: 1,
    fontWeight: '500',
  },
  actionMenuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    ...FigmaTheme.shadows.card,
  },
  actionMenuDots: {
    fontSize: 18,
    fontWeight: '800',
    color: FigmaTheme.colors.primary,
    marginTop: -2,
  },

  // Search Header in Screen 2
  searchHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchPillContainer: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  searchPillInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    marginLeft: 8,
    paddingVertical: 0,
  },
  searchMatchCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginLeft: 6,
  },
  searchNavArrows: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchArrowBtn: {
    width: 32,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchArrowText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },

  // 2. Viewport & Canvas
  viewportContainer: {
    flex: 1,
    position: 'relative',
  },
  listContent: {
    paddingTop: 36,
    paddingBottom: 88,
    alignItems: 'center',
  },

  // Floating Page Indicator Pills - Centered top with minimal gap
  topFloatingPill: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    zIndex: 10,
    ...FigmaTheme.shadows.card,
  },
  topFloatingPillText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#64748B',
  },
  topSearchMatchPill: {
    position: 'absolute',
    top: 8,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    zIndex: 10,
    ...FigmaTheme.shadows.card,
  },
  topSearchMatchText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },

  // Page Card with minimal vertical margin
  pageCard: {
    marginVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    ...FigmaTheme.shadows.card,
  },
  highlightBox: {
    position: 'absolute',
    borderRadius: 3,
    zIndex: 10,
  },
  pagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  placeholderText: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748B',
  },
  errorIconSmall: {
    fontSize: 24,
  },
  pageImage: {
    backgroundColor: '#FFFFFF',
  },
  imageNight: {
    opacity: 0.9,
  },
  textMutedNight: {
    color: '#94A3B8',
  },
  textLight: {
    color: '#F8FAFC',
  },

  // 3. Figma Floating Bottom Toolbar (#0D084C)
  bottomToolbarContainer: {
    position: 'absolute',
    bottom: Platform.OS === 'android' ? 24 : 34,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },
  darkBottomToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D084C', // Exact color requested
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 16,
    gap: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 10,
  },
  toolbarBtn: {
    paddingHorizontal: 12,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolbarDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    marginHorizontal: 4,
  },

  // Center / Loading / Error
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 14,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '600',
  },

  // Screen 6: Cannot Display
  errorContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  errorHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubheading: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    maxWidth: 280,
  },
  errorShareBtn: {
    backgroundColor: FigmaTheme.colors.primary,
    height: 48,
    borderRadius: 12,
    width: '100%',
    maxWidth: 280,
    justifyContent: 'center',
    alignItems: 'center',
    ...FigmaTheme.shadows.card,
  },
  errorShareBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBackBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: FigmaTheme.colors.primary,
    height: 48,
    borderRadius: 12,
    width: '100%',
    maxWidth: 280,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  errorBackBtnText: {
    color: FigmaTheme.colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },

  // Modals & Popovers
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  jumpCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 22,
    ...FigmaTheme.shadows.card,
  },
  jumpTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  jumpSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 16,
  },
  jumpInput: {
    height: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 20,
  },
  jumpBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  jumpCancelBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1.2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  jumpCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  jumpGoBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    backgroundColor: FigmaTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  jumpGoText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  menuPopover: {
    position: 'absolute',
    top: 50,
    right: 16,
    width: 200,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 6,
    ...FigmaTheme.shadows.card,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  menuRow: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  menuRowText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
});

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  SafeAreaView,
  StatusBar,
  Modal,
  TextInput,
} from 'react-native';
import { NativeModules } from 'react-native';
import { PasswordModal } from '../components/PasswordModal';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { MMKV } from '../services/MMKV';

const { ArchiveModule } = NativeModules;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface PdfViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ filePath, fileName, onClose }) => {
  const [pageCount, setPageCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [currentPageUri, setCurrentPageUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState<boolean>(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  
  // Jump to page modal state
  const [showJumpModal, setShowJumpModal] = useState<boolean>(false);
  const [jumpPageInput, setJumpPageInput] = useState<string>('');
  const [isNightMode, setIsNightMode] = useState<boolean>(false);

  const engine = ArchiveEngine.getInstance();

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

      setPageCount(info.pageCount);
      // Restore last read position (Master PRD Section 2.2)
      const lastPos = MMKV.getPosition(filePath);
      const startPage = lastPos && lastPos.page !== undefined && lastPos.page < info.pageCount ? lastPos.page : 0;
      setCurrentPage(startPage);
      await renderPage(startPage, info.pageCount);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to initialize PDF renderer.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderPage = async (pageIdx: number, totalOverride?: number) => {
    setIsLoading(true);
    try {
      // High-res rendering (screen width * 2) for crisp fonts and emojis
      const renderRes = await ArchiveModule.renderPdfPage(filePath, pageIdx, SCREEN_WIDTH * 2);
      setCurrentPageUri(renderRes.imagePath);
      setCurrentPage(pageIdx);
      // Persist last read page for continue reading
      const total = totalOverride || pageCount;
      if (total > 0) {
        MMKV.savePosition(filePath, { page: pageIdx, total });
      }
    } catch (err: any) {
      setErrorMsg(`Page render error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPdf();
  }, [filePath]);

  const handleNextPage = () => {
    if (currentPage < pageCount - 1) {
      renderPage(currentPage + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 0) {
      renderPage(currentPage - 1);
    }
  };

  const handleSliderTap = (event: any) => {
    if (pageCount <= 1) return;
    const clickX = event.nativeEvent.locationX;
    const barWidth = SCREEN_WIDTH - 150;
    const ratio = Math.max(0, Math.min(1, clickX / barWidth));
    const targetPage = Math.min(pageCount - 1, Math.floor(ratio * pageCount));
    if (targetPage !== currentPage) {
      renderPage(targetPage);
    }
  };

  const handleJumpSubmit = () => {
    const p = parseInt(jumpPageInput.trim(), 10);
    if (!isNaN(p) && p >= 1 && p <= pageCount) {
      renderPage(p - 1);
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

  const progressPercent = pageCount > 0 ? ((currentPage + 1) / pageCount) * 100 : 0;

  return (
    <SafeAreaView style={[styles.container, isNightMode && styles.containerNight]}>
      <StatusBar
        barStyle={isNightMode ? 'light-content' : 'dark-content'}
        backgroundColor={isNightMode ? '#0f172a' : '#ffffff'}
      />

      {/* Clean Top Header */}
      <View style={[styles.header, isNightMode && styles.headerNight]}>
        <View style={styles.headerLeft}>
          <Text style={[styles.fileName, isNightMode && styles.textLight]} numberOfLines={1}>
            📕 {fileName}
          </Text>
          <Text style={[styles.pageIndicator, isNightMode && styles.textMutedNight]}>
            {pageCount > 0 ? `Page ${currentPage + 1} of ${pageCount} (${Math.round(progressPercent)}%)` : 'Loading...'}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.nightToggleBtn, isNightMode && styles.nightToggleBtnActive]}
            onPress={() => setIsNightMode(!isNightMode)}
            activeOpacity={0.7}>
            <Text style={[styles.nightToggleText, isNightMode && styles.textLight]}>
              {isNightMode ? '☀️ Day' : '🌙 Night'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
            <Text style={styles.shareBtnText}>📤 Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Page Viewport */}
      <View style={styles.viewportContainer}>
        {errorMsg ? (
          <View style={styles.centerBox}>
            <View style={styles.errorCard}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorTitle}>Cannot Open PDF</Text>
              <Text style={styles.errorDesc}>{errorMsg}</Text>
            </View>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsVerticalScrollIndicator={false}>
            {isLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#d93025" />
              </View>
            )}
            {currentPageUri && (
              <Image
                source={{ uri: currentPageUri }}
                style={{
                  width: SCREEN_WIDTH - 24,
                  height: (SCREEN_WIDTH - 24) * 1.414,
                  borderRadius: 6,
                }}
                resizeMode="contain"
              />
            )}
          </ScrollView>
        )}
      </View>

      {/* Interactive Bottom Page Slider Bar */}
      {pageCount > 1 && !errorMsg && (
        <View style={[styles.bottomBar, isNightMode && styles.bottomBarNight]}>
          <TouchableOpacity
            style={[styles.navBtn, currentPage <= 0 && styles.disabledBtn]}
            disabled={currentPage <= 0 || isLoading}
            onPress={handlePrevPage}>
            <Text style={styles.navBtnText}>◀</Text>
          </TouchableOpacity>

          {/* Interactive Page Scrubber Track */}
          <TouchableOpacity
            style={styles.sliderTrackWrapper}
            activeOpacity={1}
            onPress={handleSliderTap}>
            <View style={styles.sliderTrackBg}>
              <View style={[styles.sliderTrackFill, { width: `${progressPercent}%` }]} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.pageBadge}
            onPress={() => {
              setJumpPageInput(String(currentPage + 1));
              setShowJumpModal(true);
            }}>
            <Text style={styles.pageBadgeText}>
              {currentPage + 1}/{pageCount}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navBtn, currentPage >= pageCount - 1 && styles.disabledBtn]}
            disabled={currentPage >= pageCount - 1 || isLoading}
            onPress={handleNextPage}>
            <Text style={styles.navBtnText}>▶</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Jump to Page Modal */}
      <Modal
        visible={showJumpModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowJumpModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.jumpCard}>
            <Text style={styles.jumpTitle}>Jump to Page</Text>
            <Text style={styles.jumpSub}>Enter page between 1 and {pageCount}</Text>
            <TextInput
              style={styles.jumpInput}
              keyboardType="number-pad"
              value={jumpPageInput}
              onChangeText={setJumpPageInput}
              autoFocus={true}
              selectTextOnFocus={true}
            />
            <View style={styles.jumpBtnRow}>
              <TouchableOpacity
                style={styles.jumpCancelBtn}
                onPress={() => setShowJumpModal(false)}>
                <Text style={styles.jumpCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.jumpGoBtn}
                onPress={handleJumpSubmit}>
                <Text style={styles.jumpGoText}>Go</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Password Modal */}
      <PasswordModal
        visible={isPasswordModalVisible}
        fileName={fileName}
        errorMsg={passwordError}
        isLoading={isLoading}
        onUnlock={() => loadPdf()}
        onCancel={() => {
          setIsPasswordModalVisible(false);
          onClose();
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerLeft: {
    flex: 1,
    marginRight: 10,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  pageIndicator: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareBtn: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  shareBtnText: {
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  viewportContainer: {
    flex: 1,
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorCard: {
    backgroundColor: '#ffffff',
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fca5a5',
    alignItems: 'center',
    width: '100%',
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#b91c1c',
  },
  errorDesc: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
  },
  scrollContent: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  loadingOverlay: {
    position: 'absolute',
    top: '40%',
    zIndex: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    padding: 16,
    borderRadius: 12,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    gap: 8,
  },
  navBtn: {
    backgroundColor: '#f1f5f9',
    width: 38,
    height: 38,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.35,
  },
  navBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  sliderTrackWrapper: {
    flex: 1,
    paddingVertical: 10,
  },
  sliderTrackBg: {
    height: 6,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  sliderTrackFill: {
    height: '100%',
    backgroundColor: '#dc2626',
    borderRadius: 3,
  },
  pageBadge: {
    backgroundColor: '#fef2f2',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  pageBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#dc2626',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  jumpCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    elevation: 8,
  },
  jumpTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  jumpSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  jumpInput: {
    borderWidth: 1.5,
    borderColor: '#dc2626',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 16,
    textAlign: 'center',
  },
  jumpBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  jumpCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  jumpCancelText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '600',
  },
  jumpGoBtn: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  jumpGoText: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '700',
  },
  containerNight: {
    backgroundColor: '#121212',
  },
  headerNight: {
    backgroundColor: '#1e293b',
    borderBottomColor: '#334155',
  },
  bottomBarNight: {
    backgroundColor: '#1e293b',
    borderTopColor: '#334155',
  },
  nightToggleBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    marginRight: 6,
  },
  nightToggleBtnActive: {
    backgroundColor: '#334155',
  },
  nightToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0f172a',
  },
  textLight: {
    color: '#f8fafc',
  },
  textMutedNight: {
    color: '#94a3b8',
  },
});

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Modal,
  Platform,
  TextInput,
} from 'react-native';
import { NativeModules } from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { FigmaTheme } from '../theme/FigmaTheme';

const { ArchiveModule } = NativeModules;

interface TextViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export const TextViewer: React.FC<TextViewerProps> = ({ filePath, fileName, onClose }) => {
  const [content, setContent] = useState<string>('');
  const [currentOffset, setCurrentOffset] = useState<number>(0);
  const [totalFileSize, setTotalFileSize] = useState<number>(0);
  const [isEof, setIsEof] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [encoding, setEncoding] = useState<'UTF-8' | 'Windows-1252'>('UTF-8');

  // Text size state & modal (Figma Image 2)
  const [fontSize, setFontSize] = useState<number>(14);
  const [isTextSizeSheetVisible, setIsTextSizeSheetVisible] = useState<boolean>(false);

  // In-Document Search state (Figma Screen 8)
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Large file state (> 5MB warning, Figma Image 1)
  const [hasConfirmedLargeFile, setHasConfirmedLargeFile] = useState<boolean>(false);
  const [isLargeFile, setIsLargeFile] = useState<boolean>(false);

  // Encoding error state (Figma Image 1)
  const [isEncodingError, setIsEncodingError] = useState<boolean>(false);

  const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk
  const MAX_INITIAL_SAFE_SIZE = 5 * 1024 * 1024; // 5 MB

  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const isJson = ext === 'json';

  const checkIsBinary = (rawText: string): boolean => {
    if (!rawText || rawText.length === 0) return false;
    if (rawText.includes('\u0000') || rawText.includes('\uFFFD')) return true;
    const sample = rawText.slice(0, 1000);
    let suspiciousCount = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13) continue;
      if (code >= 32 && code <= 126) continue;
      if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
        suspiciousCount++;
      }
    }
    return suspiciousCount > 4;
  };

  const loadChunk = async (offset: number, append: boolean = false, targetEncoding: 'UTF-8' | 'Windows-1252' = encoding) => {
    setIsLoading(true);
    setErrorMsg(null);
    setIsEncodingError(false);

    try {
      const res = await ArchiveModule.readTextChunk(filePath, offset, CHUNK_SIZE, targetEncoding);
      const text = res.text || '';
      const fileSize = res.totalFileSize || 0;
      setTotalFileSize(fileSize);

      if (fileSize > MAX_INITIAL_SAFE_SIZE && !hasConfirmedLargeFile) {
        setIsLargeFile(true);
        setIsLoading(false);
        return;
      }

      if (offset === 0 && checkIsBinary(text)) {
        setIsEncodingError(true);
        setIsLoading(false);
        return;
      }

      const safeText = text.replace(/([^\n]{500})/g, '$1\n');

      if (append) {
        setContent((prev) => prev + safeText);
      } else {
        setContent(safeText || '');
        if (!safeText || safeText.trim().length === 0) {
          setIsEof(true);
        }
      }

      setCurrentOffset(res.nextOffset || (offset + res.bytesRead));
      setIsEof(res.isEof);
    } catch (err: any) {
      if (!append) {
        setContent('');
        setIsEof(true);
        setErrorMsg(`Text Read Error: ${err.message || String(err)}`);
        setIsEncodingError(true);
      } else {
        setErrorMsg(`Text Read Error: ${err.message || String(err)}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChunk(0, false, encoding);
  }, [filePath, encoding]);

  const handleShare = async () => {
    try {
      await ArchiveEngine.getInstance().shareFile(filePath, isJson ? 'application/json' : 'text/plain');
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Split lines for line numbers
  const lines = useMemo(() => {
    if (!content) return [];
    return content.split('\n');
  }, [content]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      {/* 1. FIGMA BLUE HEADER (#016EEF) */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleBox}>
          <Text style={styles.fileNameText} numberOfLines={1}>
            {fileName}
          </Text>
          <Text style={styles.subLineText}>
            {`${ext.toUpperCase() || 'TXT'} · ${formatFileSize(totalFileSize)} · ${encoding}`}
          </Text>
        </View>

        <TouchableOpacity style={styles.actionMenuBtn} onPress={handleShare} activeOpacity={0.7}>
          <Text style={styles.actionMenuDots}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* SEARCH BAR (Screen 8 In-Document Search) */}
      {isSearchOpen && (
        <View style={styles.searchBar}>
          <Text style={styles.searchBarIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search text..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
              <Text style={styles.clearSearchText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 2. ENCODING ERROR RECOVERY VIEW (Figma Image 1) */}
      {isEncodingError ? (
        <View style={styles.recoveryCenterBox}>
          <View style={styles.warningIconCircle}>
            <Text style={styles.warningIconEmoji}>⚠️</Text>
          </View>
          <Text style={styles.recoveryTitle}>This file's text can't be read</Text>
          <Text style={styles.recoverySubtitle}>
            It may use an encoding we couldn't detect. Try another one to display the contents correctly.
          </Text>

          <TouchableOpacity
            style={styles.primaryRecoveryBtn}
            activeOpacity={0.8}
            onPress={() => {
              setEncoding('UTF-8');
              loadChunk(0, false, 'UTF-8');
            }}>
            <Text style={styles.primaryRecoveryBtnText}>Try UTF-8</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryRecoveryBtn}
            activeOpacity={0.7}
            onPress={() => {
              setEncoding('Windows-1252');
              loadChunk(0, false, 'Windows-1252');
            }}>
            <Text style={styles.secondaryRecoveryBtnText}>Try Windows-1252</Text>
          </TouchableOpacity>
        </View>
      ) : isLargeFile && !hasConfirmedLargeFile ? (
        /* 3. LARGE FILE LIMIT RECOVERY VIEW (Figma Image 1 & 2) */
        <View style={styles.recoveryCenterBox}>
          <View style={styles.docIconCircle}>
            <Text style={styles.docIconEmoji}>📄</Text>
          </View>
          <Text style={styles.recoveryTitle}>This log is too large to open fully</Text>
          <Text style={styles.recoverySubtitle}>
            Showing the first 5 MB. Open the rest of the file or share it to another app.
          </Text>

          <TouchableOpacity
            style={styles.primaryRecoveryBtn}
            activeOpacity={0.8}
            onPress={() => {
              setHasConfirmedLargeFile(true);
              setIsLargeFile(false);
              loadChunk(0, false, encoding);
            }}>
            <Text style={styles.primaryRecoveryBtnText}>Show first 5 MB</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryRecoveryBtn}
            activeOpacity={0.7}
            onPress={handleShare}>
            <Text style={styles.secondaryRecoveryBtnText}>Share file</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* 4. CODE / TEXT VIEWER WITH LINE NUMBERS (Figma Image 1) */
        <View style={styles.viewportContainer}>
          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          )}
          {isLoading && content.length === 0 ? (
            <View style={styles.centerLoadingBox}>
              <ActivityIndicator color={FigmaTheme.colors.primary} size="large" />
              <Text style={styles.loadingText}>Reading text contents...</Text>
            </View>
          ) : (
            <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent}>
              <View style={styles.codeBlockRow}>
                {/* Line Numbers Column */}
                <View style={styles.lineNumbersColumn}>
                  {lines.map((_, idx) => (
                    <Text key={`line-num-${idx}`} style={[styles.lineNumberText, { fontSize, lineHeight: fontSize * 1.5 }]}>
                      {idx + 1}
                    </Text>
                  ))}
                </View>

                {/* Text / Code Column */}
                <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.horizontalScroll}>
                  <View style={styles.codeColumn}>
                    {lines.map((line, idx) => {
                      const isMatch =
                        searchQuery.trim().length > 0 &&
                        line.toLowerCase().includes(searchQuery.trim().toLowerCase());
                      return (
                        <View
                          key={`code-line-${idx}`}
                          style={[styles.codeLineWrapper, isMatch && styles.matchedLineWrapper]}>
                          <Text
                            style={[
                              styles.codeLineText,
                              isJson && styles.jsonCodeText,
                              isMatch && styles.matchedLineText,
                              { fontSize, lineHeight: fontSize * 1.5 },
                            ]}
                            selectable>
                            {line || ' '}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              {/* End of File or Load More */}
              {!isEof && (
                <TouchableOpacity
                  style={styles.loadMoreBtn}
                  activeOpacity={0.8}
                  disabled={isLoading}
                  onPress={() => loadChunk(currentOffset, true, encoding)}>
                  {isLoading ? (
                    <ActivityIndicator size="small" color={FigmaTheme.colors.primary} />
                  ) : (
                    <Text style={styles.loadMoreBtnText}>⬇ Load Next 64 KB</Text>
                  )}
                </TouchableOpacity>
              )}

              {isEof && <Text style={styles.eofFootnote}>— End of File ({lines.length} lines) —</Text>}
            </ScrollView>
          )}

          {/* 5. DARK FLOATING TOOLBAR: [ 🔍 | A- | A+ | T ] (Figma Screen 8: #0D084C) */}
          <View style={styles.darkToolbar}>
            <TouchableOpacity
              style={styles.darkToolbarBtn}
              activeOpacity={0.7}
              onPress={() => setIsSearchOpen(!isSearchOpen)}>
              <Text style={styles.darkToolbarIcon}>🔍</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.darkToolbarBtn}
              disabled={fontSize <= 10}
              activeOpacity={0.7}
              onPress={() => setFontSize((s) => Math.max(10, s - 2))}>
              <Text style={styles.darkToolbarIcon}>A−</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.darkToolbarBtn}
              disabled={fontSize >= 28}
              activeOpacity={0.7}
              onPress={() => setFontSize((s) => Math.min(28, s + 2))}>
              <Text style={styles.darkToolbarIcon}>A+</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.darkToolbarBtn}
              activeOpacity={0.7}
              onPress={() => setIsTextSizeSheetVisible(true)}>
              <Text style={styles.darkToolbarIcon}>T</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 6. TEXT SIZE BOTTOM SHEET (Figma Image 2) */}
      <Modal
        visible={isTextSizeSheetVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsTextSizeSheetVisible(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsTextSizeSheetVisible(false)}>
          <TouchableOpacity style={styles.textSizeSheet} activeOpacity={1}>
            <View style={styles.sheetHandleBar} />
            <Text style={styles.textSizeTitle}>Text size</Text>

            <View style={styles.textSizeControlRow}>
              <TouchableOpacity
                style={[styles.stepBtn, fontSize <= 10 && styles.stepBtnDisabled]}
                disabled={fontSize <= 10}
                onPress={() => setFontSize((s) => Math.max(10, s - 2))}>
                <Text style={styles.stepBtnText}>A−</Text>
              </TouchableOpacity>

              <Text style={styles.currentPtText}>{fontSize} pt</Text>

              <TouchableOpacity
                style={[styles.stepBtn, fontSize >= 28 && styles.stepBtnDisabled]}
                disabled={fontSize >= 28}
                onPress={() => setFontSize((s) => Math.min(28, s + 2))}>
                <Text style={styles.stepBtnText}>A+</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.previewBox}>
              <Text style={[styles.previewSampleText, { fontSize }]}>
                The quick brown fox jumps over the lazy dog.
              </Text>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
  fileNameText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  subLineText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 2,
  },
  actionMenuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  actionMenuDots: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 20,
  },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  searchBarIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 4,
  },
  clearSearchBtn: {
    padding: 6,
  },
  clearSearchText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '700',
  },
  codeLineWrapper: {
    paddingVertical: 1,
  },
  matchedLineWrapper: {
    backgroundColor: '#FEF9C3',
    borderRadius: 2,
  },
  matchedLineText: {
    color: '#854D0E',
    fontWeight: '700',
  },

  viewportContainer: {
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 90,
  },
  codeBlockRow: {
    flexDirection: 'row',
    paddingVertical: 12,
  },
  lineNumbersColumn: {
    width: 48,
    alignItems: 'flex-end',
    paddingRight: 12,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  lineNumberText: {
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    color: '#94A3B8',
  },
  horizontalScroll: {
    flex: 1,
  },
  codeColumn: {
    paddingLeft: 12,
    paddingRight: 20,
  },
  codeLineText: {
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    color: '#0F172A',
  },
  jsonCodeText: {
    color: '#0284C7',
  },
  loadMoreBtn: {
    alignSelf: 'center',
    marginVertical: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
  },
  loadMoreBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },
  eofFootnote: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 12,
    marginVertical: 14,
  },
  centerLoadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },

  // Dark Floating Pill Toolbar (Figma Screen 8: #0D084C)
  darkToolbar: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D084C',
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 28,
    gap: 22,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  darkToolbarBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  darkToolbarIcon: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

  // Recovery Views
  recoveryCenterBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#FFFFFF',
  },
  warningIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  warningIconEmoji: {
    fontSize: 30,
  },
  docIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  docIconEmoji: {
    fontSize: 30,
  },
  recoveryTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  recoverySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryRecoveryBtn: {
    width: '100%',
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryRecoveryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryRecoveryBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryRecoveryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  // Text Size Bottom Sheet (Figma Image 2)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  textSizeSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
  },
  sheetHandleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 18,
  },
  textSizeTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 20,
  },
  textSizeControlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 8,
    marginBottom: 18,
  },
  stepBtn: {
    width: 48,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    ...FigmaTheme.shadows.card,
  },
  stepBtnDisabled: {
    opacity: 0.4,
  },
  stepBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: FigmaTheme.colors.primary,
  },
  currentPtText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  previewBox: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    minHeight: 70,
    justifyContent: 'center',
  },
  previewSampleText: {
    color: '#334155',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 8,
    padding: 12,
    margin: 16,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
  },
});

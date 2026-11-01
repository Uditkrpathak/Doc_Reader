import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { NativeModules } from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';

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
  const [isBinary, setIsBinary] = useState<boolean>(false);
  const [forceShowBinary, setForceShowBinary] = useState<boolean>(false);

  const CHUNK_SIZE = 64 * 1024; // 64 KB per chunk

  const checkIsBinary = (rawText: string): boolean => {
    if (!rawText || rawText.length === 0) return false;
    // Check for null characters or Unicode replacement character (invalid UTF-8 bytes)
    if (rawText.includes('\u0000') || rawText.includes('\uFFFD')) return true;

    // Inspect sample of first 1000 characters
    const sample = rawText.slice(0, 1000);
    let suspiciousCount = 0;
    for (let i = 0; i < sample.length; i++) {
      const code = sample.charCodeAt(i);
      // Valid text whitespace: 9 (\t), 10 (\n), 13 (\r)
      if (code === 9 || code === 10 || code === 13) continue;
      // Printable ASCII: 32 - 126
      if (code >= 32 && code <= 126) continue;
      // Control characters or replacement characters
      if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
        suspiciousCount++;
      }
    }
    return suspiciousCount > 2;
  };

  const loadChunk = async (offset: number, append: boolean = false) => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await ArchiveModule.readTextChunk(filePath, offset, CHUNK_SIZE, 'UTF-8');
      const text = res.text || '';

      if (offset === 0 && checkIsBinary(text)) {
        setIsBinary(true);
      }
      
      // Safety guard: if a single line is ultra-long (> 5,000 chars without line breaks like sample_stress.log),
      // insert soft line breaks every 500 chars so React Native's layout engine doesn't freeze.
      const safeText = text.replace(/([^\n]{500})/g, '$1\n');

      if (append) {
        setContent((prev) => prev + safeText);
      } else {
        setContent(safeText);
      }

      setCurrentOffset(res.nextOffset || (offset + res.bytesRead));
      setTotalFileSize(res.totalFileSize || 0);
      setIsEof(res.isEof);
    } catch (err: any) {
      setErrorMsg(`Text Chunk Read Error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadChunk(0, false);
  }, [filePath]);

  const handleLoadMore = () => {
    if (!isEof && !isLoading) {
      loadChunk(currentOffset, true);
    }
  };

  const handleShare = async () => {
    try {
      await ArchiveEngine.getInstance().shareFile(filePath, 'text/plain');
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
          <Text style={styles.subText}>
            Plaintext Document • {(totalFileSize / 1024).toFixed(1)} KB
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
            <Text style={styles.shareBtnText}>📤 Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content */}
      <ScrollView style={styles.scrollArea} contentContainerStyle={styles.textContainer}>
        {isBinary && !forceShowBinary ? (
          <View style={styles.binaryCard}>
            <Text style={styles.binaryIcon}>📦</Text>
            <Text style={styles.binaryTitle}>Binary File Detected</Text>
            <Text style={styles.binaryDesc}>
              "{fileName}" contains non-text binary data (such as compiled code, Git index, or proprietary data structures). Rendering binary data as plain text causes corrupt replacement characters.
            </Text>
            <View style={styles.binaryMetaBox}>
              <Text style={styles.binaryMetaText}>📁 File Name: {fileName}</Text>
              <Text style={styles.binaryMetaText}>
                📊 File Size: {(totalFileSize / 1024).toFixed(1)} KB ({totalFileSize.toLocaleString()} bytes)
              </Text>
              <Text style={styles.binaryMetaText}>
                🔒 Security Guard: Plaintext parsing paused to prevent diamond characters
              </Text>
            </View>
            <TouchableOpacity
              style={styles.forceShowBtn}
              onPress={() => setForceShowBinary(true)}>
              <Text style={styles.forceShowBtnText}>👁️ Show Raw Plaintext Anyway</Text>
            </TouchableOpacity>
          </View>
        ) : errorMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Error Reading File</Text>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : (
          <Text style={styles.textDisplay} selectable>
            {content || (isLoading ? 'Loading stream...' : 'Empty document.')}
          </Text>
        )}

        {/* Load More Button */}
        {!isEof && (!isBinary || forceShowBinary) && (
          <View style={styles.loadMoreBox}>
            <TouchableOpacity
              style={[styles.loadMoreBtn, isLoading && styles.disabledBtn]}
              disabled={isLoading}
              onPress={handleLoadMore}>
              {isLoading ? (
                <ActivityIndicator color="#1a73e8" size="small" />
              ) : (
                <Text style={styles.loadMoreText}>⬇ Load Next 64 KB Chunk</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {isEof && content.length > 0 && (!isBinary || forceShowBinary) && (
          <Text style={styles.eofText}>— End of File (EOF) Reached —</Text>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    padding: 12,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
  },
  fileName: { fontSize: 15, fontWeight: '700', color: '#202124' },
  subText: { fontSize: 11, color: '#5f6368', marginTop: 2 },
  shareBtn: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#e8f0fe', borderRadius: 6, borderWidth: 1, borderColor: '#c2e7ff' },
  shareBtnText: { fontSize: 12, fontWeight: '700', color: '#1a73e8' },
  closeBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f1f3f4', borderRadius: 6 },
  closeBtnText: { fontSize: 13, fontWeight: '600', color: '#3c4043' },
  hudBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#c2e7ff',
  },
  hudText: { fontSize: 12, color: '#174ea6' },
  bold: { fontWeight: '700' },
  scrollArea: { flex: 1 },
  textContainer: { padding: 14 },
  textDisplay: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
    color: '#202124',
  },
  binaryCard: {
    marginVertical: 12,
    padding: 20,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    elevation: 2,
  },
  binaryIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  binaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 8,
  },
  binaryDesc: {
    fontSize: 13,
    color: '#5f6368',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  binaryMetaBox: {
    width: '100%',
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e8eaed',
    marginBottom: 14,
    gap: 6,
  },
  binaryMetaText: {
    fontSize: 12,
    color: '#3c4043',
    fontWeight: '500',
  },
  forceShowBtn: {
    backgroundColor: '#f1f3f4',
    borderWidth: 1,
    borderColor: '#dadce0',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  forceShowBtnText: {
    fontSize: 13,
    color: '#1a73e8',
    fontWeight: '700',
  },
  loadMoreBox: { marginVertical: 16, alignItems: 'center' },
  loadMoreBtn: {
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c2e7ff',
  },
  loadMoreText: { color: '#1a73e8', fontWeight: '700', fontSize: 13 },
  disabledBtn: { opacity: 0.6 },
  eofText: { textAlign: 'center', color: '#80868b', fontSize: 11, marginVertical: 16 },
  errorBox: { padding: 14, backgroundColor: '#fce8e6', borderRadius: 8 },
  errorTitle: { fontSize: 14, fontWeight: '700', color: '#d93025' },
  errorText: { fontSize: 12, color: '#c5221f', marginTop: 4 },
});


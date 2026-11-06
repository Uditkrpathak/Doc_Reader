import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { ArchiveEngine, PickedFile } from '../services/ArchiveEngine';
import { StorageService, CategoryFileInfo } from '../services/StorageService';
import { ZipViewerScreen } from './ZipViewerScreen';
import { RarViewerScreen } from './RarViewerScreen';

interface ArchiveScreenProps {
  navigation?: {
    navigate: (screen: string, params?: any) => void;
  };
}

export const ArchiveScreen: React.FC<ArchiveScreenProps> = () => {
  const engine = ArchiveEngine.getInstance();
  const storageService = StorageService.getInstance();

  const [archives, setArchives] = useState<CategoryFileInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [activeFileName, setActiveFileName] = useState<string>('');
  const [extractProgress, setExtractProgress] = useState<string>('Ready');

  // Currently viewing archive modal
  const [viewingArchive, setViewingArchive] = useState<{
    path: string;
    name: string;
    isRar: boolean;
  } | null>(null);

  const loadArchives = useCallback(async () => {
    setIsLoading(true);
    try {
      const files = await storageService.queryCategoryFiles('ARCHIVE', 0, 50);
      setArchives(files);
    } catch (err) {
      console.warn('Failed to load archives', err);
      setArchives([]);
    } finally {
      setIsLoading(false);
    }
  }, [storageService]);

  useEffect(() => {
    loadArchives();
  }, [loadArchives]);

  const handlePickArchive = async () => {
    try {
      const picked: PickedFile = await engine.pickFile();
      const ext = picked.name.split('.').pop()?.toLowerCase() || '';
      if (ext === 'zip' || ext === 'rar') {
        setViewingArchive({
          path: picked.path,
          name: picked.name,
          isRar: ext === 'rar',
        });
      } else {
        Alert.alert(
          'Archive Format',
          `Selected file "${picked.name}" is not a ZIP or RAR archive.`
        );
      }
    } catch {
      // Pick cancelled
    }
  };

  const handleExtractArchive = async (file: { name: string; uri: string }) => {
    if (isExtracting) return;
    setIsExtracting(true);
    setActiveFileName(file.name);
    setExtractProgress('Preparing extraction...');

    try {
      let targetPath = file.uri;
      if (targetPath.startsWith('content://')) {
        const resolved = await storageService.resolveToLocalFile(targetPath);
        targetPath = resolved.localPath;
      }

      const res = await engine.extract(targetPath, file.name);
      if (res.status === 'SUCCESS') {
        Alert.alert(
          'Extraction Complete',
          `Extracted ${res.extractedFiles?.length || 0} files from "${file.name}" in ${(res.wallClockMs / 1000).toFixed(1)}s.`
        );
      } else if (res.error?.includes('PASSWORD_REQUIRED')) {
        // Open viewer which has PasswordModal built-in
        setViewingArchive({
          path: targetPath,
          name: file.name,
          isRar: file.name.toLowerCase().endsWith('.rar'),
        });
      } else {
        Alert.alert('Extraction Result', res.error || 'Operation failed.');
      }
    } catch (err: any) {
      Alert.alert('Extraction Error', err?.message || 'Failed to extract archive.');
    } finally {
      setIsExtracting(false);
      setActiveFileName('');
      setExtractProgress('Ready');
    }
  };

  if (viewingArchive) {
    if (viewingArchive.isRar) {
      return (
        <RarViewerScreen
          filePath={viewingArchive.path}
          fileName={viewingArchive.name}
          onClose={() => setViewingArchive(null)}
        />
      );
    }
    return (
      <ZipViewerScreen
        filePath={viewingArchive.path}
        fileName={viewingArchive.name}
        onClose={() => setViewingArchive(null)}
      />
    );
  }

  const formatSize = (bytes: number): string => {
    if (bytes <= 0) return '0 B';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Active Extraction Card */}
      {isExtracting && (
        <View style={styles.activeCard}>
          <View style={styles.activeHeader}>
            <ActivityIndicator color="#ffffff" size="small" />
            <Text style={styles.activeTitle}>Extracting: {activeFileName}</Text>
          </View>
          <Text style={styles.activeMsg}>{extractProgress}</Text>
        </View>
      )}

      {/* Hero Action Card */}
      <View style={styles.heroCard}>
        <View style={styles.heroTop}>
          <Text style={styles.heroIcon}>📦</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Archive Manager</Text>
            <Text style={styles.heroSubtitle}>
              Inspect, browse folder trees, and extract ZIP & RAR files offline.
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.pickButton} onPress={handlePickArchive} activeOpacity={0.8}>
          <Text style={styles.pickButtonIcon}>📂</Text>
          <Text style={styles.pickButtonText}>OPEN ARCHIVE FROM STORAGE</Text>
        </TouchableOpacity>
      </View>

      {/* Discovered Device Archives */}
      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionTitle}>Archives on Device</Text>
          <Text style={styles.sectionSubtitle}>
            {archives.length} {archives.length === 1 ? 'archive' : 'archives'} discovered
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          disabled={isLoading}
          onPress={loadArchives}>
          {isLoading ? (
            <ActivityIndicator color="#2563eb" size="small" />
          ) : (
            <Text style={styles.refreshBtnText}>🔄 Refresh</Text>
          )}
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#2563eb" size="large" />
          <Text style={styles.loadingText}>Scanning device for archives...</Text>
        </View>
      ) : archives.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>No Archives Found</Text>
          <Text style={styles.emptyDesc}>
            No ZIP or RAR files detected in your public storage or Downloads. Tap "Open Archive From Storage" above to pick any file.
          </Text>
        </View>
      ) : (
        <View style={styles.archiveList}>
          {archives.map((item, idx) => {
            const isRar = item.name.toLowerCase().endsWith('.rar');
            return (
              <View key={idx} style={styles.archiveCard}>
                <View style={styles.archiveInfoRow}>
                  <View style={[styles.badgeIcon, isRar ? styles.rarBadge : styles.zipBadge]}>
                    <Text style={styles.badgeText}>{isRar ? 'RAR' : 'ZIP'}</Text>
                  </View>
                  <View style={styles.archiveTextBox}>
                    <Text style={styles.archiveName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.archiveMeta}>
                      {formatSize(item.size)} • {new Date(item.modified).toLocaleDateString()}
                    </Text>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.browseBtn}
                    onPress={() =>
                      setViewingArchive({
                        path: item.uri,
                        name: item.name,
                        isRar,
                      })
                    }>
                    <Text style={styles.browseBtnText}>👁️ Browse Contents</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.extractBtn}
                    disabled={isExtracting}
                    onPress={() => handleExtractArchive(item)}>
                    <Text style={styles.extractBtnText}>⚡ Extract All</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  activeCard: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    padding: 16,
  },
  activeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  },
  activeMsg: {
    fontSize: 12,
    color: '#bfdbfe',
    marginTop: 6,
  },
  heroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    gap: 14,
  },
  heroTop: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  heroIcon: {
    fontSize: 32,
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  heroSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    lineHeight: 16,
  },
  pickButton: {
    backgroundColor: '#eff6ff',
    borderWidth: 1.5,
    borderColor: '#3b82f6',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pickButtonIcon: {
    fontSize: 18,
  },
  pickButtonText: {
    color: '#2563eb',
    fontSize: 13,
    fontWeight: '800',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  refreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
  },
  emptyDesc: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 17,
  },
  archiveList: {
    gap: 12,
  },
  archiveCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  archiveInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  badgeIcon: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zipBadge: {
    backgroundColor: '#8b5cf6',
  },
  rarBadge: {
    backgroundColor: '#d97706',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  archiveTextBox: {
    flex: 1,
  },
  archiveName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  archiveMeta: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  browseBtn: {
    flex: 1,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  browseBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2563eb',
  },
  extractBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
  },
  extractBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
});

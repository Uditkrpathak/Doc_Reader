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
  StatusBar,
  Linking,
  AppState,
} from 'react-native';
import { StorageService } from '../services/StorageService';
import { MMKV } from '../services/MMKV';
import { AudioService } from '../services/AudioPlaybackService';
import { usePermissions } from '../hooks/usePermissions';
import { FigmaTheme } from '../theme/FigmaTheme';
import { SearchOutlineIcon } from '../components/AppIcons';

// Viewers
import { MediaViewer } from '../viewers/MediaViewer';

interface MediaScreenProps {
  navigation?: {
    navigate: (screen: string, params?: any) => void;
  };
  initialCategory?: 'AUDIO' | 'VIDEO';
}

export const MediaScreen: React.FC<MediaScreenProps> = ({ navigation, initialCategory }) => {
  const {
    permissionState,
    requestMediaPermissions,
    refreshPermissions,
  } = usePermissions();

  const [activeMediaTab, setActiveMediaTab] = useState<'AUDIO' | 'VIDEO'>(initialCategory || 'AUDIO');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [audioFiles, setAudioFiles] = useState<any[]>([]);
  const [videoFiles, setVideoFiles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Active track state for Mini-Player (Figma Image 3)
  const [activeTrack, setActiveTrack] = useState<{
    fileName: string;
    filePath: string;
    isPlaying: boolean;
    positionMs: number;
    durationMs: number;
  } | null>(() => AudioService.getTrack());

  // Active full player modal
  const [activePlayerModal, setActivePlayerModal] = useState<{
    file: string;
    path: string;
    category: 'AUDIO' | 'VIDEO';
  } | null>(null);

  const storageService = StorageService.getInstance();

  const loadMedia = useCallback(async () => {
    setIsLoading(true);
    try {
      const [audios, videos] = await Promise.all([
        storageService.queryCategoryFiles('AUDIO', 0, 100),
        storageService.queryCategoryFiles('VIDEO', 0, 100),
      ]);
      setAudioFiles(audios);
      setVideoFiles(videos);
    } catch (err) {
      console.warn('loadMedia error', err);
      setAudioFiles([]);
      setVideoFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [storageService]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  // Subscribe to AudioService
  useEffect(() => {
    const unsub = AudioService.subscribe((track) => {
      setActiveTrack(track);
    });
    return () => unsub();
  }, []);

  // AppState refresh for permissions
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshPermissions().then((perms) => {
          if (perms.media === 'granted' || perms.allFiles) {
            loadMedia();
          }
        });
      }
    });
    return () => sub.remove();
  }, [refreshPermissions, loadMedia]);

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTime = (ms: number): string => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const [sortCriteria, setSortCriteria] = useState<'Recent' | 'Name' | 'Size'>('Recent');

  const cycleSort = () => {
    if (sortCriteria === 'Recent') setSortCriteria('Name');
    else if (sortCriteria === 'Name') setSortCriteria('Size');
    else setSortCriteria('Recent');
  };

  const handlePlayMedia = (item: any, category: 'AUDIO' | 'VIDEO') => {
    MMKV.addRecentFile({
      name: item.name,
      path: item.uri,
      size: item.size || 0,
      timestamp: Date.now(),
      category,
      mimeType: item.mime,
    });

    if (category === 'AUDIO') {
      AudioService.playTrack(item.uri, item.name);
      setActivePlayerModal({
        file: item.name,
        path: item.uri,
        category: 'AUDIO',
      });
    } else {
      setActivePlayerModal({
        file: item.name,
        path: item.uri,
        category: 'VIDEO',
      });
    }
  };

  const currentList = activeMediaTab === 'AUDIO' ? audioFiles : videoFiles;

  const filteredList = useMemo(() => {
    let list = currentList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((f) => f.name?.toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sortCriteria === 'Name') {
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortCriteria === 'Size') {
      sorted.sort((a, b) => (b.size || 0) - (a.size || 0));
    }
    return sorted;
  }, [currentList, searchQuery, sortCriteria]);

  const recentMedia = useMemo(() => {
    const recents = MMKV.getRecentFiles();
    const matches = recents.filter((f) => f.category === activeMediaTab);
    return matches.slice(0, 5);
  }, [activeMediaTab]);

  const hasPermission = Boolean(permissionState.media === 'granted' || permissionState.allFiles);

  return (
    <View style={styles.container}>
      <StatusBar hidden={true} />

      {/* 2. HEADER: BLUE (#016EEF) + SEARCH PILL + SUB-TABS */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <View style={styles.brandRow}>
            <Text style={styles.brandIcon}>▶</Text>
            <Text style={styles.headerTitle}>Media</Text>
          </View>
        </View>

        {/* SEARCH PILL */}
        <View style={styles.searchBarContainer}>
          <SearchOutlineIcon size={18} color="#016EEF" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search audio and video"
            placeholderTextColor="#64748B"
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearSearchIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 3. MEDIA SUB-TABS: [ 🎵 Audio | 🎬 Video ] (Figma Image 3) */}
        <View style={styles.subTabsContainer}>
          <TouchableOpacity
            style={[styles.subTabBtn, activeMediaTab === 'AUDIO' && styles.subTabBtnActive]}
            activeOpacity={0.75}
            onPress={() => setActiveMediaTab('AUDIO')}>
            <Text style={styles.subTabIcon}>🎵</Text>
            <Text style={[styles.subTabText, activeMediaTab === 'AUDIO' && styles.subTabTextActive]}>
              Audio
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.subTabBtn, activeMediaTab === 'VIDEO' && styles.subTabBtnActive]}
            activeOpacity={0.75}
            onPress={() => setActiveMediaTab('VIDEO')}>
            <Text style={styles.subTabIcon}>🎬</Text>
            <Text style={[styles.subTabText, activeMediaTab === 'VIDEO' && styles.subTabTextActive]}>
              Video
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* OVERLAPPING WHITE CONTENT SHEET (Figma Image 3) */}
      <View style={styles.sheetContainer}>
        {/* MAIN CONTENT AREA */}
        <ScrollView
          style={styles.scrollBody}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>

        {!hasPermission ? (
          /* PERMISSION DENIED STATE (Figma Image 3 Screen 7) */
          <View style={styles.permissionDeniedBox}>
            <View style={styles.lockIconBox}>
              <Text style={styles.lockIconEmoji}>🛡️</Text>
            </View>
            <Text style={styles.permissionTitle}>Allow access to your media</Text>
            <Text style={styles.permissionSubtitle}>
              To list audio and video on this device, allow access to your media. You can still open a file
              shared from another app.
            </Text>

            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.8}
              onPress={async () => {
                await requestMediaPermissions();
                await refreshPermissions();
                loadMedia();
              }}>
              <Text style={styles.primaryBtnText}>Allow access</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.7}
              onPress={() => Linking.openSettings()}>
              <Text style={styles.secondaryBtnText}>Open app settings</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* 4. RECENTLY PLAYED CAROUSEL (Figma Image 3) */}
            {recentMedia.length > 0 && !searchQuery && (
              <View style={styles.sectionBox}>
                <Text style={styles.sectionTitle}>Recently played</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentlyScroll}>
                  {recentMedia.map((item, idx) => {
                    const pos = MMKV.getPosition(item.path);
                    let subtitle = formatBytes(item.size);
                    if (pos && pos.total && pos.timeMs && pos.total > pos.timeMs) {
                      const leftMs = pos.total - pos.timeMs;
                      subtitle = `${formatTime(leftMs)} left`;
                    }
                    return (
                      <TouchableOpacity
                        key={`recent-${item.path}-${idx}`}
                        style={styles.recentAudioCard}
                        activeOpacity={0.8}
                        onPress={() => handlePlayMedia({ name: item.name, uri: item.path, size: item.size }, activeMediaTab)}>
                        <View style={styles.recentCardIconBox}>
                          <Text style={styles.recentCardIconEmoji}>{activeMediaTab === 'AUDIO' ? '🎵' : '🎬'}</Text>
                        </View>
                        <Text style={styles.recentCardName} numberOfLines={1}>
                          {item.name.replace(/\.[^/.]+$/, '')}
                        </Text>
                        <Text style={styles.recentCardSub}>{subtitle}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* 5. ALL FILES HEADER & COUNT */}
            <View style={styles.countAndSortBar}>
              <Text style={styles.countText}>
                {filteredList.length} {activeMediaTab === 'AUDIO' ? 'audio files' : 'video files'}
              </Text>
              <TouchableOpacity activeOpacity={0.7} onPress={cycleSort}>
                <Text style={styles.sortText}>⇅ Sort: {sortCriteria} ▾</Text>
              </TouchableOpacity>
            </View>

        {/* 6. LIST OR EMPTY STATE (Figma Image 3) */}
        {isLoading ? (
          <View style={styles.centerStatusBox}>
            <ActivityIndicator size="large" color={FigmaTheme.colors.primary} />
            <Text style={styles.centerStatusText}>Scanning media library...</Text>
          </View>
        ) : filteredList.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconBox}>
              <Text style={styles.emptyIconEmoji}>{activeMediaTab === 'AUDIO' ? '🎵' : '🎬'}</Text>
            </View>
            <Text style={styles.emptyTitle}>
              No {activeMediaTab.toLowerCase()} files found
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeMediaTab === 'AUDIO' ? 'Audio' : 'Video'} files on this device will appear here.
            </Text>
            <TouchableOpacity
              style={styles.browseFilesBtn}
              activeOpacity={0.8}
              onPress={() => navigation?.navigate('Browse')}>
              <Text style={styles.browseFilesBtnText}>Browse files</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mediaListCard}>
            {filteredList.map((item, idx, arr) => {
              const isLast = idx === arr.length - 1;
              const isCurrentPlaying = activeTrack?.filePath === item.uri && activeTrack?.isPlaying;

              return (
                <TouchableOpacity
                  key={`media-${item.uri}-${idx}`}
                  style={[styles.mediaItemRow, !isLast && styles.mediaItemDivider]}
                  activeOpacity={0.7}
                  onPress={() => handlePlayMedia(item, activeMediaTab)}>
                  {/* Category Badge Icon */}
                  <View
                    style={[
                      styles.mediaBadgeBox,
                      {
                        backgroundColor:
                          activeMediaTab === 'AUDIO' ? '#EDE9FE' : '#FCE7F3',
                      },
                    ]}>
                    <Text
                      style={[
                        styles.mediaBadgeEmoji,
                        { color: activeMediaTab === 'AUDIO' ? '#7C3AED' : '#DB2777' },
                      ]}>
                      {activeMediaTab === 'AUDIO' ? '🎵' : '▶'}
                    </Text>
                  </View>

                  {/* Title & Metadata */}
                  <View style={styles.mediaMetaBox}>
                    <Text style={styles.mediaNameText} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.mediaSubText}>
                      {formatBytes(item.size)} • {activeMediaTab}
                    </Text>
                  </View>

                  {/* Circular Play Button */}
                  <View style={[styles.playCircle, isCurrentPlaying && styles.playCircleActive]}>
                    <Text style={[styles.playCircleIcon, isCurrentPlaying && styles.playCircleIconActive]}>
                      {isCurrentPlaying ? '❚❚' : '▶'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
          </>
        )}

        <View style={{ height: 160 }} />
      </ScrollView>

      {/* 7. DOCKED SPOTIFY-STYLE MINI-PLAYER (Figma Image 3) */}
      {activeTrack && (
        <TouchableOpacity
          style={styles.floatingMiniPlayer}
          activeOpacity={0.9}
          onPress={() =>
            setActivePlayerModal({
              file: activeTrack.fileName,
              path: activeTrack.filePath,
              category: 'AUDIO',
            })
          }>
          <View style={styles.miniPlayerLeft}>
            <View style={styles.miniPlayerIconBox}>
              <Text style={styles.miniPlayerIconEmoji}>🎵</Text>
            </View>
            <View style={styles.miniPlayerTextBox}>
              <Text style={styles.miniPlayerTitle} numberOfLines={1}>
                {activeTrack.fileName.replace(/\.[^/.]+$/, '')}
              </Text>
              <Text style={styles.miniPlayerStatus}>
                {activeTrack.isPlaying ? 'Playing' : 'Paused'} • {formatTime(activeTrack.positionMs)}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.miniPlayPauseBtn}
            activeOpacity={0.8}
            onPress={(e) => {
              e.stopPropagation();
              AudioService.togglePlayPause();
            }}>
            <Text style={styles.miniPlayPauseText}>{activeTrack.isPlaying ? '❚❚' : '▶'}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      )}
      </View>

      {/* 8. ACTIVE MEDIA VIEWER MODAL */}
      <Modal
        visible={activePlayerModal !== null}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => setActivePlayerModal(null)}>
        {activePlayerModal && (
          <MediaViewer
            filePath={activePlayerModal.path}
            fileName={activePlayerModal.file}
            category={activePlayerModal.category}
            onClose={() => setActivePlayerModal(null)}
          />
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
  header: {
    backgroundColor: FigmaTheme.colors.headerBlue,
    paddingTop: 12,
    paddingBottom: 22,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandIcon: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 48,
    marginBottom: 12,
    ...FigmaTheme.shadows.card,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: FigmaTheme.colors.textPrimary,
    paddingVertical: 0,
  },
  clearSearchIcon: {
    fontSize: 13,
    color: FigmaTheme.colors.textMuted,
    padding: 4,
  },

  // Sub-tabs inside royal blue header (Figma Image 3)
  subTabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 0,
    paddingTop: 12,
    gap: 10,
    backgroundColor: 'transparent',
  },
  subTabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    gap: 8,
  },
  subTabBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  subTabIcon: {
    fontSize: 15,
  },
  subTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  subTabTextActive: {
    color: FigmaTheme.colors.primary,
    fontWeight: '700',
  },

  // Overlapping White Content Sheet (Figma Image 3)
  sheetContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -14,
    overflow: 'hidden',
  },

  scrollBody: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // Recently Played Carousel (Figma Image 3)
  sectionBox: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 10,
  },
  recentlyScroll: {
    gap: 12,
  },
  recentAudioCard: {
    width: 140,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    ...FigmaTheme.shadows.card,
  },
  recentCardIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  recentCardIconEmoji: {
    fontSize: 20,
  },
  recentCardName: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 3,
  },
  recentCardSub: {
    fontSize: 11,
    color: FigmaTheme.colors.textSecondary,
  },

  countAndSortBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  countText: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.textSecondary,
  },
  sortText: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  // Media List
  mediaListCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    overflow: 'hidden',
    ...FigmaTheme.shadows.card,
  },
  mediaItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  mediaItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: FigmaTheme.colors.divider,
  },
  mediaBadgeBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  mediaBadgeEmoji: {
    fontSize: 20,
    fontWeight: '800',
  },
  mediaMetaBox: {
    flex: 1,
    marginRight: 10,
  },
  mediaNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 3,
  },
  mediaSubText: {
    fontSize: 12,
    color: FigmaTheme.colors.textSecondary,
  },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playCircleActive: {
    backgroundColor: FigmaTheme.colors.primary,
  },
  playCircleIcon: {
    fontSize: 14,
    color: FigmaTheme.colors.primary,
    marginLeft: 2,
  },
  playCircleIconActive: {
    color: '#FFFFFF',
  },

  // Docked Spotify-Style Mini Player (Figma Image 3)
  floatingMiniPlayer: {
    position: 'absolute',
    bottom: 12,
    left: 14,
    right: 14,
    backgroundColor: '#0F172A',
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...FigmaTheme.shadows.floating,
  },
  miniPlayerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  miniPlayerIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  miniPlayerIconEmoji: {
    fontSize: 16,
  },
  miniPlayerTextBox: {
    flex: 1,
  },
  miniPlayerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  miniPlayerStatus: {
    fontSize: 11,
    color: '#94A3B8',
  },
  miniPlayPauseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: FigmaTheme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniPlayPauseText: {
    fontSize: 16,
    color: '#FFFFFF',
  },

  // Permission Denied View (Figma Image 3)
  permissionDeniedBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  lockIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  lockIconEmoji: {
    fontSize: 28,
  },
  permissionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  permissionSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: FigmaTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: FigmaTheme.colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  centerStatusBox: {
    paddingVertical: 40,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  centerStatusText: {
    fontSize: 13,
    color: '#64748B',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: FigmaTheme.colors.cardBorder,
    borderStyle: 'dashed',
    marginTop: 20,
    ...FigmaTheme.shadows.card,
  },
  emptyIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyIconEmoji: {
    fontSize: 28,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  browseFilesBtn: {
    backgroundColor: FigmaTheme.colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  browseFilesBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

import React, { useState, useEffect, useRef } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
  Modal,
  Linking,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';
import { ArchiveEngine } from './src/services/ArchiveEngine';
import { FileDetector } from './src/services/FileDetector';
import { RarViewerScreen } from './src/screens/RarViewerScreen';
import { ZipViewerScreen } from './src/screens/ZipViewerScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { FolderBrowserScreen } from './src/screens/FolderBrowserScreen';
import { MediaScreen } from './src/screens/MediaScreen';
import { FavouritesScreen } from './src/screens/FavouritesScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { UnsupportedFileScreen } from './src/screens/UnsupportedFileScreen';
import { AudioMiniPlayer } from './src/components/AudioMiniPlayer';
import { MediaViewer } from './src/viewers/MediaViewer';
import { PdfViewer } from './src/viewers/PdfViewer';
import { OfficeViewer } from './src/viewers/OfficeViewer';
import { XlsxViewer } from './src/screens/XlsxViewer';
import { CsvViewer } from './src/screens/CsvViewer';
import { ImageViewer } from './src/viewers/ImageViewer';
import { TextViewer } from './src/viewers/TextViewer';
import { MMKV } from './src/services/MMKV';
import { FigmaTheme } from './src/theme/FigmaTheme';
import {
  HomeOutlineIcon,
  BrowseFolderIcon,
  MediaPhotosIcon,
  StarOutlineIcon,
} from './src/components/AppIcons';

export default function App(): React.JSX.Element {
  const [hasSeenWelcome, setHasSeenWelcome] = useState<boolean>(() =>
    Boolean(MMKV.getBoolean('has_seen_welcome_v1'))
  );

  const [activeTab, setActiveTab] = useState<'HOME' | 'BROWSE' | 'MEDIA' | 'FAVOURITES'>('HOME');
  const [browseCategory, setBrowseCategory] = useState<string | undefined>(undefined);
  const [browseShowRecents, setBrowseShowRecents] = useState<boolean>(false);
  const [isBrowserSelectionMode, setIsBrowserSelectionMode] = useState<boolean>(false);

  const [viewingArchive, setViewingArchive] = useState<{
    path: string;
    name: string;
    isRar: boolean;
  } | null>(null);
  const [activeAudioModal, setActiveAudioModal] = useState<{
    file: string;
    path: string;
  } | null>(null);

  // External Intent / WhatsApp / Telegram "Open With"
  const [externalViewer, setExternalViewer] = useState<{
    file: string;
    path: string;
    category: string;
    formatType?: any;
  } | null>(null);

  const engine = ArchiveEngine.getInstance();
  const lastHandledUrlRef = useRef<{ url: string; time: number } | null>(null);

  const handleIncomingUrl = async (url: string | null) => {
    if (!url) return;
    const now = Date.now();
    // Debounce duplicate invocations for the exact same URI within 3 seconds
    if (
      lastHandledUrlRef.current &&
      lastHandledUrlRef.current.url === url &&
      now - lastHandledUrlRef.current.time < 3000
    ) {
      return;
    }
    lastHandledUrlRef.current = { url, time: now };

    try {
      const resolved = await engine.resolveContentUri(url);
      let category = 'PDF';
      let formatType: any = undefined;

      try {
        const detected = await FileDetector.detectFile(resolved.path, resolved.name);
        category = detected.category;
      } catch {
        // Fallback to extension check
        const ext = (resolved.name.split('.').pop() || '').toLowerCase();
        if (['pdf'].includes(ext)) {
          category = 'PDF';
        } else if (['docx'].includes(ext)) {
          category = 'OFFICE_DOCX';
        } else if (['doc'].includes(ext)) {
          category = 'LEGACY_OLE_DOC';
        } else if (['pptx'].includes(ext)) {
          category = 'OFFICE_PPTX';
        } else if (['ppt'].includes(ext)) {
          category = 'LEGACY_OLE_PPT';
        } else if (['xlsx'].includes(ext)) {
          category = 'OFFICE_XLSX';
        } else if (['xls'].includes(ext)) {
          category = 'LEGACY_OLE_XLS';
        } else if (['csv', 'tsv'].includes(ext)) {
          category = 'SPREADSHEET_CSV';
        } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic'].includes(ext)) {
          category = 'IMAGE';
        } else if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
          category = 'VIDEO';
        } else if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'].includes(ext)) {
          category = 'AUDIO';
        } else if (['zip'].includes(ext)) {
          category = 'ARCHIVE_ZIP';
        } else if (['rar'].includes(ext)) {
          category = 'ARCHIVE_RAR';
        } else {
          category = 'TEXT_CODE';
        }
      }

      if (category === 'OFFICE_DOCX') {
        formatType = 'DOCX';
      } else if (category === 'OFFICE_PPTX') {
        formatType = 'PPTX';
      } else if (category === 'LEGACY_OLE_DOC') {
        formatType = 'DOC';
      } else if (category === 'LEGACY_OLE_PPT') {
        formatType = 'PPT';
      } else if (category === 'ARCHIVE_RAR4' || category === 'ARCHIVE_RAR5') {
        category = 'ARCHIVE_RAR';
      }

      // Add to MMKV recents
      MMKV.addRecentFile({
        name: resolved.name,
        path: resolved.path,
        size: resolved.size || 0,
        timestamp: Date.now(),
        category,
      });

      setExternalViewer({
        file: resolved.name,
        path: resolved.path,
        category,
        formatType,
      });
    } catch (err) {
      console.warn('Failed to handle incoming file intent:', err);
    }
  };

  useEffect(() => {
    // 1. Initial cold-start URL from Linking
    Linking.getInitialURL().then(handleIncomingUrl);

    // 2. Initial Shared File from Android Intent (ACTION_VIEW / ACTION_SEND)
    engine.getInitialSharedFile().then((shared) => {
      if (shared?.uri) {
        handleIncomingUrl(shared.uri);
      }
    });

    // 3. Incoming URL when app is already running via Linking
    const urlSub = Linking.addEventListener('url', (event) => {
      handleIncomingUrl(event.url);
    });

    // 4. Native event listener for warm-start intents (ACTION_VIEW / ACTION_SEND)
    let sharedSub: any = null;
    if (Platform.OS === 'android' && NativeModules.ArchiveModule) {
      try {
        const eventEmitter = new NativeEventEmitter(NativeModules.ArchiveModule);
        sharedSub = eventEmitter.addListener('onSharedFile', (event: any) => {
          if (event?.uri) {
            handleIncomingUrl(event.uri);
          }
        });
      } catch (err) {
        console.warn('Failed to attach onSharedFile listener', err);
      }
    }

    return () => {
      urlSub.remove();
      sharedSub?.remove();
    };
  }, []);

  const navigation = {
    navigate: (screen: string, params?: any) => {
      const s = (screen || '').toUpperCase();
      if (params?.category) {
        setBrowseCategory(params.category);
      } else {
        setBrowseCategory(undefined);
      }
      setBrowseShowRecents(Boolean(params?.showRecents));
      if (s.includes('FAV') || s.includes('STAR')) {
        setActiveTab('FAVOURITES');
      } else if (s.includes('MEDIA') || s.includes('IMAGE') || s.includes('VIDEO')) {
        setActiveTab('MEDIA');
      } else if (s.includes('BROWSE') || s.includes('FOLDER') || s.includes('FILE')) {
        setActiveTab('BROWSE');
      } else {
        setActiveTab('HOME');
      }
    },
    goBack: () => {
      setActiveTab('HOME');
    },
  };

  useEffect(() => {
    engine.setImmersiveMode(true);
  }, [engine]);

  // First launch welcome screen (Figma Screen 1) - only show if not directly opening an external file
  if (!hasSeenWelcome && !externalViewer) {
    return (
      <WelcomeScreen
        onBrowseFiles={() => {
          MMKV.set('has_seen_welcome_v1', true);
          setHasSeenWelcome(true);
          setActiveTab('BROWSE');
        }}
        onOpenFromAnotherApp={async () => {
          MMKV.set('has_seen_welcome_v1', true);
          setHasSeenWelcome(true);
          try {
            const picked = await engine.pickFile();
            if (picked?.path) {
              await handleIncomingUrl(picked.path);
            } else {
              setActiveTab('HOME');
            }
          } catch {
            setActiveTab('HOME');
          }
        }}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      <View style={styles.body}>
        {activeTab === 'HOME' ? (
          <HomeScreen navigation={navigation} />
        ) : activeTab === 'BROWSE' ? (
          <FolderBrowserScreen
            navigation={navigation}
            initialCategory={browseCategory}
            showRecents={browseShowRecents}
            onSelectionModeChange={setIsBrowserSelectionMode}
          />
        ) : activeTab === 'MEDIA' ? (
          <MediaScreen navigation={navigation} />
        ) : (
          <FavouritesScreen navigation={navigation} />
        )}
      </View>

      {/* Audio Mini-Player (Floating Spotify style) */}
      <AudioMiniPlayer
        onExpand={(track) => {
          setActiveAudioModal({
            file: track.fileName,
            path: track.filePath,
          });
        }}
      />

      {/* FIGMA BOTTOM NAVIGATION BAR (4 TABS: Home, Browse, Media, Favourites) */}
      {(!isBrowserSelectionMode || activeTab !== 'BROWSE') && (
        <View style={styles.bottomNav}>
        {/* Home */}
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('HOME')}
          activeOpacity={0.7}>
          {activeTab === 'HOME' && <View style={styles.topIndicator} />}
          <View style={styles.navIconBox}>
            <HomeOutlineIcon
              size={22}
              color={activeTab === 'HOME' ? '#016EEF' : '#64748B'}
            />
          </View>
          <Text style={[styles.navLabel, activeTab === 'HOME' && styles.navLabelActive]}>
            Home
          </Text>
        </TouchableOpacity>

        {/* Browse */}
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => {
            setBrowseCategory(undefined);
            setBrowseShowRecents(false);
            setActiveTab('BROWSE');
          }}
          activeOpacity={0.7}>
          {activeTab === 'BROWSE' && <View style={styles.topIndicator} />}
          <View style={styles.navIconBox}>
            <BrowseFolderIcon
              size={22}
              color={activeTab === 'BROWSE' ? '#016EEF' : '#64748B'}
            />
          </View>
          <Text style={[styles.navLabel, activeTab === 'BROWSE' && styles.navLabelActive]}>
            Browse
          </Text>
        </TouchableOpacity>

        {/* Media */}
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('MEDIA')}
          activeOpacity={0.7}>
          {activeTab === 'MEDIA' && <View style={styles.topIndicator} />}
          <View style={styles.navIconBox}>
            <MediaPhotosIcon
              size={22}
              color={activeTab === 'MEDIA' ? '#016EEF' : '#64748B'}
            />
          </View>
          <Text style={[styles.navLabel, activeTab === 'MEDIA' && styles.navLabelActive]}>
            Media
          </Text>
        </TouchableOpacity>

        {/* Favourites */}
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('FAVOURITES')}
          activeOpacity={0.7}>
          {activeTab === 'FAVOURITES' && <View style={styles.topIndicator} />}
          <View style={styles.navIconBox}>
            <StarOutlineIcon
              size={22}
              color={activeTab === 'FAVOURITES' ? '#016EEF' : '#64748B'}
            />
          </View>
          <Text style={[styles.navLabel, activeTab === 'FAVOURITES' && styles.navLabelActive]}>
            Favourites
          </Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Archive Viewer Modal */}
      <Modal
        visible={viewingArchive !== null}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => setViewingArchive(null)}>
        {viewingArchive && (
          <View
            style={{
              flex: 1,
              backgroundColor: '#1e293b',
            }}>
            <StatusBar hidden={true} />
            {viewingArchive.isRar ? (
              <RarViewerScreen
                filePath={viewingArchive.path}
                fileName={viewingArchive.name}
                onClose={() => setViewingArchive(null)}
              />
            ) : (
              <ZipViewerScreen
                filePath={viewingArchive.path}
                fileName={viewingArchive.name}
                onClose={() => setViewingArchive(null)}
              />
            )}
          </View>
        )}
      </Modal>

      {/* Audio Full Player Modal (from Mini-Player expansion) */}
      <Modal
        visible={activeAudioModal !== null}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => setActiveAudioModal(null)}>
        {activeAudioModal && (
          <MediaViewer
            filePath={activeAudioModal.path}
            fileName={activeAudioModal.file}
            category="AUDIO"
            onClose={() => setActiveAudioModal(null)}
          />
        )}
      </Modal>

      {/* External File Viewer (WhatsApp / File Manager Open With) */}
      <Modal
        visible={externalViewer !== null}
        animationType="slide"
        statusBarTranslucent={false}
        onRequestClose={() => setExternalViewer(null)}>
        {externalViewer && (
          <View
            style={{
              flex: 1,
              backgroundColor: '#0F172A',
            }}>
            <StatusBar hidden={true} />
            {externalViewer.category === 'PDF' && (
              <PdfViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {(externalViewer.category === 'OFFICE_DOCX' ||
              externalViewer.category === 'OFFICE_PPTX' ||
              externalViewer.category === 'LEGACY_OLE_DOC' ||
              externalViewer.category === 'LEGACY_OLE_PPT') && (
              <OfficeViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                formatType={externalViewer.formatType || 'DOCX'}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'OFFICE_XLSX' && (
              <XlsxViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'SPREADSHEET_CSV' && (
              <CsvViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'ARCHIVE_RAR' && (
              <RarViewerScreen
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'ARCHIVE_ZIP' && (
              <ZipViewerScreen
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'IMAGE' && (
              <ImageViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {(externalViewer.category === 'VIDEO' || externalViewer.category === 'AUDIO') && (
              <MediaViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                category={externalViewer.category as 'VIDEO' | 'AUDIO'}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'TEXT_CODE' && (
              <TextViewer
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
            {externalViewer.category === 'UNSUPPORTED' && (
              <UnsupportedFileScreen
                filePath={externalViewer.path}
                fileName={externalViewer.file}
                onClose={() => setExternalViewer(null)}
              />
            )}
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FigmaTheme.colors.background,
  },
  body: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    height: 60,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: FigmaTheme.colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'space-around',
    ...FigmaTheme.shadows.card,
  },
  navItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  topIndicator: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 3,
    backgroundColor: FigmaTheme.colors.primary,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
  navIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIcon: {
    fontSize: 20,
    opacity: 0.5,
    color: FigmaTheme.colors.textSecondary,
  },
  navIconActive: {
    opacity: 1,
    color: FigmaTheme.colors.primary,
  },
  navIconActiveStar: {
    opacity: 1,
    color: '#7C3AED',
  },
  navLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: FigmaTheme.colors.textSecondary,
    marginTop: 2,
  },
  navLabelActive: {
    color: FigmaTheme.colors.primary,
    fontWeight: '700',
  },
});

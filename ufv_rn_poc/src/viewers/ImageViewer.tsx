import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Modal,
  SafeAreaView,
  StatusBar,
  NativeModules,
} from 'react-native';
import { RNFS, ReadDirItem } from '../services/RNFS';
import { ArchiveEngine } from '../services/ArchiveEngine';
import {
  RotateVectorIcon,
  FrameExpandVectorIcon,
  ShareVectorIcon,
  InfoCircleIcon,
} from '../components/AppIcons';

const { ArchiveModule } = NativeModules;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif'];

interface ImageViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ filePath, fileName, onClose }) => {
  const [currentPath, setCurrentPath] = useState<string>(filePath);
  const [currentName, setCurrentName] = useState<string>(fileName);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [origDimensions, setOrigDimensions] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);
  const [lastModifiedDate, setLastModifiedDate] = useState<string>('');

  // Folder navigation list
  const [siblingImages, setSiblingImages] = useState<{ path: string; name: string }[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(1);

  // Transform & View States
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [showInfoSheet, setShowInfoSheet] = useState<boolean>(false);

  const engine = ArchiveEngine.getInstance();
  const ext = (currentName.split('.').pop() || '').toLowerCase();

  const formatDate = (timestamp?: number) => {
    if (!timestamp || timestamp <= 0) return '--';
    const d = new Date(timestamp);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  };

  // Immersive Mode: Hide status bar & navigation bar to match Image 2/4
  useEffect(() => {
    engine.setImmersiveMode(true);
    return () => {
      engine.setImmersiveMode(false);
    };
  }, []);

  // 1. Scan folder to find all sibling images for real navigation
  useEffect(() => {
    let isMounted = true;
    const parentDir = currentPath.substring(0, currentPath.lastIndexOf('/'));

    if (parentDir) {
      RNFS.readDir(parentDir)
        .then((items: ReadDirItem[]) => {
          if (!isMounted) return;
          const images = items
            .filter((item) => {
              if (item.isDirectory()) return false;
              const itemExt = (item.name.split('.').pop() || '').toLowerCase();
              return IMAGE_EXTENSIONS.includes(itemExt);
            })
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
            .map((item) => ({ path: item.path, name: item.name }));

          if (images.length > 0) {
            setSiblingImages(images);
            const foundIdx = images.findIndex((img) => img.path === currentPath);
            setCurrentIndex(foundIdx >= 0 ? foundIdx + 1 : 1);
          } else {
            setSiblingImages([{ path: currentPath, name: currentName }]);
            setCurrentIndex(1);
          }
        })
        .catch(() => {
          if (isMounted) {
            setSiblingImages([{ path: currentPath, name: currentName }]);
            setCurrentIndex(1);
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [currentPath]);

  // 2. Load and downsample image metadata
  const loadImage = useCallback(async (targetPath: string, targetName: string) => {
    setIsLoading(true);
    setZoomScale(1.0);
    setRotation(0);

    const targetExt = (targetName.split('.').pop() || '').toLowerCase();
    const rawUri = targetPath.startsWith('file://') ? targetPath : `file://${targetPath}`;

    try {
      // Query file size & modified timestamp
      if (ArchiveModule?.readFileHeader) {
        try {
          const stat = await ArchiveModule.readFileHeader(targetPath, 16);
          if (stat?.size) setFileSizeBytes(stat.size);
          if (stat?.lastModified) setLastModifiedDate(formatDate(stat.lastModified));
        } catch {}
      }

      // Check dimensions via Image.getSize
      Image.getSize(
        rawUri,
        (width, height) => {
          setOrigDimensions({ w: width, h: height });
        },
        () => {
          setOrigDimensions({ w: 0, h: 0 });
        }
      );

      if (targetExt === 'gif') {
        setImageUri(rawUri);
        setIsLoading(false);
        return;
      }

      if (ArchiveModule?.downsampleImage) {
        const res = await ArchiveModule.downsampleImage(targetPath, 2048);
        setImageUri(res.imagePath);
        if (res.origWidth && res.origHeight) {
          setOrigDimensions({ w: res.origWidth, h: res.origHeight });
        }
        if (res.fileSize) setFileSizeBytes(res.fileSize);
      } else {
        setImageUri(rawUri);
      }
    } catch {
      setImageUri(rawUri);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadImage(currentPath, currentName);
  }, [currentPath, currentName, loadImage]);

  // Navigate to previous image
  const handlePrevImage = () => {
    if (currentIndex > 1 && siblingImages.length > 0) {
      const prev = siblingImages[currentIndex - 2];
      if (prev) {
        setCurrentPath(prev.path);
        setCurrentName(prev.name);
        setCurrentIndex(currentIndex - 1);
      }
    }
  };

  // Navigate to next image
  const handleNextImage = () => {
    if (currentIndex < siblingImages.length && siblingImages.length > 0) {
      const next = siblingImages[currentIndex];
      if (next) {
        setCurrentPath(next.path);
        setCurrentName(next.name);
        setCurrentIndex(currentIndex + 1);
      }
    }
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleToggleFit = () => {
    if (zoomScale > 1.0) {
      setZoomScale(1.0);
    } else {
      setZoomScale(2.5);
    }
  };

  const handleShare = async () => {
    try {
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif',
        bmp: 'image/bmp',
        heic: 'image/heic',
      };
      await engine.shareFile(currentPath, mimeMap[ext] || 'image/*');
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const readableLocation = currentPath
    .replace('/storage/emulated/0', 'Internal storage')
    .replace(/\/+/g, ' › ')
    .replace(/ › [^›]+$/, '');

  const totalCount = siblingImages.length > 0 ? siblingImages.length : 1;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      {/* 1. TOP HEADER (Figma Blue #016EEF) */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleBox}>
          <Text style={styles.fileNameText} numberOfLines={1}>
            {currentName}
          </Text>
          <Text style={styles.subLineText}>
            {`${ext.toUpperCase()} · ${formatBytes(fileSizeBytes)} · ${currentIndex} of ${totalCount}`}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.headerActionBtn}
          onPress={() => setShowInfoSheet(true)}
          activeOpacity={0.7}>
          <Text style={styles.headerActionText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* 2. IMAGE VIEWPORT WITH TOP PILL & NAVIGATION CHEVRONS */}
      <View style={styles.imageViewport}>
        {/* Floating Top Pill (Figma Image 3: "4 / 12" or "250%" when zoomed) */}
        <View style={styles.topCounterPill}>
          <Text style={styles.topCounterPillText}>
            {zoomScale !== 1.0 ? `${Math.round(zoomScale * 100)}%` : `${currentIndex} / ${totalCount}`}
          </Text>
        </View>

        {isLoading ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color="#016EEF" />
            <Text style={styles.loadingText}>Rendering image...</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollContainer}
            contentContainerStyle={styles.scrollContent}
            maximumZoomScale={4.0}
            minimumZoomScale={0.5}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}>
            {imageUri && (
              <Image
                source={{ uri: imageUri }}
                style={[
                  styles.imageElement,
                  {
                    transform: [
                      { scale: zoomScale },
                      { rotate: `${rotation}deg` },
                    ],
                  },
                ]}
                resizeMode="contain"
              />
            )}
          </ScrollView>
        )}

        {/* Left Chevron < (Figma Image 3) */}
        {currentIndex > 1 && (
          <TouchableOpacity
            style={[styles.navChevronBtn, styles.leftChevron]}
            activeOpacity={0.75}
            onPress={handlePrevImage}>
            <Text style={styles.chevronIconText}>‹</Text>
          </TouchableOpacity>
        )}

        {/* Right Chevron > (Figma Image 3) */}
        {currentIndex < totalCount && (
          <TouchableOpacity
            style={[styles.navChevronBtn, styles.rightChevron]}
            activeOpacity={0.75}
            onPress={handleNextImage}>
            <Text style={styles.chevronIconText}>›</Text>
          </TouchableOpacity>
        )}

        {/* 3. FLOATING WHITE PILL: [ Rotate | Fit | Share | Info ] (Figma Image 4) */}
        <View style={styles.bottomFloatingPill}>
          <TouchableOpacity
            style={styles.pillActionBtn}
            activeOpacity={0.7}
            onPress={handleRotate}>
            <RotateVectorIcon size={20} color="#1E1B4B" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.pillActionBtn}
            activeOpacity={0.7}
            onPress={handleToggleFit}>
            <FrameExpandVectorIcon size={20} color="#1E1B4B" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.pillActionBtn}
            activeOpacity={0.7}
            onPress={handleShare}>
            <ShareVectorIcon size={20} color="#1E1B4B" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.pillActionBtn}
            activeOpacity={0.7}
            onPress={() => setShowInfoSheet(true)}>
            <InfoCircleIcon size={20} color="#1E1B4B" />
          </TouchableOpacity>
        </View>
      </View>

      {/* 4. FILE INFORMATION BOTTOM SHEET (Figma Image 4) */}
      <Modal
        visible={showInfoSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInfoSheet(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowInfoSheet(false)}>
          <TouchableOpacity style={styles.infoSheet} activeOpacity={1}>
            <View style={styles.sheetHandleBar} />
            <Text style={styles.infoSheetTitle}>File information</Text>

            <View style={styles.infoTable}>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>File name</Text>
                <Text style={styles.infoVal} numberOfLines={1}>
                  {currentName}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Type</Text>
                <Text style={styles.infoVal}>
                  {ext === 'jpg' || ext === 'jpeg'
                    ? 'JPEG image'
                    : ext === 'png'
                    ? 'PNG image'
                    : `${ext.toUpperCase()} image`}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Size</Text>
                <Text style={styles.infoVal}>{formatBytes(fileSizeBytes)}</Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Dimensions</Text>
                <Text style={styles.infoVal}>
                  {origDimensions.w > 0
                    ? `${origDimensions.w} × ${origDimensions.h}`
                    : '--'}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Modified</Text>
                <Text style={styles.infoVal}>
                  {lastModifiedDate || '--'}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Location</Text>
                <Text style={styles.infoVal} numberOfLines={2}>
                  {readableLocation || currentPath}
                </Text>
              </View>
            </View>

            {/* Figma Image 4: Blue Outline Share Button */}
            <TouchableOpacity
              style={styles.sheetShareBtn}
              activeOpacity={0.8}
              onPress={() => {
                setShowInfoSheet(false);
                handleShare();
              }}>
              <Text style={styles.sheetShareBtnText}>Share</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0F1D',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#016EEF',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  backBtnText: {
    fontSize: 26,
    fontWeight: '300',
    color: '#FFFFFF',
    marginTop: -2,
  },
  headerTitleBox: {
    flex: 1,
    marginRight: 8,
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
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActionText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#016EEF',
  },

  imageViewport: {
    flex: 1,
    backgroundColor: '#EEF2F6',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    margin: 8,
    borderRadius: 16,
    overflow: 'hidden',
  },
  scrollContainer: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageElement: {
    width: SCREEN_WIDTH - 24,
    height: SCREEN_HEIGHT * 0.72,
  },
  centerLoading: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
  },

  topCounterPill: {
    position: 'absolute',
    top: 14,
    alignSelf: 'center',
    backgroundColor: 'rgba(13, 8, 76, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 16,
    zIndex: 10,
    elevation: 3,
  },
  topCounterPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  navChevronBtn: {
    position: 'absolute',
    top: '48%',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  leftChevron: {
    left: 14,
  },
  rightChevron: {
    right: 14,
  },
  chevronIconText: {
    fontSize: 24,
    fontWeight: '300',
    color: '#0F172A',
    marginTop: -2,
  },

  bottomFloatingPill: {
    position: 'absolute',
    bottom: 28,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 26,
    paddingVertical: 12,
    borderRadius: 32,
    gap: 26,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  pillActionBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  infoSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 34,
  },
  sheetHandleBar: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 18,
  },
  infoSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 20,
  },
  infoTable: {
    gap: 14,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoKey: {
    fontSize: 13,
    color: '#64748B',
    width: 100,
  },
  infoVal: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'right',
  },
  sheetShareBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#016EEF',
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetShareBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#016EEF',
  },
});

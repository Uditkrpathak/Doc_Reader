import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Platform,
  Modal,
} from 'react-native';
import { NativeModules } from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';

const { ArchiveModule } = NativeModules;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface ImageViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ filePath, fileName, onClose }) => {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [origDimensions, setOrigDimensions] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Transform & View States
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);
  const [showInfo, setShowInfo] = useState<boolean>(false);

  const engine = ArchiveEngine.getInstance();
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  const loadImage = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setZoomScale(1.0);
    setRotation(0);
    setIsFlipped(false);

    try {
      // For GIF files, keep original file URI to preserve animations
      if (ext === 'gif') {
        setImageUri(`file://${filePath}`);
        setIsLoading(false);
        return;
      }

      // Use downsampling defense: limits max dimension to 2048px to prevent 10000x8000 OOM crash
      if (ArchiveModule?.downsampleImage) {
        const res = await ArchiveModule.downsampleImage(filePath, 2048);
        setImageUri(res.imagePath);
        setOrigDimensions({ w: res.origWidth, h: res.origHeight });
      } else {
        setImageUri(`file://${filePath}`);
      }
    } catch (err: any) {
      // Fall back to direct file URI if downsample fails (e.g. small image or webp)
      setImageUri(`file://${filePath}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadImage();
  }, [filePath]);

  // Zoom Controls
  const handleZoomIn = () => {
    setZoomScale((prev) => Math.min(Number((prev + 0.25).toFixed(2)), 4.0));
  };

  const handleZoomOut = () => {
    setZoomScale((prev) => Math.max(Number((prev - 0.25).toFixed(2)), 0.5));
  };

  const handleReset = () => {
    setZoomScale(1.0);
    setRotation(0);
    setIsFlipped(false);
  };

  // Rotation & Flip Controls
  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleFlip = () => {
    setIsFlipped((prev) => !prev);
  };

  // Share
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
        heif: 'image/heif',
        avif: 'image/avif',
      };
      await engine.shareFile(filePath, mimeMap[ext] || 'image/*');
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.iconBtnText}>✕</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleBox}>
          <Text style={styles.fileName} numberOfLines={1}>
            {fileName}
          </Text>
          <Text style={styles.subText} numberOfLines={1}>
            {origDimensions.w > 0
              ? `${origDimensions.w} × ${origDimensions.h} • ${ext.toUpperCase()}`
              : `${ext.toUpperCase()} Image`}
          </Text>
        </View>

        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => setShowInfo(true)}
            activeOpacity={0.7}>
            <Text style={styles.iconBtnText}>ℹ️</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handleShare}
            activeOpacity={0.7}>
            <Text style={styles.iconBtnText}>📤</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Viewport */}
      {isLoading ? (
        <View style={styles.loaderBox}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loaderText}>Loading High-Res Image...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Image Error</Text>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : (
        <View style={styles.viewport}>
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={styles.imageScrollContent}
            maximumZoomScale={5.0}
            minimumZoomScale={0.5}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent={true}>
            {imageUri && (
              <View
                style={[
                  styles.imageWrapper,
                  {
                    transform: [
                      { scale: zoomScale },
                      { rotate: `${rotation}deg` },
                      { scaleX: isFlipped ? -1 : 1 },
                    ],
                  },
                ]}>
                <Image
                  source={{ uri: imageUri }}
                  style={{
                    width: SCREEN_WIDTH - 24,
                    height: SCREEN_HEIGHT - 200,
                  }}
                  resizeMode="contain"
                />
              </View>
            )}
          </ScrollView>

          {/* Floating Glassmorphic Control Toolbar */}
          <View style={styles.floatingToolbar}>
            <TouchableOpacity
              style={styles.toolBtn}
              onPress={handleZoomOut}
              activeOpacity={0.7}>
              <Text style={styles.toolIcon}>🔍−</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolBtn, styles.resetBtn]}
              onPress={handleReset}
              activeOpacity={0.7}>
              <Text style={styles.resetText}>{Math.round(zoomScale * 100)}%</Text>
              <Text style={styles.resetSubText}>Reset</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolBtn}
              onPress={handleZoomIn}
              activeOpacity={0.7}>
              <Text style={styles.toolIcon}>🔍+</Text>
            </TouchableOpacity>

            <View style={styles.toolbarDivider} />

            <TouchableOpacity
              style={styles.toolBtn}
              onPress={handleRotate}
              activeOpacity={0.7}>
              <Text style={styles.toolIcon}>⟳</Text>
              <Text style={styles.toolLabel}>{rotation}°</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.toolBtn, isFlipped && styles.toolBtnActive]}
              onPress={handleFlip}
              activeOpacity={0.7}>
              <Text style={styles.toolIcon}>⇄</Text>
              <Text style={styles.toolLabel}>Flip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.toolBtn}
              onPress={handleShare}
              activeOpacity={0.7}>
              <Text style={styles.toolIcon}>📤</Text>
              <Text style={styles.toolLabel}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Info Modal */}
      <Modal
        visible={showInfo}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowInfo(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🖼️ Image Details</Text>
              <TouchableOpacity onPress={() => setShowInfo(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>File Name:</Text>
              <Text style={styles.detailValue} numberOfLines={2}>{fileName}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Format:</Text>
              <Text style={styles.detailValue}>{ext.toUpperCase()}</Text>
            </View>

            {origDimensions.w > 0 && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Dimensions:</Text>
                <Text style={styles.detailValue}>{origDimensions.w} × {origDimensions.h} px</Text>
              </View>
            )}

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Current Zoom:</Text>
              <Text style={styles.detailValue}>{Math.round(zoomScale * 100)}%</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Rotation:</Text>
              <Text style={styles.detailValue}>{rotation}°</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Flipped:</Text>
              <Text style={styles.detailValue}>{isFlipped ? 'Yes (Mirrored)' : 'No'}</Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Path:</Text>
              <Text style={styles.detailPath} numberOfLines={3}>{filePath}</Text>
            </View>

            <TouchableOpacity
              style={styles.modalDoneBtn}
              onPress={() => setShowInfo(false)}>
              <Text style={styles.modalDoneText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090d16',
  },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#111827',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1f2937',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerTitleBox: {
    flex: 1,
    marginHorizontal: 12,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f9fafb',
  },
  subText: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewport: {
    flex: 1,
    position: 'relative',
  },
  scrollArea: {
    flex: 1,
  },
  imageScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 90,
  },
  imageWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 10,
    fontWeight: '500',
  },
  errorBox: {
    margin: 20,
    padding: 16,
    backgroundColor: '#451a1a',
    borderRadius: 8,
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f87171',
  },
  errorText: {
    fontSize: 12,
    color: '#f87171',
    marginTop: 4,
  },
  floatingToolbar: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.94)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: '#374151',
    gap: 12,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  toolBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    minWidth: 42,
  },
  toolBtnActive: {
    backgroundColor: '#0284c7',
    borderRadius: 8,
  },
  toolIcon: {
    fontSize: 18,
    color: '#f3f4f6',
  },
  toolLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#9ca3af',
    marginTop: 2,
  },
  resetBtn: {
    backgroundColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  resetText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#38bdf8',
  },
  resetSubText: {
    fontSize: 8,
    color: '#94a3b8',
  },
  toolbarDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#374151',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 10,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  modalCloseText: {
    fontSize: 18,
    color: '#94a3b8',
    fontWeight: '700',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    width: 100,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f8fafc',
    flex: 1,
    textAlign: 'right',
  },
  detailPath: {
    fontSize: 10,
    color: '#64748b',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    flex: 1,
    textAlign: 'right',
  },
  modalDoneBtn: {
    marginTop: 16,
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalDoneText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
});

import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Share,
  Clipboard,
  ToastAndroid,
  Platform,
} from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';

export interface FileDetailsItem {
  name: string;
  path: string;
  size?: number;
  lastModified?: number | string | Date;
  mimeType?: string;
  category?: string;
  isStarred?: boolean;
}

interface FileDetailsModalProps {
  visible: boolean;
  file: FileDetailsItem | null;
  onClose: () => void;
  onOpen?: (file: FileDetailsItem) => void;
  onToggleStar?: (file: FileDetailsItem) => void;
  onDelete?: (file: FileDetailsItem) => void;
}

export const FileDetailsModal: React.FC<FileDetailsModalProps> = ({
  visible,
  file,
  onClose,
  onOpen,
  onToggleStar,
  onDelete,
}) => {
  if (!file) return null;

  const formatSize = (bytes?: number): string => {
    if (bytes === undefined || bytes === null || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (dateVal?: number | string | Date): string => {
    if (!dateVal) return 'Unknown';
    try {
      const d = new Date(typeof dateVal === 'number' && dateVal < 10000000000 ? dateVal * 1000 : dateVal);
      return d.toLocaleString();
    } catch {
      return 'Unknown';
    }
  };

  const handleCopyPath = () => {
    Clipboard.setString(file.path);
    if (Platform.OS === 'android') {
      ToastAndroid.show('Path copied to clipboard!', ToastAndroid.SHORT);
    }
  };

  const handleShare = async () => {
    try {
      if (Platform.OS === 'android') {
        await ArchiveEngine.getInstance().shareFile(file.path, file.mimeType || '*/*');
      } else {
        await Share.share({
          title: file.name,
          url: file.path.startsWith('file://') ? file.path : `file://${file.path}`,
          message: `Sharing ${file.name}`,
        });
      }
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  const ext = file.name.substring(file.name.lastIndexOf('.') + 1).toUpperCase();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}>
        <TouchableOpacity
          style={styles.sheet}
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}>
          {/* Grab Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.extBadge}>
              <Text style={styles.extBadgeText}>{ext || 'FILE'}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.title} numberOfLines={2}>
                {file.name}
              </Text>
              <Text style={styles.subtitle}>
                {formatSize(file.size)} • {file.category || 'Document'}
              </Text>
            </View>
          </View>

          {/* Details Table */}
          <View style={styles.table}>
            <View style={styles.row}>
              <Text style={styles.label}>Location:</Text>
              <View style={styles.pathRow}>
                <Text style={styles.pathText} numberOfLines={2}>
                  {file.path}
                </Text>
                <TouchableOpacity onPress={handleCopyPath} style={styles.copyBtn}>
                  <Text style={styles.copyBtnText}>📋 Copy</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <Text style={styles.label}>Size:</Text>
              <Text style={styles.value}>
                {formatSize(file.size)} {file.size ? `(${file.size.toLocaleString()} bytes)` : ''}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <Text style={styles.label}>Modified:</Text>
              <Text style={styles.value}>{formatDate(file.lastModified)}</Text>
            </View>

            {file.mimeType && (
              <>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.label}>MIME Type:</Text>
                  <Text style={styles.value}>{file.mimeType}</Text>
                </View>
              </>
            )}
          </View>

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            {onOpen && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.openBtn]}
                onPress={() => {
                  onClose();
                  onOpen(file);
                }}>
                <Text style={styles.openBtnText}>👁️ Open</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, styles.shareBtn]}
              onPress={handleShare}>
              <Text style={styles.shareBtnText}>📤 Share</Text>
            </TouchableOpacity>

            {onToggleStar && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.starBtn]}
                onPress={() => onToggleStar(file)}>
                <Text style={styles.starBtnText}>
                  {file.isStarred ? '★ Unstar' : '☆ Star'}
                </Text>
              </TouchableOpacity>
            )}

            {onDelete && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.deleteBtn]}
                onPress={() => {
                  onClose();
                  onDelete(file);
                }}>
                <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#cbd5e1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  extBadge: {
    backgroundColor: '#e0f2fe',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 14,
  },
  extBadgeText: {
    color: '#0284c7',
    fontWeight: '800',
    fontSize: 13,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  table: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  row: {
    marginVertical: 4,
  },
  label: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  value: {
    fontSize: 13,
    color: '#1e293b',
    fontWeight: '500',
  },
  pathRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pathText: {
    fontSize: 12,
    color: '#334155',
    flex: 1,
    fontFamily: Platform.OS === 'android' ? 'monospace' : undefined,
  },
  copyBtn: {
    backgroundColor: '#e2e8f0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  copyBtnText: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openBtn: {
    backgroundColor: '#0284c7',
  },
  openBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  shareBtn: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  shareBtnText: {
    color: '#0f172a',
    fontWeight: '600',
    fontSize: 13,
  },
  starBtn: {
    backgroundColor: '#fef3c7',
  },
  starBtnText: {
    color: '#d97706',
    fontWeight: '700',
    fontSize: 13,
  },
  deleteBtn: {
    backgroundColor: '#fee2e2',
  },
  deleteBtnText: {
    color: '#dc2626',
    fontWeight: '700',
    fontSize: 13,
  },
});


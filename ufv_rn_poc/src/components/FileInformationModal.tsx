import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { RNFS, StatResult } from '../services/RNFS';
import { FigmaTheme } from '../theme/FigmaTheme';
import { DocumentFileBadgeIcon, ExternalLinkIcon, ShareVectorIcon } from './AppIcons';

export interface FileInfoData {
  name: string;
  path: string;
  size: number;
  lastModified?: number | string | Date;
  category?: string;
}

interface FileInformationModalProps {
  visible: boolean;
  file: FileInfoData | null;
  onClose: () => void;
  onOpen: (file: FileInfoData) => void;
  onShare: (file: FileInfoData) => void;
}

export const FileInformationModal: React.FC<FileInformationModalProps> = ({
  visible,
  file,
  onClose,
  onOpen,
  onShare,
}) => {
  const [fsData, setFsData] = useState<{ size?: number; mtime?: Date } | null>(null);

  useEffect(() => {
    if (!file?.path) {
      setFsData(null);
      return;
    }
    let isCancelled = false;
    RNFS.stat(file.path)
      .then((stat: StatResult) => {
        if (!isCancelled) {
          const mDate = stat.mtime instanceof Date ? stat.mtime : stat.mtime ? new Date(stat.mtime) : undefined;
          setFsData({
            size: typeof stat.size === 'number' && stat.size > 0 ? stat.size : undefined,
            mtime: mDate,
          });
        }
      })
      .catch(() => {
        // Fallback silently to passed file metadata
      });

    return () => {
      isCancelled = true;
    };
  }, [file?.path]);

  if (!file) return null;

  const realSize = fsData?.size !== undefined && fsData.size > 0 ? fsData.size : file.size;
  const realModified = fsData?.mtime || file.lastModified;

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const formatDate = (ms?: number | string | Date): string => {
    if (!ms) return 'Unknown';
    const d = ms instanceof Date ? ms : new Date(typeof ms === 'string' ? ms : ms);
    if (isNaN(d.getTime())) return 'Unknown';
    const day = d.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${day} ${month} ${year}, ${hours}:${minutes} ${ampm}`;
  };

  const getFileTypeDescription = (fileName: string, category?: string): string => {
    const ext = (fileName.split('.').pop() || '').toLowerCase();

    if (ext === 'pdf' || category === 'PDF') return 'PDF document';
    if (['docx', 'doc'].includes(ext) || category === 'OFFICE_DOCX' || category === 'LEGACY_OLE_DOC' || category === 'WORD') return 'Word document';
    if (['xlsx', 'xls'].includes(ext) || category === 'OFFICE_XLSX' || category === 'LEGACY_OLE_XLS' || category === 'EXCEL') return 'Excel spreadsheet';
    if (ext === 'csv' || category === 'SPREADSHEET_CSV') return 'CSV spreadsheet';
    if (ext === 'tsv') return 'TSV spreadsheet';
    if (['pptx', 'ppt'].includes(ext) || category === 'OFFICE_PPTX' || category === 'LEGACY_OLE_PPT' || category === 'PPT') return 'PowerPoint presentation';
    if (ext === 'txt') return 'Plain text document';
    if (ext === 'rtf') return 'Rich text document';
    if (ext === 'md') return 'Markdown document';
    if (['html', 'htm'].includes(ext)) return 'HTML document';
    if (['json', 'xml', 'yaml', 'yml'].includes(ext)) return `${ext.toUpperCase()} file`;
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'rb', 'sh'].includes(ext)) return 'Source code file';
    if (ext === 'zip' || category === 'ARCHIVE_ZIP') return 'ZIP archive';
    if (ext === 'rar' || category === 'ARCHIVE_RAR' || category === 'ARCHIVE_RAR4' || category === 'ARCHIVE_RAR5') return 'RAR archive';
    if (ext === '7z') return '7-Zip archive';
    if (['tar', 'gz', 'bz2', 'xz'].includes(ext)) return 'Compressed archive';
    if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', '3gp'].includes(ext) || category === 'VIDEO') return 'Video file';
    if (['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'wma'].includes(ext) || category === 'AUDIO') return 'Audio recording';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp', 'heic', 'heif', 'avif'].includes(ext) || category === 'IMAGE') return 'Image file';
    if (category === 'ARCHIVE') return 'Archive file';
    if (ext) return `${ext.toUpperCase()} file`;
    return 'Document file';
  };

  const getBadgeForFile = (fileName: string) => {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') return FigmaTheme.badges.pdf;
    if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) return FigmaTheme.badges.excel;
    if (['docx', 'doc', 'txt', 'rtf', 'md'].includes(ext)) return FigmaTheme.badges.word;
    if (['pptx', 'ppt'].includes(ext)) return FigmaTheme.badges.pptx;
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return FigmaTheme.badges.archive;
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return FigmaTheme.badges.video;
    if (['mp3', 'wav', 'm4a', 'aac', 'flac'].includes(ext)) return FigmaTheme.badges.audio;
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) return FigmaTheme.badges.image;
    return FigmaTheme.badges.unknown;
  };

  const formatLocation = (fullPath: string) => {
    const lastSlash = fullPath.lastIndexOf('/');
    const dirPath = lastSlash > 0 ? fullPath.substring(0, lastSlash) : '';
    const normalized = dirPath.replace(/^\/storage\/emulated\/0/, '').replace(/^\//, '');
    if (!normalized) {
      return { main: 'Internal storage', sub: '' };
    }
    const parts = normalized.split('/').filter(Boolean);
    return {
      main: 'Internal storage ›',
      sub: parts.join(' › '),
    };
  };

  const badge = getBadgeForFile(file.name);
  const location = formatLocation(file.path);
  const fileTypeStr = getFileTypeDescription(file.name, file.category);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <StatusBar hidden={true} />

        {/* BLUE HEADER (#016EEF) */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onClose}>
              <Text style={styles.backIcon}>&lt;</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>File Information</Text>
          </View>
        </View>

        {/* WHITE SHEET CONTENT */}
        <View style={styles.sheetContainer}>
          {/* File Card Top Row */}
          <View style={styles.fileRow}>
            <DocumentFileBadgeIcon
              label={badge.label}
              badgeBg={badge.bg}
              badgeText={badge.text}
              width={46}
              height={54}
            />
            <Text style={styles.fileName} numberOfLines={3}>
              {file.name}
            </Text>
          </View>

          {/* Metadata Card (#F5F6FA) */}
          <View style={styles.metaCard}>
            {/* File type */}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>File type</Text>
              <Text style={styles.metaValue}>{fileTypeStr}</Text>
            </View>
            <View style={styles.divider} />

            {/* Size */}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Size</Text>
              <Text style={styles.metaValue}>{formatBytes(realSize)}</Text>
            </View>
            <View style={styles.divider} />

            {/* Modified */}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Modified</Text>
              <Text style={styles.metaValue}>{formatDate(realModified)}</Text>
            </View>
            <View style={styles.divider} />

            {/* Location */}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Location</Text>
              <View style={styles.locationValBox}>
                <Text style={styles.metaValue}>{location.main}</Text>
                {location.sub ? (
                  <Text style={[styles.metaValue, { marginTop: 2 }]}>{location.sub}</Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.openBtn}
              activeOpacity={0.8}
              onPress={() => {
                onClose();
                onOpen(file);
              }}>
              <ExternalLinkIcon size={16} color="#FFFFFF" />
              <Text style={styles.openBtnText}>Open</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.shareBtn}
              activeOpacity={0.8}
              onPress={() => onShare(file)}>
              <ShareVectorIcon size={16} color={FigmaTheme.colors.primary} />
              <Text style={styles.shareBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FigmaTheme.colors.headerBlue,
  },
  header: {
    backgroundColor: FigmaTheme.colors.headerBlue,
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  backBtn: {
    width: 34,
    height: 42,
    borderRadius: 15,
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  sheetContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    paddingTop: 8,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 14,
  },
  fileName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 22,
  },
  metaCard: {
    backgroundColor: '#F5F6FA',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginHorizontal: 20,
    marginBottom: 24,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  metaLabel: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  metaValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'right',
  },
  locationValBox: {
    alignItems: 'flex-end',
    maxWidth: '65%',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  actions: {
    marginHorizontal: 20,
    gap: 12,
  },
  openBtn: {
    backgroundColor: FigmaTheme.colors.primary,
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...FigmaTheme.shadows.card,
  },
  openBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  shareBtn: {
    backgroundColor: '#FFFFFF',
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: FigmaTheme.colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareBtnText: {
    color: FigmaTheme.colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
});

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { theme, getFileCategoryInfo } from '../theme/theme';

export interface FileItem {
  name: string;
  path: string;
  size?: number;
  isDirectory?: boolean;
  mtime?: string | Date;
  extension?: string;
  category?: string;
}

interface FileCardProps {
  file: FileItem;
  onPress: (file: FileItem) => void;
  onLongPress?: (file: FileItem) => void;
  badge?: string;
  subtitle?: string;
  isStarred?: boolean;
  onToggleStar?: (file: FileItem) => void;
  viewMode?: 'list' | 'grid';
}

export const FileCard: React.FC<FileCardProps> = ({
  file,
  onPress,
  onLongPress,
  badge,
  subtitle,
  isStarred = false,
  onToggleStar,
  viewMode = 'list',
}) => {
  const isDir = Boolean(file.isDirectory);
  const info = getFileCategoryInfo(file.name, isDir);

  const formatSize = (bytes?: number): string => {
    if (bytes === undefined || bytes === null || bytes < 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const displaySubtitle =
    subtitle ||
    (isDir
      ? 'Folder • Tap to open'
      : formatSize(file.size));

  const displayBadge = badge || info.label;

  if (viewMode === 'grid') {
    return (
      <TouchableOpacity
        style={styles.gridCard}
        onPress={() => onPress(file)}
        onLongPress={() => onLongPress && onLongPress(file)}
        activeOpacity={0.75}>
        <View style={styles.gridHeader}>
          <View style={[styles.gridBadge, { backgroundColor: info.bg }]}>
            <Text style={[styles.gridBadgeText, { color: info.color }]}>{displayBadge}</Text>
          </View>
          {!isDir && onToggleStar && (
            <TouchableOpacity
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={(e) => {
                e.stopPropagation();
                onToggleStar(file);
              }}>
              <Text style={[styles.starIcon, isStarred && styles.starIconActive]}>
                {isStarred ? '★' : '☆'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.gridIconBox, { backgroundColor: info.bg }]}>
          <Text style={styles.gridIconText}>{info.icon}</Text>
        </View>

        <Text style={styles.gridFileName} numberOfLines={2}>
          {file.name}
        </Text>
        <Text style={styles.gridFileMeta} numberOfLines={1}>
          {displaySubtitle}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress(file)}
      onLongPress={() => onLongPress && onLongPress(file)}
      activeOpacity={0.7}>
      {/* Icon Pill */}
      <View style={[styles.iconBox, { backgroundColor: info.bg }]}>
        <Text style={styles.iconText}>{info.icon}</Text>
      </View>

      {/* Title & Metadata */}
      <View style={styles.contentBox}>
        <Text style={styles.fileName} numberOfLines={1}>
          {file.name}
        </Text>
        <Text style={styles.fileMeta} numberOfLines={1}>
          {displaySubtitle}
        </Text>
      </View>

      {/* Category Badge & Star & Arrow */}
      <View style={styles.rightBox}>
        {!isDir && onToggleStar && (
          <TouchableOpacity
            style={styles.starBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={(e) => {
              e.stopPropagation();
              onToggleStar(file);
            }}>
            <Text style={[styles.starIcon, isStarred && styles.starIconActive]}>
              {isStarred ? '★' : '☆'}
            </Text>
          </TouchableOpacity>
        )}
        <View style={[styles.badge, { backgroundColor: info.bg }]}>
          <Text style={[styles.badgeText, { color: info.color }]}>{displayBadge}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    ...theme.shadows.card,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.md,
  },
  iconText: {
    fontSize: 22,
  },
  contentBox: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  fileName: {
    ...theme.typography.titleSmall,
    color: theme.colors.textPrimary,
  },
  fileMeta: {
    ...theme.typography.bodyMedium,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  rightBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  starBtn: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  starIcon: {
    fontSize: 18,
    color: '#9aa0a6',
  },
  starIconActive: {
    color: '#fbbc04',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.borderRadius.xs,
  },
  badgeText: {
    ...theme.typography.caption,
  },
  chevron: {
    fontSize: 20,
    color: theme.colors.textMuted,
    fontWeight: '600',
    marginLeft: 2,
  },
  gridCard: {
    flex: 1,
    margin: 4,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    minHeight: 140,
    justifyContent: 'space-between',
    ...theme.shadows.card,
  },
  gridHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  gridBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gridBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  gridIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignSelf: 'center',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  gridIconText: {
    fontSize: 26,
  },
  gridFileName: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginTop: 6,
  },
  gridFileMeta: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
});


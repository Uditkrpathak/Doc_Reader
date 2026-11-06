import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import {
  ExternalLinkIcon,
  ShareVectorIcon,
  StarOutlineIcon,
  InfoCircleIcon,
} from './AppIcons';

export interface ActionMenuItemFile {
  name: string;
  path: string;
  size: number;
  lastModified?: number;
  category?: string;
  isStarred?: boolean;
}

interface FileActionMenuModalProps {
  visible: boolean;
  file: ActionMenuItemFile | null;
  isRecentItem?: boolean;
  onClose: () => void;
  onOpen: (file: ActionMenuItemFile) => void;
  onShare: (file: ActionMenuItemFile) => void;
  onToggleStar: (file: ActionMenuItemFile) => void;
  onFileInfo: (file: ActionMenuItemFile) => void;
  onRemoveRecent?: (file: ActionMenuItemFile) => void;
}

export const FileActionMenuModal: React.FC<FileActionMenuModalProps> = ({
  visible,
  file,
  isRecentItem,
  onClose,
  onOpen,
  onShare,
  onToggleStar,
  onFileInfo,
  onRemoveRecent,
}) => {
  if (!file) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        {/* Figma Screen 12: Anchored White File Menu Popover Card */}
        <View style={styles.menuCard}>
          {/* 1. Open */}
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onOpen(file);
            }}>
            <ExternalLinkIcon size={16} color="#0F172A" />
            <Text style={styles.menuText}>Open</Text>
          </TouchableOpacity>

          {/* 2. Share */}
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onShare(file);
            }}>
            <ShareVectorIcon size={16} color="#0F172A" />
            <Text style={styles.menuText}>Share</Text>
          </TouchableOpacity>

          {/* 3. Add to favourites */}
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onToggleStar(file);
            }}>
            <StarOutlineIcon size={16} color="#0F172A" />
            <Text style={styles.menuText}>
              {file.isStarred ? 'Remove from favourites' : 'Add to favourites'}
            </Text>
          </TouchableOpacity>

          {/* Optional: Remove from Recents */}
          {isRecentItem && onRemoveRecent && (
            <TouchableOpacity
              style={styles.menuRow}
              activeOpacity={0.7}
              onPress={() => {
                onClose();
                onRemoveRecent(file);
              }}>
              <Text style={[styles.menuText, { color: '#DC2626' }]}>Remove from recents</Text>
            </TouchableOpacity>
          )}

          {/* 4. File information */}
          <TouchableOpacity
            style={styles.menuRow}
            activeOpacity={0.7}
            onPress={() => {
              onClose();
              onFileInfo(file);
            }}>
            <InfoCircleIcon size={16} color="#0F172A" />
            <Text style={styles.menuText}>File information</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  menuCard: {
    alignSelf: 'flex-end',
    width: 200,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 6,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 12,
  },
  menuText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0F172A',
  },
});


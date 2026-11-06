import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Switch,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';

// 1. EXTRACTION OPTIONS MODAL (Figma Image 4)
interface ExtractionOptionsModalProps {
  visible: boolean;
  totalItemsCount: number;
  totalSizeBytes: number;
  selectedItemsCount: number;
  selectedSizeBytes: number;
  destinationPath: string;
  onClose: () => void;
  onConfirmExtract: (options: {
    mode: 'ALL' | 'SELECTED';
    keepFolderStructure: boolean;
    conflictResolution: 'SKIP' | 'REPLACE' | 'KEEP_BOTH';
  }) => void;
}

export const ExtractionOptionsModal: React.FC<ExtractionOptionsModalProps> = ({
  visible,
  totalItemsCount,
  totalSizeBytes,
  selectedItemsCount,
  selectedSizeBytes,
  destinationPath,
  onClose,
  onConfirmExtract,
}) => {
  const [mode, setMode] = useState<'ALL' | 'SELECTED'>(selectedItemsCount > 0 ? 'SELECTED' : 'ALL');
  const [keepFolderStructure, setKeepFolderStructure] = useState<boolean>(true);
  const [conflictResolution, setConflictResolution] = useState<'SKIP' | 'REPLACE' | 'KEEP_BOTH'>('KEEP_BOTH');

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1}>
          <View style={styles.handleBar} />
          <Text style={styles.sheetTitle}>Extract files</Text>

          {/* Radio 1: Extract all */}
          <TouchableOpacity
            style={[styles.radioCard, mode === 'ALL' && styles.radioCardActive]}
            activeOpacity={0.7}
            onPress={() => setMode('ALL')}>
            <View style={[styles.radioCircle, mode === 'ALL' && styles.radioCircleActive]}>
              {mode === 'ALL' && <View style={styles.radioDot} />}
            </View>
            <View style={styles.radioTextBox}>
              <Text style={styles.radioTitle}>Extract all</Text>
              <Text style={styles.radioSubtitle}>
                {totalItemsCount} items • {formatBytes(totalSizeBytes)}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Radio 2: Extract selected */}
          <TouchableOpacity
            style={[
              styles.radioCard,
              mode === 'SELECTED' && styles.radioCardActive,
              selectedItemsCount === 0 && styles.radioCardDisabled,
            ]}
            disabled={selectedItemsCount === 0}
            activeOpacity={0.7}
            onPress={() => setMode('SELECTED')}>
            <View style={[styles.radioCircle, mode === 'SELECTED' && styles.radioCircleActive]}>
              {mode === 'SELECTED' && <View style={styles.radioDot} />}
            </View>
            <View style={styles.radioTextBox}>
              <Text style={styles.radioTitle}>Extract selected</Text>
              <Text style={styles.radioSubtitle}>
                {selectedItemsCount > 0
                  ? `${selectedItemsCount} items • ${formatBytes(selectedSizeBytes)}`
                  : 'No items selected'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* Destination Path */}
          <View style={styles.destinationBox}>
            <View style={{ flex: 1 }}>
              <Text style={styles.destLabel}>Save to</Text>
              <Text style={styles.destPath} numberOfLines={1}>
                {destinationPath.replace('/storage/emulated/0', 'Internal storage')}
              </Text>
            </View>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={styles.changeLink}>Change</Text>
            </TouchableOpacity>
          </View>

          {/* Keep folder structure toggle */}
          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Keep folder structure</Text>
            <Switch
              value={keepFolderStructure}
              onValueChange={setKeepFolderStructure}
              trackColor={{ false: '#CBD5E1', true: FigmaTheme.colors.primaryLight }}
              thumbColor={keepFolderStructure ? FigmaTheme.colors.primary : '#FFFFFF'}
            />
          </View>

          {/* Conflict resolution segment */}
          <Text style={styles.conflictHeader}>If a file already exists</Text>
          <View style={styles.segmentRow}>
            {(['SKIP', 'REPLACE', 'KEEP_BOTH'] as const).map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.segmentBtn, conflictResolution === opt && styles.segmentBtnActive]}
                activeOpacity={0.75}
                onPress={() => setConflictResolution(opt)}>
                <Text
                  style={[
                    styles.segmentBtnText,
                    conflictResolution === opt && styles.segmentBtnTextActive,
                  ]}>
                  {opt === 'SKIP' ? 'Skip' : opt === 'REPLACE' ? 'Replace' : 'Keep both'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Extract Button */}
          <TouchableOpacity
            style={styles.primaryActionBtn}
            activeOpacity={0.8}
            onPress={() => {
              onClose();
              onConfirmExtract({
                mode,
                keepFolderStructure,
                conflictResolution,
              });
            }}>
            <Text style={styles.primaryActionBtnText}>Extract</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// 2. EXTRACTION PROGRESS MODAL (Figma Image 4)
interface ExtractionProgressModalProps {
  visible: boolean;
  currentCount: number;
  totalCount: number;
  currentFileName: string;
  progressPercent: number;
  onCancel: () => void;
}

export const ExtractionProgressModal: React.FC<ExtractionProgressModalProps> = ({
  visible,
  currentCount,
  totalCount,
  currentFileName,
  progressPercent,
  onCancel,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.centeredOverlay}>
        <View style={styles.progressCard}>
          <View style={styles.archiveIconCircle}>
            <Text style={styles.archiveIconEmoji}>📦</Text>
          </View>

          <Text style={styles.progressTitle}>
            Extracting {currentCount} of {totalCount} items
          </Text>
          <Text style={styles.currentFileText} numberOfLines={1}>
            {currentFileName}
          </Text>

          {/* Progress Bar */}
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${Math.min(100, Math.max(0, progressPercent))}%` }]} />
          </View>

          <View style={styles.progressNumbersRow}>
            <Text style={styles.percentText}>{Math.round(progressPercent)}%</Text>
          </View>

          <TouchableOpacity style={styles.cancelExtractBtn} activeOpacity={0.7} onPress={onCancel}>
            <Text style={styles.cancelExtractBtnText}>Cancel</Text>
          </TouchableOpacity>

          <Text style={styles.safeCancelNote}>
            Cancelling is safe. Files already extracted stay in place.
          </Text>
        </View>
      </View>
    </Modal>
  );
};

// 3. EXTRACTION RESULT MODAL (SUCCESS & PARTIAL) (Figma Image 4)
interface ExtractionResultModalProps {
  visible: boolean;
  successCount: number;
  totalCount: number;
  destinationPath: string;
  failedItems?: Array<{ name: string; reason: string }>;
  onBrowseExtracted: () => void;
  onOpenExtracted: () => void;
  onClose: () => void;
}

export const ExtractionResultModal: React.FC<ExtractionResultModalProps> = ({
  visible,
  successCount,
  totalCount,
  destinationPath,
  failedItems = [],
  onBrowseExtracted,
  onOpenExtracted,
  onClose,
}) => {
  const isPartial = failedItems.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.centeredOverlay}>
        <View style={styles.resultCard}>
          <View style={[styles.resultIconCircle, isPartial && styles.partialIconCircle]}>
            <Text style={styles.resultIconEmoji}>{isPartial ? '⚠️' : '✓'}</Text>
          </View>

          <Text style={styles.resultTitle}>
            {isPartial
              ? `${successCount} of ${totalCount} items extracted`
              : `${totalCount} items extracted`}
          </Text>

          <Text style={styles.resultSubtitle}>
            {isPartial
              ? `${failedItems.length} items couldn't be extracted. The rest are saved.`
              : `Saved to ${destinationPath.replace('/storage/emulated/0', 'Internal storage')}`}
          </Text>

          {/* Failed Items List */}
          {isPartial && (
            <View style={styles.failedItemsBox}>
              {failedItems.map((item, idx) => (
                <View key={`failed-${idx}`} style={styles.failedItemRow}>
                  <Text style={styles.failedItemBullet}>⚠</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.failedItemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.failedItemReason}>{item.reason}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity style={styles.primaryActionBtn} activeOpacity={0.8} onPress={onBrowseExtracted}>
            <Text style={styles.primaryActionBtnText}>Browse extracted folder</Text>
          </TouchableOpacity>

          {!isPartial && (
            <TouchableOpacity style={styles.secondaryActionBtn} activeOpacity={0.7} onPress={onOpenExtracted}>
              <Text style={styles.secondaryActionBtnText}>Open extracted files</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={{ marginTop: 14 }}>
            <Text style={styles.doneLink}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

// 4. ARCHIVE RECOVERY MODAL (CORRUPT, MISSING PART, TOO LARGE) (Figma Image 5)
interface ArchiveRecoveryModalProps {
  visible: boolean;
  type: 'DAMAGED' | 'MISSING_PART' | 'UNSUPPORTED_METHOD' | 'TOO_LARGE' | 'INSUFFICIENT_STORAGE';
  spaceNeededMb?: number;
  spaceAvailableMb?: number;
  onRetry?: () => void;
  onShare?: () => void;
  onClose: () => void;
}

export const ArchiveRecoveryModal: React.FC<ArchiveRecoveryModalProps> = ({
  visible,
  type,
  spaceNeededMb = 52,
  spaceAvailableMb = 18,
  onRetry,
  onShare,
  onClose,
}) => {
  const getDetails = () => {
    switch (type) {
      case 'INSUFFICIENT_STORAGE':
        return {
          icon: '💾',
          title: 'Not enough storage',
          sub: 'This archive needs more space than is free on this device.',
          btn1: 'Choose another location',
          btn2: 'Cancel',
        };
      case 'MISSING_PART':
        return {
          icon: '📦',
          title: 'A part of this archive is missing',
          sub: 'This is one part of a multi-part archive. Add the remaining parts to the same folder, then open it again.',
          btn1: 'Choose missing part',
          btn2: 'Back to files',
        };
      case 'UNSUPPORTED_METHOD':
        return {
          icon: '📦',
          title: 'This compression method isn\'t supported',
          sub: 'The archive uses a compression method this app can\'t read yet. You can share it to another app.',
          btn1: 'Share file',
          btn2: 'Back to files',
        };
      case 'TOO_LARGE':
        return {
          icon: '📦',
          title: 'This archive is too large to open here',
          sub: 'It\'s larger than this device can safely handle without running out of memory. Try extracting it on a computer.',
          btn1: 'Share file',
          btn2: 'Back to files',
        };
      case 'DAMAGED':
      default:
        return {
          icon: '⚠️',
          title: 'This archive looks damaged',
          sub: 'Some data is missing or unreadable. Try downloading or copying the file again.',
          btn1: 'Try again',
          btn2: 'Back to files',
        };
    }
  };

  const details = getDetails();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.centeredOverlay}>
        <View style={styles.recoveryCard}>
          <View style={styles.recoveryIconCircle}>
            <Text style={styles.recoveryIconEmoji}>{details.icon}</Text>
          </View>

          <Text style={styles.recoveryTitle}>{details.title}</Text>
          <Text style={styles.recoverySubtitle}>{details.sub}</Text>

          {/* Storage specifics */}
          {type === 'INSUFFICIENT_STORAGE' && (
            <View style={styles.storageStatsBox}>
              <View style={styles.storageStatRow}>
                <Text style={styles.statKey}>Space needed</Text>
                <Text style={styles.statVal}>{spaceNeededMb} MB</Text>
              </View>
              <View style={styles.storageStatRow}>
                <Text style={styles.statKey}>Space available</Text>
                <Text style={styles.statVal}>{spaceAvailableMb} MB</Text>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={styles.primaryActionBtn}
            activeOpacity={0.8}
            onPress={() => {
              if (onRetry) onRetry();
              else if (onShare) onShare();
              else onClose();
            }}>
            <Text style={styles.primaryActionBtnText}>{details.btn1}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryActionBtn} activeOpacity={0.7} onPress={onClose}>
            <Text style={styles.secondaryActionBtnText}>{details.btn2}</Text>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.7} style={{ marginTop: 12 }}>
            <Text style={styles.reportLink}>Report a file-opening problem</Text>
          </TouchableOpacity>
        </View>
      </View>
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
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 16,
  },
  radioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
  },
  radioCardActive: {
    borderColor: FigmaTheme.colors.primary,
    backgroundColor: '#EFF6FF',
  },
  radioCardDisabled: {
    opacity: 0.5,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  radioCircleActive: {
    borderColor: FigmaTheme.colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: FigmaTheme.colors.primary,
  },
  radioTextBox: {
    flex: 1,
  },
  radioTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  radioSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  destinationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  destLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  destPath: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
    marginTop: 1,
  },
  changeLink: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  conflictHeader: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 12,
    marginBottom: 8,
  },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    ...FigmaTheme.shadows.card,
  },
  segmentBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentBtnTextActive: {
    color: FigmaTheme.colors.primary,
    fontWeight: '700',
  },
  primaryActionBtn: {
    width: '100%',
    backgroundColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryActionBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryActionBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: FigmaTheme.colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryActionBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  // Centered Modal Cards
  centeredOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  progressCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    ...FigmaTheme.shadows.floating,
  },
  archiveIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  archiveIconEmoji: {
    fontSize: 28,
  },
  progressTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  currentFileText: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 16,
    textAlign: 'center',
  },
  progressBarTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: FigmaTheme.colors.primary,
  },
  progressNumbersRow: {
    width: '100%',
    alignItems: 'flex-end',
    marginBottom: 18,
  },
  percentText: {
    fontSize: 12,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },
  cancelExtractBtn: {
    width: '100%',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  cancelExtractBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
  },
  safeCancelNote: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
  },

  // Result Card
  resultCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    ...FigmaTheme.shadows.floating,
  },
  resultIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  partialIconCircle: {
    backgroundColor: '#FEF3C7',
  },
  resultIconEmoji: {
    fontSize: 26,
    fontWeight: '800',
    color: '#10B981',
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  resultSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 18,
  },
  failedItemsBox: {
    width: '100%',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  failedItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  failedItemBullet: {
    fontSize: 14,
  },
  failedItemName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991B1B',
  },
  failedItemReason: {
    fontSize: 11,
    color: '#B91C1C',
  },
  doneLink: {
    fontSize: 13,
    fontWeight: '700',
    color: FigmaTheme.colors.primary,
  },

  // Recovery Card
  recoveryCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    ...FigmaTheme.shadows.floating,
  },
  recoveryIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  recoveryIconEmoji: {
    fontSize: 28,
  },
  recoveryTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
  },
  recoverySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  storageStatsBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 6,
  },
  storageStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statKey: {
    fontSize: 12,
    color: '#64748B',
  },
  statVal: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  reportLink: {
    fontSize: 12,
    color: '#94A3B8',
  },
});

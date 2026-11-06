import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { FigmaTheme } from '../theme/FigmaTheme';

export type SortCriteria = 'NAME' | 'DATE' | 'SIZE';
export type SortDirection = 'ASC' | 'DESC';

interface SortBottomSheetProps {
  visible: boolean;
  criteria: SortCriteria;
  direction: SortDirection;
  onSelectCriteria: (criteria: SortCriteria) => void;
  onSelectDirection: (direction: SortDirection) => void;
  onClose: () => void;
}

export const SortBottomSheet: React.FC<SortBottomSheetProps> = ({
  visible,
  criteria,
  direction,
  onSelectCriteria,
  onSelectDirection,
  onClose,
}) => {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1}>
          {/* Handle bar */}
          <View style={styles.handleBar} />

          <Text style={styles.title}>Sort by</Text>

          {/* Sort Options */}
          <TouchableOpacity
            style={styles.optionRow}
            activeOpacity={0.7}
            onPress={() => onSelectCriteria('NAME')}>
            <Text style={[styles.optionLabel, criteria === 'NAME' && styles.optionLabelActive]}>
              Name
            </Text>
            {criteria === 'NAME' && <Text style={styles.checkIcon}>✓</Text>}
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.optionRow}
            activeOpacity={0.7}
            onPress={() => onSelectCriteria('DATE')}>
            <Text style={[styles.optionLabel, criteria === 'DATE' && styles.optionLabelActive]}>
              Date modified
            </Text>
            {criteria === 'DATE' && <Text style={styles.checkIcon}>✓</Text>}
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.optionRow}
            activeOpacity={0.7}
            onPress={() => onSelectCriteria('SIZE')}>
            <Text style={[styles.optionLabel, criteria === 'SIZE' && styles.optionLabelActive]}>
              File size
            </Text>
            {criteria === 'SIZE' && <Text style={styles.checkIcon}>✓</Text>}
          </TouchableOpacity>

          {/* Order Segmented Control */}
          <View style={styles.orderSegmentBox}>
            <TouchableOpacity
              style={[styles.segmentBtn, direction === 'ASC' && styles.segmentBtnActive]}
              activeOpacity={0.7}
              onPress={() => onSelectDirection('ASC')}>
              <Text style={[styles.segmentText, direction === 'ASC' && styles.segmentTextActive]}>
                {criteria === 'SIZE' ? 'Smallest first' : criteria === 'DATE' ? 'Oldest first' : 'A to Z'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.segmentBtn, direction === 'DESC' && styles.segmentBtnActive]}
              activeOpacity={0.7}
              onPress={() => onSelectDirection('DESC')}>
              <Text style={[styles.segmentText, direction === 'DESC' && styles.segmentTextActive]}>
                {criteria === 'SIZE' ? 'Largest first' : criteria === 'DATE' ? 'Newest first' : 'Z to A'}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  handleBar: {
    width: 40,
    height: 4,
    backgroundColor: '#cbd5e1',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: FigmaTheme.colors.textPrimary,
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  optionLabel: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#0F172A',
  },
  optionLabelActive: {
    color: '#016EEF',
    fontWeight: '700',
  },
  checkIcon: {
    fontSize: 16,
    fontWeight: '800',
    color: '#016EEF',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  orderSegmentBox: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginTop: 20,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  segmentTextActive: {
    color: '#0F172A',
    fontWeight: '700',
  },
});


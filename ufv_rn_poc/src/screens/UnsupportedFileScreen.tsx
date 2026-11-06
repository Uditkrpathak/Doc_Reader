import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Alert,
} from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { WarningTriangleIcon, ShareVectorIcon } from '../components/AppIcons';

interface UnsupportedFileScreenProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export const UnsupportedFileScreen: React.FC<UnsupportedFileScreenProps> = ({
  filePath,
  fileName,
  onClose,
}) => {
  const [hasReported, setHasReported] = useState<boolean>(false);
  const ext = (fileName.split('.').pop() || 'FILE').toUpperCase();

  const handleShare = async () => {
    try {
      await ArchiveEngine.getInstance().shareFile(filePath);
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  const handleReport = () => {
    setHasReported(true);
    Alert.alert(
      'Feedback Received',
      `Thank you for reporting. Support for ${ext} files has been prioritized for future updates.`,
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionMenuBtn} onPress={handleShare} activeOpacity={0.7}>
          <Text style={styles.actionMenuDots}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* Center Content */}
      <View style={styles.content}>
        {/* Large File Type Badge Card */}
        <View style={styles.iconCard}>
          {/* Folded Top-Right Corner */}
          <View style={styles.foldedCorner} />

          {/* Extension Pill Badge */}
          <View style={styles.extensionBadge}>
            <Text style={styles.extensionBadgeText}>{ext}</Text>
          </View>

          {/* Warning Badge at Bottom-Right */}
          <View style={styles.warningBadge}>
            <WarningTriangleIcon size={13} color="#EA580C" innerColor="#FFF7ED" />
          </View>
        </View>

        {/* Title & File Info */}
        <Text style={styles.title}>This file type isn't supported yet</Text>
        <Text style={styles.fileNameText} numberOfLines={1}>
          {fileName}
        </Text>
        <Text style={styles.subtitle}>
          You can share it to another app that can open this format.
        </Text>

        {/* Action Buttons */}
        <TouchableOpacity
          style={styles.shareBtn}
          activeOpacity={0.8}
          onPress={handleShare}>
          <ShareVectorIcon size={18} color="#FFFFFF" />
          <Text style={styles.shareBtnText}>Share file</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backBtnAction}
          activeOpacity={0.8}
          onPress={onClose}>
          <Text style={styles.backBtnActionText}>Back to files</Text>
        </TouchableOpacity>

        {/* Report Problem Link */}
        <TouchableOpacity
          style={styles.reportLinkBtn}
          activeOpacity={0.7}
          onPress={handleReport}>
          <Text style={styles.reportLinkText}>
            {hasReported ? '✓ Problem reported' : 'Report a file-opening problem'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#016EEF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionMenuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionMenuDots: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  iconCard: {
    width: 86,
    height: 100,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    borderWidth: 1.5,
    borderColor: '#E0E7FF',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginBottom: 24,
  },
  foldedCorner: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    backgroundColor: '#C7D2FE',
    borderBottomLeftRadius: 8,
  },
  extensionBadge: {
    backgroundColor: '#7C3AED',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  extensionBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  warningBadge: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FFF7ED',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
  },
  fileNameText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
    marginBottom: 8,
    maxWidth: 280,
  },
  subtitle: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
    marginBottom: 24,
  },
  shareBtn: {
    backgroundColor: '#016EEF',
    height: 48,
    borderRadius: 12,
    width: '100%',
    maxWidth: 280,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
  backBtnAction: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#016EEF',
    height: 48,
    borderRadius: 12,
    width: '100%',
    maxWidth: 280,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  backBtnActionText: {
    color: '#016EEF',
    fontSize: 15,
    fontWeight: '700',
  },
  reportLinkBtn: {
    marginTop: 24,
    paddingVertical: 8,
  },
  reportLinkText: {
    color: '#016EEF',
    fontSize: 13.5,
    fontWeight: '600',
  },
});


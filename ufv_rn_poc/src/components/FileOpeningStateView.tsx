import React from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Alert,
} from 'react-native';
import { FileOpeningState, FileOpeningContext } from '../state/FileOpeningStateMachine';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { WarningTriangleIcon, ShareVectorIcon } from './AppIcons';

interface FileOpeningStateViewProps {
  state: FileOpeningState;
  context: FileOpeningContext;
  onRetry: () => void;
  onRequestAccess: () => void;
  onCancel: () => void;
}

export const FileOpeningStateView: React.FC<FileOpeningStateViewProps> = ({
  state,
  context,
  onRetry,
  onRequestAccess,
  onCancel,
}) => {
  // If idle, cancelled, ready, or password required, don't show full-screen overlay
  if (state === 'IDLE' || state === 'CANCELLED' || state === 'READY' || state === 'PASSWORD_REQUIRED') {
    return null;
  }

  const isTransitioning =
    state === 'ACCESS_CHECK' ||
    state === 'FILE_VALIDATION' ||
    state === 'TYPE_DETECTION' ||
    state === 'ENGINE_INITIALIZATION' ||
    state === 'RENDERING';

  const getTransitionLabel = () => {
    switch (state) {
      case 'ACCESS_CHECK':
        return 'Checking Storage Permissions...';
      case 'FILE_VALIDATION':
        return 'Validating Document Integrity...';
      case 'TYPE_DETECTION':
        return 'Detecting File Format...';
      case 'ENGINE_INITIALIZATION':
        return 'Initializing Engine...';
      case 'RENDERING':
        return 'Rendering Document...';
      default:
        return 'Opening File...';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      {/* Top Header with Cancel */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {context.fileName || 'Opening Document'}
        </Text>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} activeOpacity={0.7}>
          <Text style={styles.cancelBtnText}>✕ Cancel</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        {/* Transitional States */}
        {isTransitioning && (
          <View style={styles.card}>
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text style={styles.stepTitle}>{getTransitionLabel()}</Text>
            <Text style={styles.stepSubtitle}>
              Step: {state}
            </Text>
          </View>
        )}

        {/* ACCESS_REQUIRED */}
        {state === 'ACCESS_REQUIRED' && (
          <View style={styles.card}>
            <Text style={styles.errorIcon}>🔒</Text>
            <Text style={styles.errorTitle}>Storage Access Required</Text>
            <Text style={styles.errorDesc}>
              Universal File Viewer needs permission to read this file. Please allow access in Settings.
            </Text>
            <TouchableOpacity style={styles.primaryActionBtn} onPress={onRequestAccess} activeOpacity={0.8}>
              <Text style={styles.primaryActionText}>Grant Access</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* FIGMA SCREEN 5: UNSUPPORTED_FORMAT */}
        {state === 'UNSUPPORTED_FORMAT' && (
          <View style={styles.cleanScreenCard}>
            <View style={styles.iconCard}>
              <View style={styles.foldedCorner} />
              <View style={styles.extensionBadge}>
                <Text style={styles.extensionBadgeText}>
                  {(context.fileName?.split('.').pop() || 'FILE').toUpperCase()}
                </Text>
              </View>
              <View style={styles.warningBadge}>
                <WarningTriangleIcon size={13} color="#EA580C" innerColor="#FFF7ED" />
              </View>
            </View>

            <Text style={styles.figmaTitle}>This file type isn't supported yet</Text>
            <Text style={styles.figmaFileName} numberOfLines={1}>
              {context.fileName}
            </Text>
            <Text style={styles.figmaSubtitle}>
              You can share it to another app that can open this format.
            </Text>

            <TouchableOpacity
              style={styles.figmaShareBtn}
              activeOpacity={0.8}
              onPress={() => {
                if (context.filePath) {
                  ArchiveEngine.getInstance().shareFile(context.filePath);
                }
              }}>
              <ShareVectorIcon size={18} color="#FFFFFF" />
              <Text style={styles.figmaShareBtnText}>Share file</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.figmaBackBtn}
              activeOpacity={0.8}
              onPress={onCancel}>
              <Text style={styles.figmaBackBtnText}>Back to files</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.reportProblemLink}
              activeOpacity={0.7}
              onPress={() => {
                Alert.alert(
                  'Feedback Received',
                  'Thank you for reporting. Support for this format will be prioritized in upcoming updates.',
                  [{ text: 'OK' }]
                );
              }}>
              <Text style={styles.reportProblemLinkText}>Report a file-opening problem</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* FIGMA SCREEN 1/4: CORRUPTED_FILE */}
        {state === 'CORRUPTED_FILE' && (
          <View style={styles.cleanScreenCard}>
            <View style={styles.errorIconCircle}>
              <WarningTriangleIcon size={30} color="#EA580C" innerColor="#FFF7ED" />
            </View>
            <Text style={styles.figmaTitle}>This document can't be displayed</Text>
            <Text style={styles.figmaSubtitle}>
              The file may use formatting that isn't supported. You can still share the original instead.
            </Text>

            <TouchableOpacity
              style={styles.figmaShareBtn}
              activeOpacity={0.8}
              onPress={() => {
                if (context.filePath) {
                  ArchiveEngine.getInstance().shareFile(context.filePath);
                }
              }}>
              <Text style={styles.figmaShareBtnText}>Share file</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.figmaBackBtn}
              activeOpacity={0.8}
              onPress={onCancel}>
              <Text style={styles.figmaBackBtnText}>Back to files</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* RESOURCE_LIMIT_REACHED */}
        {state === 'RESOURCE_LIMIT_REACHED' && (
          <View style={styles.card}>
            <Text style={styles.errorIcon}>💾</Text>
            <Text style={styles.errorTitle}>Storage Limit Reached</Text>
            <Text style={styles.errorDesc}>
              {context.error || 'Device storage is critically low (<25MB free). Free up space to open files.'}
            </Text>
            <TouchableOpacity style={styles.secondaryActionBtn} onPress={onCancel} activeOpacity={0.8}>
              <Text style={styles.secondaryActionText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* RETRY_AVAILABLE */}
        {state === 'RETRY_AVAILABLE' && (
          <View style={styles.card}>
            <Text style={styles.errorIcon}>🔄</Text>
            <Text style={styles.errorTitle}>Could Not Open File</Text>
            <Text style={styles.errorDesc}>
              {context.error || 'An unexpected error occurred while loading this document.'}
            </Text>
            <TouchableOpacity style={styles.primaryActionBtn} onPress={onRetry} activeOpacity={0.8}>
              <Text style={styles.primaryActionText}>Try Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryActionBtn, { marginTop: 10 }]} onPress={onCancel} activeOpacity={0.8}>
              <Text style={styles.secondaryActionText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    zIndex: 9999,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    flex: 1,
    marginRight: 12,
  },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#334155',
  },
  cancelBtnText: {
    fontSize: 12,
    color: '#cbd5e1',
    fontWeight: '600',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#1e293b',
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    marginTop: 16,
    textAlign: 'center',
  },
  stepSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
    fontFamily: 'monospace',
  },
  errorIcon: {
    fontSize: 38,
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 8,
  },
  errorDesc: {
    fontSize: 13,
    lineHeight: 18,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
  },
  primaryActionBtn: {
    width: '100%',
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    width: '100%',
    backgroundColor: 'transparent',
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#475569',
  },
  secondaryActionText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '600',
  },
  cleanScreenCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
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
    marginBottom: 20,
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
  },
  errorIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  figmaTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
  },
  figmaFileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
    marginBottom: 8,
    maxWidth: 280,
  },
  figmaSubtitle: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
    marginBottom: 22,
  },
  figmaShareBtn: {
    backgroundColor: '#016EEF',
    height: 48,
    borderRadius: 12,
    width: '100%',
    maxWidth: 280,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  figmaShareBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 8,
  },
  figmaBackBtn: {
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
  figmaBackBtnText: {
    color: '#016EEF',
    fontSize: 15,
    fontWeight: '700',
  },
  reportProblemLink: {
    marginTop: 20,
    paddingVertical: 6,
  },
  reportProblemLinkText: {
    color: '#016EEF',
    fontSize: 13,
    fontWeight: '600',
  },
});


import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Dimensions,
} from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { AudioService } from '../services/AudioPlaybackService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface MediaViewerProps {
  filePath: string;
  fileName: string;
  category: 'AUDIO' | 'VIDEO';
  onClose: () => void;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({
  filePath,
  fileName,
  category,
  onClose,
}) => {
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLaunchingNative, setIsLaunchingNative] = useState<boolean>(false);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [positionMs, setPositionMs] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to play');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const engine = ArchiveEngine.getInstance();
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const isVideo = category === 'VIDEO';

  const formatTime = (ms: number): string => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  useEffect(() => {
    if (isVideo) {
      return;
    }

    // Connect to AudioService
    const current = AudioService.getTrack();
    if (!current || current.filePath !== filePath) {
      AudioService.playTrack(filePath, fileName).catch((err) => {
        setErrorMsg(`Audio Playback Error: ${err.message || String(err)}`);
      });
    }

    const unsubscribe = AudioService.subscribe((track) => {
      if (track && track.filePath === filePath) {
        setIsPlaying(track.isPlaying);
        setDurationMs(track.durationMs);
        setPositionMs(track.positionMs);
        setStatusMessage(track.isPlaying ? 'Playing' : 'Paused');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [filePath, isVideo]);

  const handlePlayPause = async () => {
    if (!isVideo) {
      await AudioService.togglePlayPause();
    }
  };

  const handleSkip = async (offsetSec: number) => {
    if (!isVideo) {
      await AudioService.skip(offsetSec);
    }
  };

  const handleSeekFromBar = async (event: any) => {
    if (durationMs <= 0 || isVideo) return;
    const clickX = event.nativeEvent.locationX;
    const barWidth = SCREEN_WIDTH - 64;
    const ratio = Math.max(0, Math.min(1, clickX / barWidth));
    const targetMs = Math.round(ratio * durationMs);
    await AudioService.seek(targetMs);
  };

  const handleLaunchNativeVideo = async () => {
    setIsLaunchingNative(true);
    setStatusMessage('Launching hardware video surface...');
    try {
      const res = await engine.playVideo(filePath, false);
      if (res.status === 'PASS' || res.status === 'COMPLETED') {
        setStatusMessage('Video completed');
      } else {
        setStatusMessage('Playback dismissed');
      }
    } catch (err: any) {
      setStatusMessage(`Player Error: ${err.message || String(err)}`);
    } finally {
      setIsLaunchingNative(false);
    }
  };

  const handleShare = async () => {
    try {
      const mime = isVideo ? 'video/*' : 'audio/*';
      await engine.shareFile(filePath, mime);
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  const handleStopAudio = async () => {
    await AudioService.stop();
    setIsPlaying(false);
    setStatusMessage('Stopped');
  };

  const progressFraction = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.fileName} numberOfLines={1}>
            {isVideo ? '🎬' : '🎵'} {fileName}
          </Text>
          <Text style={styles.subText}>
            {isVideo ? 'Hardware Video Player' : 'Background Audio Player'} • {ext.toUpperCase()}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
            <Text style={styles.shareBtnText}>📤 Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Viewport */}
      <View style={styles.viewport}>
        {/* Animated Artwork Icon */}
        <View style={[styles.mediaCircle, isPlaying && styles.mediaCirclePlaying]}>
          <Text style={styles.mediaIcon}>{isVideo ? '🎬' : '🎵'}</Text>
        </View>

        <Text style={styles.mediaTitle} numberOfLines={2}>
          {fileName}
        </Text>
        <Text style={styles.mediaStatus}>{statusMessage}</Text>

        {errorMsg && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        )}

        {/* Video Player Action Card */}
        {isVideo ? (
          <View style={styles.videoLaunchBox}>
            <Text style={styles.videoHint}>
              Renders with 60 FPS hardware acceleration & 10s skip controls.
            </Text>
            <TouchableOpacity
              style={styles.launchBtn}
              disabled={isLaunchingNative}
              onPress={handleLaunchNativeVideo}
              activeOpacity={0.8}>
              {isLaunchingNative ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.launchBtnText}>▶ START VIDEO PLAYBACK</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          /* Native Audio Controls Card */
          <View style={styles.audioControlsBox}>
            {/* Scrubber & Time */}
            <TouchableOpacity
              style={styles.progressBarArea}
              activeOpacity={1}
              onPress={handleSeekFromBar}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressFraction * 100}%` }]} />
              </View>
            </TouchableOpacity>

            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{formatTime(positionMs)}</Text>
              <Text style={styles.timeText}>{formatTime(durationMs)}</Text>
            </View>

            {/* Transport Control Buttons */}
            <View style={styles.transportRow}>
              <TouchableOpacity
                style={styles.skipBtn}
                onPress={() => handleSkip(-10)}
                activeOpacity={0.7}>
                <Text style={styles.skipIcon}>↺ 10s</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.playPauseBtn}
                onPress={handlePlayPause}
                activeOpacity={0.8}>
                <Text style={styles.playPauseIcon}>{isPlaying ? '⏸' : '▶'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.skipBtn}
                onPress={() => handleSkip(10)}
                activeOpacity={0.7}>
                <Text style={styles.skipIcon}>10s ↻</Text>
              </TouchableOpacity>
            </View>

            {/* Stop & Background Note */}
            <View style={styles.bottomActionsRow}>
              <TouchableOpacity style={styles.stopBtn} onPress={handleStopAudio}>
                <Text style={styles.stopBtnText}>⏹ Stop</Text>
              </TouchableOpacity>
              <Text style={styles.bgTip}>🎵 Continues playing in background when closed</Text>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#1e293b',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerLeft: {
    flex: 1,
    marginRight: 10,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#334155',
    borderRadius: 8,
  },
  shareBtnText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#334155',
    borderRadius: 8,
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  viewport: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  mediaCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#334155',
  },
  mediaCirclePlaying: {
    borderColor: '#38bdf8',
    elevation: 8,
    shadowColor: '#38bdf8',
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  mediaIcon: {
    fontSize: 56,
  },
  mediaTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    textAlign: 'center',
    marginBottom: 6,
  },
  mediaStatus: {
    fontSize: 13,
    color: '#38bdf8',
    fontWeight: '600',
    marginBottom: 20,
  },
  errorBox: {
    backgroundColor: '#451a1a',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    width: '100%',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    textAlign: 'center',
  },
  videoLaunchBox: {
    width: '100%',
    alignItems: 'center',
    marginTop: 10,
  },
  videoHint: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 16,
  },
  launchBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    elevation: 4,
  },
  launchBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  audioControlsBox: {
    width: '100%',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  progressBarArea: {
    paddingVertical: 8,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
    borderRadius: 3,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  timeText: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  transportRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    marginTop: 16,
  },
  skipBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  skipIcon: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  playPauseBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
  },
  playPauseIcon: {
    fontSize: 26,
    color: '#0f172a',
    fontWeight: '800',
  },
  bottomActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  stopBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#334155',
    borderRadius: 6,
  },
  stopBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f87171',
  },
  bgTip: {
    fontSize: 10,
    color: '#64748b',
    flex: 1,
    textAlign: 'right',
    marginLeft: 10,
  },
});

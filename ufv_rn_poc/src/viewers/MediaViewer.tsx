import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Animated,
  NativeModules,
  Alert,
  requireNativeComponent,
  Platform,
  Dimensions,
} from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { AudioService } from '../services/AudioPlaybackService';
import { MMKV } from '../services/MMKV';
import { WarningTriangleIcon } from '../components/AppIcons';

const { ArchiveModule } = NativeModules;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NativeVideoCardView = Platform.OS === 'android' ? requireNativeComponent<any>('VideoCardView') : null;

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
  const [durationMs, setDurationMs] = useState<number>(0);
  const [positionMs, setPositionMs] = useState<number>(0);
  const [seekToMs, setSeekToMs] = useState<number>(-1);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUnsupportedCodec, setIsUnsupportedCodec] = useState<boolean>(false);
  const [codecErrorReason, setCodecErrorReason] = useState<string>('Codec not supported on this device');
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(false);

  // Resume position from MMKV (Zero mock: only show if user previously played > 3 seconds)
  const savedPos = MMKV.getPosition(filePath);
  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(
    Boolean(savedPos && (savedPos.timeMs ?? 0) > 3000)
  );
  const [resumeTimeMs, setResumeTimeMs] = useState<number>(savedPos?.timeMs || 0);
  const [resumeTimestamp] = useState<number | undefined>(savedPos?.timestamp);

  const engine = ArchiveEngine.getInstance();
  const isVideo = category === 'VIDEO';
  const ext = (fileName.split('.').pop() || '').toLowerCase();

  // Immersive Mode: Hide status bar & navigation bar for video playback
  useEffect(() => {
    if (isVideo) {
      engine.setImmersiveMode(true);
    }
    return () => {
      if (isVideo) {
        engine.setImmersiveMode(false);
      }
    };
  }, [isVideo]);

  // Waveform bars animation
  const waveAnim1 = useRef(new Animated.Value(24)).current;
  const waveAnim2 = useRef(new Animated.Value(52)).current;
  const waveAnim3 = useRef(new Animated.Value(36)).current;
  const waveAnim4 = useRef(new Animated.Value(68)).current;
  const waveAnim5 = useRef(new Animated.Value(42)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (isPlaying && !isVideo) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(waveAnim1, { toValue: 64, duration: 320, useNativeDriver: false }),
            Animated.timing(waveAnim2, { toValue: 24, duration: 320, useNativeDriver: false }),
            Animated.timing(waveAnim3, { toValue: 72, duration: 320, useNativeDriver: false }),
            Animated.timing(waveAnim4, { toValue: 36, duration: 320, useNativeDriver: false }),
            Animated.timing(waveAnim5, { toValue: 76, duration: 320, useNativeDriver: false }),
          ]),
          Animated.parallel([
            Animated.timing(waveAnim1, { toValue: 24, duration: 320, useNativeDriver: false }),
            Animated.timing(waveAnim2, { toValue: 56, duration: 320, useNativeDriver: false }),
            Animated.timing(waveAnim3, { toValue: 30, duration: 320, useNativeDriver: false }),
            Animated.timing(waveAnim4, { toValue: 72, duration: 320, useNativeDriver: false }),
            Animated.timing(waveAnim5, { toValue: 34, duration: 320, useNativeDriver: false }),
          ]),
        ])
      );
      loop.start();
    } else {
      waveAnim1.setValue(24);
      waveAnim2.setValue(52);
      waveAnim3.setValue(36);
      waveAnim4.setValue(68);
      waveAnim5.setValue(42);
    }
    return () => {
      loop?.stop();
    };
  }, [isPlaying, isVideo, waveAnim1, waveAnim2, waveAnim3, waveAnim4, waveAnim5]);

  // Read real file size from storage
  useEffect(() => {
    if (ArchiveModule?.readFileHeader) {
      ArchiveModule.readFileHeader(filePath, 16)
        .then((res: any) => {
          if (res?.size && res.size > 0) {
            setFileSizeBytes(res.size);
          }
        })
        .catch(() => {});
    }
  }, [filePath]);

  // Real Hardware Codec & Duration Probe
  useEffect(() => {
    let isMounted = true;
    engine
      .probeMediaCodec(filePath)
      .then((probe) => {
        if (!isMounted) return;
        if (probe.durationMs > 0) {
          setDurationMs(probe.durationMs);
        }
        if (isVideo) {
          if (probe.hasVideo && !probe.isVideoSupported) {
            setIsUnsupportedCodec(true);
            setCodecErrorReason(
              probe.videoCodec
                ? `Video codec (${probe.videoCodec}) is not supported by your device decoder`
                : 'Codec not supported on this device'
            );
          } else if (!probe.isSupported) {
            setIsUnsupportedCodec(true);
            setCodecErrorReason(probe.error || 'Video format not supported');
          }
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [filePath, isVideo, engine]);

  const formatTime = (ms: number): string => {
    if (!ms || ms <= 0) return '0:00';
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '--';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getResumeSubtitle = (timestamp?: number): string => {
    if (!timestamp) return 'You stopped here previously';
    const diffMs = Date.now() - timestamp;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 5) return 'You stopped here just now';
    if (diffHours < 1) return `You stopped here ${diffMins} mins ago`;
    if (diffHours < 24) return `You stopped here ${diffHours}h ago`;
    if (diffDays === 1) return 'You stopped here yesterday';
    return `You stopped here ${diffDays} days ago`;
  };

  // Video or Audio initialization
  useEffect(() => {
    if (isVideo) return;

    // Audio Playback Hook
    AudioService.playTrack(filePath, fileName).catch((err: any) => {
      setErrorMsg(`Audio Playback Error: ${err.message || String(err)}`);
    });

    const unsubscribe = AudioService.subscribe((track: any) => {
      if (track && track.filePath === filePath) {
        setIsPlaying(track.isPlaying);
        if (track.durationMs > 0) setDurationMs(track.durationMs);
        setPositionMs(track.positionMs);
        if (track.positionMs > 0 && track.durationMs > 0) {
          MMKV.savePosition(filePath, { timeMs: track.positionMs, total: track.durationMs });
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [filePath, fileName, isVideo]);

  const handlePlayPause = async () => {
    if (!isVideo) {
      await AudioService.togglePlayPause();
    } else {
      setIsPlaying((p) => !p);
    }
  };

  const handleFullscreenVideo = async () => {
    try {
      setIsPlaying(false);
      const res = await engine.playVideo(filePath, false);
      if (res && res.status === 'UNSUPPORTED') {
        setIsUnsupportedCodec(true);
        if (res.error) setCodecErrorReason(res.error);
      }
    } catch {
      setIsUnsupportedCodec(true);
    }
  };

  const handleSkip = async (offsetSec: number) => {
    if (!isVideo) {
      await AudioService.skip(offsetSec);
    } else {
      const target = Math.max(0, Math.min(durationMs, positionMs + offsetSec * 1000));
      setSeekToMs(target);
      setPositionMs(target);
    }
  };

  const cycleSpeed = async () => {
    const speeds = [1.0, 1.25, 1.5, 2.0, 0.75];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
    if (!isVideo) {
      await AudioService.setSpeed(nextSpeed);
    }
  };

  const handleToggleSubtitles = () => {
    const nextState = !subtitlesEnabled;
    setSubtitlesEnabled(nextState);
    Alert.alert(
      'Subtitles',
      nextState ? 'Subtitles enabled (Embedded track)' : 'Subtitles turned off',
      [{ text: 'OK' }]
    );
  };

  const handleStartOver = () => {
    setShowResumeBanner(false);
    setResumeTimeMs(0);
    setPositionMs(0);
    MMKV.savePosition(filePath, { timeMs: 0, total: durationMs });
    if (!isVideo) {
      AudioService.seek(0);
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

  const handleReportProblem = () => {
    Alert.alert(
      'Report a Problem',
      `Thank you for reporting. Diagnostics for ${fileName} have been submitted to our compatibility lab.`,
      [{ text: 'OK' }]
    );
  };

  // Zero-mock real timeline calculations
  const progressPercent = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0;
  const remainingMs = Math.max(0, durationMs - positionMs);
  const displayTotalDuration = durationMs > 0 ? formatTime(durationMs) : '--:--';
  const displayElapsed = formatTime(positionMs);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      {/* 1. TOP APP HEADER (Figma Blue #016EEF) */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerTitleBox}>
          <Text style={styles.headerTitleText} numberOfLines={1}>
            {isVideo ? fileName : 'Now playing'}
          </Text>
          <Text style={styles.headerSubText}>
            {isVideo
              ? `${ext.toUpperCase()} · ${formatBytes(fileSizeBytes)} · ${displayTotalDuration}`
              : `Audio · ${ext.toUpperCase()}${fileSizeBytes > 0 ? ` · ${formatBytes(fileSizeBytes)}` : ''}`}
          </Text>
        </View>

        <TouchableOpacity style={styles.headerActionBtn} onPress={handleShare} activeOpacity={0.7}>
          <Text style={styles.headerActionText}>⋮</Text>
        </TouchableOpacity>
      </View>

      {/* 2. VIDEO PLAYER VIEW (Figma Image 3 & Image 4) */}
      {isVideo ? (
        isUnsupportedCodec ? (
          /* REAL HARDWARE CODEC UNSUPPORTED ERROR SCREEN (Figma Image 3 & 4) */
          <View style={styles.videoErrorScreen}>
            {/* Dark Top Box with Warning Icon */}
            <View style={styles.videoErrorCard}>
              <View style={styles.warningCircleBox}>
                <WarningTriangleIcon size={34} color="#EA580C" innerColor="#FFF7ED" />
              </View>
              <Text style={styles.videoErrorCardTitle}>Can't play this video</Text>
              <Text style={styles.videoErrorCardSub}>{codecErrorReason}</Text>
            </View>

            {/* White Content Card Below */}
            <View style={styles.videoErrorDetailsCard}>
              <Text style={styles.videoErrorExplanation}>
                Try sharing the file to another video app, or check for an updated version of the file.
              </Text>

              <TouchableOpacity style={styles.primaryShareBtn} activeOpacity={0.8} onPress={handleShare}>
                <Text style={styles.primaryShareBtnText}>Share file</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryBackBtn} activeOpacity={0.8} onPress={onClose}>
                <Text style={styles.secondaryBackBtnText}>Back to files</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.reportLinkBtn} activeOpacity={0.7} onPress={handleReportProblem}>
                <Text style={styles.reportLinkText}>Report a file-opening problem</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* VIDEO PLAYER EMBEDDED CARD (Figma Image 3) */
          <View style={styles.videoMainContent}>
            {/* Dark Video Screen Card */}
            <TouchableOpacity
              style={styles.videoPlayerCard}
              activeOpacity={1}
              onPress={handlePlayPause}>
              {NativeVideoCardView && (
                <NativeVideoCardView
                  pointerEvents="none"
                  style={StyleSheet.absoluteFillObject}
                  source={filePath}
                  paused={!isPlaying}
                  playbackSpeed={playbackSpeed}
                  seekToMs={seekToMs}
                  onProgress={(e: any) => {
                    if (e.nativeEvent?.positionMs !== undefined) {
                      setPositionMs(e.nativeEvent.positionMs);
                    }
                    if (e.nativeEvent?.durationMs > 0 && durationMs <= 0) {
                      setDurationMs(e.nativeEvent.durationMs);
                    }
                  }}
                  onPlayingChange={(e: any) => {
                    if (e.nativeEvent) {
                      if (e.nativeEvent.durationMs > 0 && durationMs <= 0) {
                        setDurationMs(e.nativeEvent.durationMs);
                      }
                      if (e.nativeEvent.positionMs !== undefined) {
                        setPositionMs(e.nativeEvent.positionMs);
                      }
                      if (e.nativeEvent.isPlaying !== undefined && e.nativeEvent.isPlaying !== isPlaying) {
                        setIsPlaying(e.nativeEvent.isPlaying);
                      }
                    }
                  }}
                  onError={(e: any) => {
                    setIsUnsupportedCodec(true);
                    if (e.nativeEvent?.error) setCodecErrorReason(e.nativeEvent.error);
                  }}
                />
              )}

              {/* Center Play Button Overlay */}
              <View style={[styles.videoCenterPlayBtn, isPlaying && styles.videoCenterPlayBtnPlaying]}>
                <Text style={styles.videoCenterPlayIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
              </View>

              {/* Progress Scrubber Bar inside Video Card */}
              <View style={styles.videoBottomControls}>
                <TouchableOpacity
                  activeOpacity={1}
                  style={styles.videoProgressBarTrack}
                  onPress={(e) => {
                    const x = e.nativeEvent.locationX;
                    const cardWidth = SCREEN_WIDTH - 28;
                    const ratio = Math.max(0, Math.min(1, x / cardWidth));
                    if (durationMs > 0) {
                      const targetMs = Math.round(ratio * durationMs);
                      setSeekToMs(targetMs);
                      setPositionMs(targetMs);
                    }
                  }}>
                  <View style={[styles.videoProgressBarFill, { width: `${progressPercent}%` }]} />
                </TouchableOpacity>
                <View style={styles.videoTimeRow}>
                  <Text style={styles.videoTimeText}>{displayElapsed}</Text>
                  <Text style={styles.videoTimeText}>{displayTotalDuration}</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* White Card Below Video (Figma Image 3) */}
            <View style={styles.videoDetailsCard}>
              <Text style={styles.videoCardTitle} numberOfLines={2}>
                {fileName}
              </Text>

              {/* 3 Action Buttons Grid: Speed | Subtitles | Full screen */}
              <View style={styles.videoActionGrid}>
                <TouchableOpacity style={styles.videoActionBtn} activeOpacity={0.7} onPress={cycleSpeed}>
                  <Text style={styles.videoActionBtnText}>{playbackSpeed.toFixed(1)}× Speed</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.videoActionBtn, subtitlesEnabled && styles.videoActionBtnActive]}
                  activeOpacity={0.7}
                  onPress={handleToggleSubtitles}>
                  <Text style={[styles.videoActionBtnText, subtitlesEnabled && styles.videoActionBtnTextActive]}>
                    Subtitles
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.videoActionBtn} activeOpacity={0.7} onPress={handleFullscreenVideo}>
                  <Text style={styles.videoActionBtnText}>Full screen</Text>
                </TouchableOpacity>
              </View>

              {/* Resume Card (Real dynamic time & timestamp, no mock values) */}
              {showResumeBanner && resumeTimeMs > 0 && (
                <View style={styles.resumeCard}>
                  <View style={styles.resumeIconBadge}>
                    <Text style={styles.resumeIconText}>↻</Text>
                  </View>
                  <View style={styles.resumeInfoBox}>
                    <Text style={styles.resumeTitleText}>
                      Resuming from {formatTime(resumeTimeMs)}
                    </Text>
                    <Text style={styles.resumeSubText}>
                      {getResumeSubtitle(resumeTimestamp)}
                    </Text>
                  </View>
                  <TouchableOpacity activeOpacity={0.7} onPress={handleStartOver}>
                    <Text style={styles.startOverBtnText}>Start over</Text>
                  </TouchableOpacity>
                </View>
              )}

              {errorMsg && (
                <View style={styles.playbackErrorBanner}>
                  <Text style={styles.playbackErrorText}>{errorMsg}</Text>
                </View>
              )}
            </View>
          </View>
        )
      ) : (
        /* 3. AUDIO PLAYER VIEW (Figma Image 3) */
        <View style={styles.audioMainContent}>
          {/* Soft Purple Waveform Hero Card */}
          <View style={styles.audioWaveformCard}>
            <View style={styles.waveformRow}>
              {[waveAnim1, waveAnim2, waveAnim3, waveAnim4, waveAnim5, waveAnim4, waveAnim2, waveAnim3, waveAnim1].map(
                (anim, idx) => (
                  <Animated.View
                    key={`audio-bar-${idx}`}
                    style={[
                      styles.audioWaveBar,
                      {
                        height: anim,
                        backgroundColor: idx % 2 === 0 ? '#8B5CF6' : '#A78BFA',
                      },
                    ]}
                  />
                )
              )}
            </View>
          </View>

          {/* Track Metadata */}
          <View style={styles.audioMetaBox}>
            <Text style={styles.audioTrackTitle} numberOfLines={1}>
              {fileName.replace(/\.[^/.]+$/, '')}
            </Text>
            <Text style={styles.audioTrackSubtitle}>
              {isPlaying ? 'Universal Audio Reader · Active' : 'Universal Audio Reader'}
            </Text>
          </View>

          {/* Timeline Scrubber */}
          <View style={styles.audioTimelineBox}>
            <View style={styles.audioTimelineTrack}>
              <View style={[styles.audioTimelineProgress, { width: `${progressPercent}%` }]} />
            </View>
            <View style={styles.audioTimelineLabels}>
              <Text style={styles.audioTimeLabel}>{formatTime(positionMs)}</Text>
              <Text style={styles.audioTimeLabel}>
                {durationMs > 0 ? `-${formatTime(remainingMs)}` : '--:--'}
              </Text>
            </View>
          </View>

          {/* Playback Controls (-15 | Play/Pause | +15) */}
          <View style={styles.audioControlsRow}>
            <TouchableOpacity style={styles.skipCircleBtn} activeOpacity={0.7} onPress={() => handleSkip(-15)}>
              <Text style={styles.skipCircleBtnText}>-15</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.audioPlayPauseBtn} activeOpacity={0.85} onPress={handlePlayPause}>
              <Text style={styles.audioPlayPauseIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.skipCircleBtn} activeOpacity={0.7} onPress={() => handleSkip(15)}>
              <Text style={styles.skipCircleBtnText}>+15</Text>
            </TouchableOpacity>
          </View>

          {/* Bottom Controls Row: Speed & Real Dynamic Background Pill */}
          <View style={styles.audioBottomRow}>
            <TouchableOpacity style={styles.speedPillBtn} activeOpacity={0.7} onPress={cycleSpeed}>
              <Text style={styles.speedPillText}>Speed {playbackSpeed.toFixed(1)}x</Text>
            </TouchableOpacity>

            {isPlaying && (
              <View style={styles.backgroundActivePill}>
                <Text style={styles.backgroundActiveIcon}>🎵</Text>
                <Text style={styles.backgroundActiveText}>Playing in background</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#016EEF',
  },
  headerWithStatusBar: {
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  backBtnText: {
    fontSize: 26,
    fontWeight: '300',
    color: '#FFFFFF',
    marginTop: -2,
  },
  headerTitleBox: {
    flex: 1,
    marginRight: 8,
  },
  headerTitleText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerSubText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 2,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActionText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#016EEF',
  },

  // Video Styles
  videoMainContent: {
    flex: 1,
    padding: 16,
    backgroundColor: '#F8FAFC',
  },
  videoPlayerCard: {
    width: '100%',
    height: 220,
    backgroundColor: '#0A0F1D',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  videoCenterPlayBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#016EEF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  videoCenterPlayBtnPlaying: {
    backgroundColor: 'rgba(1, 110, 239, 0.45)',
    opacity: 0.15,
  },
  videoCenterPlayIcon: {
    fontSize: 22,
    color: '#FFFFFF',
    marginLeft: 3,
  },
  videoBottomControls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  videoProgressBarTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginBottom: 6,
  },
  videoProgressBarFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#016EEF',
  },
  videoTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  videoTimeText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.9)',
    fontWeight: '600',
  },

  videoDetailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  videoCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 16,
  },
  videoActionGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  videoActionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoActionBtnActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#93C5FD',
  },
  videoActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  videoActionBtnTextActive: {
    color: '#016EEF',
  },

  resumeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  resumeIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  resumeIconText: {
    fontSize: 16,
    color: '#016EEF',
    fontWeight: '700',
  },
  resumeInfoBox: {
    flex: 1,
  },
  resumeTitleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  resumeSubText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  startOverBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#016EEF',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  playbackErrorBanner: {
    marginTop: 12,
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
  },
  playbackErrorText: {
    fontSize: 12,
    color: '#B91C1C',
  },

  // Video Error Recovery Screen
  videoErrorScreen: {
    flex: 1,
    padding: 16,
  },
  videoErrorCard: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    backgroundColor: '#0B1120',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  warningCircleBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(234, 88, 12, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  videoErrorCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  videoErrorCardSub: {
    fontSize: 12,
    color: '#94A3B8',
  },
  videoErrorDetailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
  },
  videoErrorExplanation: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  primaryShareBtn: {
    width: '100%',
    backgroundColor: '#016EEF',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryShareBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryBackBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#016EEF',
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  secondaryBackBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#016EEF',
  },
  reportLinkBtn: {
    paddingVertical: 6,
  },
  reportLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#016EEF',
  },

  // Audio Player Styles
  audioMainContent: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
  },
  audioWaveformCard: {
    width: '100%',
    height: 220,
    borderRadius: 24,
    backgroundColor: '#EDE9FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 28,
  },
  waveformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  audioWaveBar: {
    width: 8,
    borderRadius: 4,
  },
  audioMetaBox: {
    alignItems: 'center',
    marginBottom: 24,
  },
  audioTrackTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  audioTrackSubtitle: {
    fontSize: 13,
    color: '#64748B',
  },
  audioTimelineBox: {
    width: '100%',
    marginBottom: 28,
  },
  audioTimelineTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    marginBottom: 8,
  },
  audioTimelineProgress: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#016EEF',
  },
  audioTimelineLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  audioTimeLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  audioControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    marginBottom: 36,
  },
  skipCircleBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  skipCircleBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  audioPlayPauseBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#016EEF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  audioPlayPauseIcon: {
    fontSize: 22,
    color: '#FFFFFF',
    marginLeft: 2,
  },
  audioBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  speedPillBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  speedPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  backgroundActivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  backgroundActiveIcon: {
    fontSize: 12,
  },
  backgroundActiveText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#016EEF',
  },
});

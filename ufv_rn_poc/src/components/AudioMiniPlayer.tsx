import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { AudioService, ActiveTrack } from '../services/AudioPlaybackService';

interface AudioMiniPlayerProps {
  onExpand: (track: ActiveTrack) => void;
}

export const AudioMiniPlayer: React.FC<AudioMiniPlayerProps> = ({ onExpand }) => {
  const [track, setTrack] = useState<ActiveTrack | null>(null);

  useEffect(() => {
    const unsubscribe = AudioService.subscribe((current) => {
      setTrack(current);
    });
    return unsubscribe;
  }, []);

  if (!track) {
    return null;
  }

  const formatTime = (ms: number): string => {
    const totalSecs = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const progressPercent =
    track.durationMs > 0
      ? Math.min(100, Math.max(0, (track.positionMs / track.durationMs) * 100))
      : 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.contentRow}
        activeOpacity={0.85}
        onPress={() => onExpand(track)}>
        {/* Animated / Glowing Vinyl / Note Icon */}
        <View style={styles.iconBox}>
          <Text style={styles.iconText}>{track.isPlaying ? '🎵' : '⏸'}</Text>
        </View>

        {/* Track Title & Elapsed */}
        <View style={styles.metaBox}>
          <Text style={styles.title} numberOfLines={1}>
            {track.fileName}
          </Text>
          <Text style={styles.subText} numberOfLines={1}>
            {formatTime(track.positionMs)} / {formatTime(track.durationMs)} • Audio
          </Text>
        </View>

        {/* Controls */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => AudioService.skip(10)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.skipBtnText}>+10s</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.playPauseBtn}
            onPress={() => AudioService.togglePlayPause()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.playPauseText}>{track.isPlaying ? '⏸' : '▶'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.closeBtn}
            onPress={() => AudioService.stop()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Mini Progress Bar Line */}
      <View style={styles.progressBarTrack}>
        <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f172a',
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: -2 },
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#0284c7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  iconText: {
    fontSize: 18,
  },
  metaBox: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subText: {
    fontSize: 11,
    color: '#38bdf8',
    marginTop: 2,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  skipBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
  },
  skipBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94a3b8',
  },
  playPauseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playPauseText: {
    fontSize: 15,
    color: '#0f172a',
    fontWeight: '800',
  },
  closeBtn: {
    padding: 6,
    marginLeft: 2,
  },
  closeText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 3,
    backgroundColor: '#1e293b',
    width: '100%',
  },
  progressBarFill: {
    height: 3,
    backgroundColor: '#38bdf8',
  },
});

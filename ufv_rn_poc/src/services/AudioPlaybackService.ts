import { ArchiveEngine } from './ArchiveEngine';

export interface ActiveTrack {
  filePath: string;
  fileName: string;
  durationMs: number;
  positionMs: number;
  isPlaying: boolean;
}

type AudioListener = (track: ActiveTrack | null) => void;

class AudioPlaybackService {
  private static instance: AudioPlaybackService;
  private currentTrack: ActiveTrack | null = null;
  private listeners: Set<AudioListener> = new Set();
  private pollInterval: NodeJS.Timeout | null = null;
  private engine = ArchiveEngine.getInstance();

  private constructor() {}

  public static getInstance(): AudioPlaybackService {
    if (!AudioPlaybackService.instance) {
      AudioPlaybackService.instance = new AudioPlaybackService();
    }
    return AudioPlaybackService.instance;
  }

  public subscribe(listener: AudioListener): () => void {
    this.listeners.add(listener);
    listener(this.currentTrack);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => fn(this.currentTrack ? { ...this.currentTrack } : null));
  }

  public getTrack(): ActiveTrack | null {
    return this.currentTrack;
  }

  public async playTrack(filePath: string, fileName: string): Promise<void> {
    try {
      const res = await this.engine.startAudio(filePath);
      this.currentTrack = {
        filePath,
        fileName,
        durationMs: res.durationMs || 0,
        positionMs: res.currentPositionMs || 0,
        isPlaying: true,
      };
      this.notify();
      this.startPolling();
    } catch (err) {
      console.warn('AudioPlaybackService playTrack error', err);
      throw err;
    }
  }

  public async togglePlayPause(): Promise<void> {
    if (!this.currentTrack) return;
    if (this.currentTrack.isPlaying) {
      await this.engine.pauseAudio();
      this.currentTrack.isPlaying = false;
      this.notify();
    } else {
      await this.engine.resumeAudio();
      this.currentTrack.isPlaying = true;
      this.notify();
      this.startPolling();
    }
  }

  public async seek(positionMs: number): Promise<void> {
    if (!this.currentTrack) return;
    const target = Math.max(0, Math.min(this.currentTrack.durationMs, positionMs));
    await this.engine.seekAudio(target);
    this.currentTrack.positionMs = target;
    this.notify();
  }

  public async skip(offsetSec: number): Promise<void> {
    if (!this.currentTrack) return;
    const target = this.currentTrack.positionMs + offsetSec * 1000;
    await this.seek(target);
  }

  public async stop(): Promise<void> {
    this.stopPolling();
    await this.engine.stopAudio();
    this.currentTrack = null;
    this.notify();
  }

  private startPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(async () => {
      if (!this.currentTrack || !this.currentTrack.isPlaying) {
        return;
      }
      try {
        const status = await this.engine.getAudioStatus();
        if (this.currentTrack) {
          if (status.durationMs > 0) {
            this.currentTrack.durationMs = status.durationMs;
          }
          this.currentTrack.positionMs = status.currentPositionMs;
          this.currentTrack.isPlaying = status.isPlaying;
          this.notify();

          if (!status.isPlaying && status.currentPositionMs >= (status.durationMs - 500) && status.durationMs > 0) {
            this.currentTrack.isPlaying = false;
            this.notify();
          }
        }
      } catch {}
    }, 600);
  }

  private stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export const AudioService = AudioPlaybackService.getInstance();


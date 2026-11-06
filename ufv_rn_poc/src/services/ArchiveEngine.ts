import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const { ArchiveModule, RarBridge } = NativeModules;
const archiveEmitter = ArchiveModule ? new NativeEventEmitter(ArchiveModule) : null;

export interface ArchiveEntry {
  path: string;
  name: string;
  isDirectory: boolean;
  uncompressedSize: number;
  compressedSize: number;
  crc32?: number;
  encrypted: boolean;
  format?: 'ZIP' | 'RAR4' | 'RAR5' | 'UNKNOWN';
}

export interface ExtractionProgress {
  currentFile: string;
  entriesProcessed: number;
  bytesExtracted: number;
}

export interface FolderFile {
  name: string;
  path: string;
  size: number;
  isArchive: boolean;
  extension: string;
}

export interface PickedFile {
  name: string;
  path: string;
  size: number;
}

export interface ExtractionResult {
  status: 'SUCCESS' | 'PARTIAL' | 'BLOCKED' | 'CANCELLED' | 'ERROR';
  extractedFiles: string[];
  failedFiles: { path: string; error: string }[];
  totalBytesExtracted: number;
  wallClockMs: number;
  error?: string;
  decompressMs?: number;
  diskWriteMs?: number;
  checksMs?: number;
}

export interface ArchiveLimits {
  maxEntries: number;
  maxSingleFileSize: number;
  maxTotalSize: number;
  maxNestingDepth: number;
  maxExpansionRatio: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 20000,
  maxSingleFileSize: 500 * 1024 * 1024, // 500 MB
  maxTotalSize: 2 * 1024 * 1024 * 1024,  // 2 GB
  maxNestingDepth: 8,
  maxExpansionRatio: 100.0,             // 100:1 ratio abort
};

export class ArchiveEngine {
  private static instance: ArchiveEngine;

  private constructor() { }

  public static getInstance(): ArchiveEngine {
    if (!ArchiveEngine.instance) {
      ArchiveEngine.instance = new ArchiveEngine();
    }
    return ArchiveEngine.instance;
  }

  public async list(archivePath: string, password?: string): Promise<ArchiveEntry[]> {
    if (Platform.OS !== 'android') {
      throw new Error(`Archive listing NOT RUN on ${Platform.OS}: only Android supported in current environment.`);
    }
    return await ArchiveModule.listArchive(archivePath, password || '');
  }

  public async listFolder(folderPath: string): Promise<FolderFile[]> {
    if (Platform.OS !== 'android') {
      return [];
    }
    try {
      return await ArchiveModule.listFolder(folderPath);
    } catch (e) {
      console.warn('listFolder error', e);
      return [];
    }
  }

  public async pickFile(): Promise<PickedFile> {
    if (Platform.OS !== 'android') {
      throw new Error(`pickFile NOT RUN on ${Platform.OS}: only Android supported.`);
    }
    return await ArchiveModule.pickFile();
  }

  public async extractSingleZip(zipFilePath: string, entryName: string, password?: string): Promise<string> {
    if (Platform.OS !== 'android') {
      throw new Error('Only Android supported');
    }
    if (ArchiveModule.extractSingleZipEntryWithPassword) {
      return await ArchiveModule.extractSingleZipEntryWithPassword(zipFilePath, entryName, password || null);
    }
    return await ArchiveModule.extractSingleZipEntry(zipFilePath, entryName);
  }

  public async listRarContents(rarFilePath: string): Promise<{ name: string; size: number; isDirectory: boolean }[]> {
    if (RarBridge && RarBridge.listRarContents) {
      const rawList: string[] = await RarBridge.listRarContents(rarFilePath);
      return rawList.map((item) => {
        const parts = item.split('|');
        return {
          name: parts[0],
          size: parts[1] ? parseInt(parts[1], 10) : 0,
          isDirectory: parts[2] === '1',
        };
      });
    }
    throw new Error('RarBridge native module not available');
  }

  public async extractSingleRar(rarFilePath: string, entryName: string): Promise<string> {
    if (RarBridge && RarBridge.extractSingleFile) {
      return await RarBridge.extractSingleFile(rarFilePath, entryName);
    }
    throw new Error('RarBridge native module not available');
  }

  public async readFileBase64(filePath: string): Promise<string> {
    return await ArchiveModule.readFileBase64(filePath);
  }

  public async getPptxMeta(pptxFilePath: string): Promise<{
    status: string;
    slideCount: number;
    widthEMU: number;
    heightEMU: number;
    aspectRatio: number;
  }> {
    if (ArchiveModule && ArchiveModule.getPptxMeta) {
      return await ArchiveModule.getPptxMeta(pptxFilePath);
    }
    throw new Error('getPptxMeta not available on this platform');
  }

  public async getPptxSlide(pptxFilePath: string, slideIndex: number): Promise<{
    index: number;
    width: number;
    height: number;
    aspectRatio: number;
    background: {
      type: 'solid' | 'gradient' | 'image';
      color?: string;
      stops?: { pos: number; color: string }[];
      angle?: number;
      imageUri?: string;
    };
    elements: {
      type: 'text' | 'shape' | 'image' | 'table' | 'unsupported';
      x: number;
      y: number;
      w: number;
      h: number;
      rotation?: number;
      flipH?: boolean;
      flipV?: boolean;
      geometry?: string;
      anchor?: 'top' | 'middle' | 'bottom';
      fill?: {
        type: 'solid' | 'gradient' | 'none';
        color?: string;
        stops?: { pos: number; color: string }[];
        angle?: number;
      };
      line?: {
        width?: number;
        color?: string;
      };
      autofit?: {
        fontScale?: number;
        lnSpcReduction?: number;
      };
      paragraphs?: {
        align?: 'left' | 'center' | 'right' | 'justify';
        bullet?: string | null;
        level?: number;
        runs: {
          text: string;
          sizePt?: number;
          bold?: boolean;
          italic?: boolean;
          underline?: boolean;
          color?: string;
          font?: string;
        }[];
      }[];
      imageUri?: string;
      crop?: { left: number; top: number; right: number; bottom: number };
      table?: { rows: { text: string; fill: string }[][] };
      kind?: string;
    }[];
  }> {
    if (ArchiveModule && ArchiveModule.getPptxSlide) {
      return await ArchiveModule.getPptxSlide(pptxFilePath, slideIndex);
    }
    throw new Error('getPptxSlide not available on this platform');
  }

  public async parsePptxSlides(pptxFilePath: string): Promise<{
    status: string;
    totalSlides: number;
    slides: {
      slideNumber: number;
      title: string;
      bullets: string[];
      imageUris: string[];
    }[];
  }> {
    if (ArchiveModule && ArchiveModule.parsePptxSlides) {
      return await ArchiveModule.parsePptxSlides(pptxFilePath);
    }
    throw new Error('parsePptxSlides not available on this platform');
  }

  public async deleteCachedFile(filePath: string): Promise<boolean> {
    return await ArchiveModule.deleteCachedFile(filePath);
  }

  public async cleanTemporaryCache(): Promise<{ freedBytes: number }> {
    if (Platform.OS !== 'android' || !ArchiveModule?.cleanTemporaryCache) {
      return { freedBytes: 0 };
    }
    return await ArchiveModule.cleanTemporaryCache();
  }

  public async extract(
    archivePath: string,
    destinationDir: string,
    password?: string,
    limits: Partial<ArchiveLimits> = {},
    onProgress?: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult> {
    if (Platform.OS !== 'android') {
      throw new Error(`Archive extraction NOT RUN on ${Platform.OS}: only Android supported in current environment.`);
    }

    const effectiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...limits };
    let sub: any = null;

    if (onProgress && archiveEmitter) {
      sub = archiveEmitter.addListener('onExtractionProgress', (event: ExtractionProgress) => {
        onProgress(event);
      });
    }

    try {
      const res: ExtractionResult = await ArchiveModule.extractArchive(
        archivePath,
        destinationDir,
        password || '',
        effectiveLimits.maxExpansionRatio,
        effectiveLimits.maxTotalSize
      );
      return res;
    } finally {
      if (sub) {
        sub.remove();
      }
    }
  }

  public async cancel(): Promise<void> {
    if (ArchiveModule) {
      await ArchiveModule.cancelExtraction();
    }
  }

  public async startPssSampling(): Promise<number> {
    if (Platform.OS === 'android' && ArchiveModule?.startPssSampling) {
      return await ArchiveModule.startPssSampling();
    }
    return 0;
  }

  public async stopPssSampling(): Promise<{
    baseline_pss_mb: number;
    peak_pss_mb: number;
    device_model: string;
    hardware: string;
    abi: string;
    is_emulator: boolean;
    os_version: string;
    app_build: string;
  }> {
    if (Platform.OS === 'android' && ArchiveModule?.stopPssSampling) {
      return await ArchiveModule.stopPssSampling();
    }
    return {
      baseline_pss_mb: 0,
      peak_pss_mb: 0,
      device_model: 'EMULATOR',
      hardware: 'goldfish',
      abi: 'x86_64',
      is_emulator: true,
      os_version: 'Android 13',
      app_build: '1.0.0-debug',
    };
  }

  public async saveRunState(stateJson: string): Promise<string> {
    if (Platform.OS === 'android' && ArchiveModule?.saveRunState) {
      return await ArchiveModule.saveRunState(stateJson);
    }
    return '';
  }

  public async loadRunState(): Promise<string | null> {
    if (Platform.OS === 'android' && ArchiveModule?.loadRunState) {
      return await ArchiveModule.loadRunState();
    }
    return null;
  }

  public async clearRunState(): Promise<boolean> {
    if (Platform.OS === 'android' && ArchiveModule?.clearRunState) {
      return await ArchiveModule.clearRunState();
    }
    return true;
  }

  public async runCurrentZipBaseline(): Promise<any[]> {
    if (Platform.OS === 'android' && ArchiveModule?.runCurrentZipBaseline) {
      return await ArchiveModule.runCurrentZipBaseline();
    }
    return [];
  }

  public async checkRarMissingVolume(filePath: string): Promise<{ isMissing: boolean; missingVolume: string }> {
    if (Platform.OS === 'android' && ArchiveModule?.checkRarMissingVolume) {
      return await ArchiveModule.checkRarMissingVolume(filePath);
    }
    return { isMissing: false, missingVolume: '' };
  }

  public async playVideo(
    filePath: string,
    autoSeek: boolean = false
  ): Promise<{
    ttffMs: number;
    seekLatencyMs: number;
    durationMs: number;
    status: string;
    error: string;
  }> {
    if (Platform.OS !== 'android' || !ArchiveModule) {
      throw new Error('Native VideoView player only supported on Android.');
    }
    return await ArchiveModule.playVideo(filePath, autoSeek);
  }

  public async probeMediaCodec(filePath: string): Promise<{
    hasVideo: boolean;
    hasAudio: boolean;
    isVideoSupported: boolean;
    isAudioSupported: boolean;
    isSupported: boolean;
    videoCodec: string;
    audioCodec: string;
    durationMs: number;
    error?: string;
  }> {
    if (Platform.OS === 'android' && ArchiveModule?.probeMediaCodec) {
      return await ArchiveModule.probeMediaCodec(filePath);
    }
    return {
      hasVideo: false,
      hasAudio: false,
      isVideoSupported: true,
      isAudioSupported: true,
      isSupported: true,
      videoCodec: '',
      audioCodec: '',
      durationMs: 0,
    };
  }

  // Native Audio Playback Engine (MP3, WAV, AAC, M4A, FLAC, OGG)
  public async startAudio(filePath: string): Promise<{ durationMs: number; currentPositionMs: number; isPlaying: boolean }> {
    if (Platform.OS === 'android' && ArchiveModule?.startAudio) {
      return await ArchiveModule.startAudio(filePath);
    }
    return { durationMs: 0, currentPositionMs: 0, isPlaying: false };
  }

  public async pauseAudio(): Promise<boolean> {
    if (Platform.OS === 'android' && ArchiveModule?.pauseAudio) {
      return await ArchiveModule.pauseAudio();
    }
    return false;
  }

  public async resumeAudio(): Promise<boolean> {
    if (Platform.OS === 'android' && ArchiveModule?.resumeAudio) {
      return await ArchiveModule.resumeAudio();
    }
    return false;
  }

  public async seekAudio(positionMs: number): Promise<number> {
    if (Platform.OS === 'android' && ArchiveModule?.seekAudio) {
      return await ArchiveModule.seekAudio(positionMs);
    }
    return 0;
  }

  public async stopAudio(): Promise<boolean> {
    if (Platform.OS === 'android' && ArchiveModule?.stopAudio) {
      return await ArchiveModule.stopAudio();
    }
    return false;
  }

  public async setAudioSpeed(speed: number): Promise<boolean> {
    if (Platform.OS === 'android' && ArchiveModule?.setAudioSpeed) {
      return await ArchiveModule.setAudioSpeed(speed);
    }
    return false;
  }

  public async setImmersiveMode(enabled: boolean): Promise<boolean> {
    if (Platform.OS === 'android' && ArchiveModule?.setImmersiveMode) {
      return await ArchiveModule.setImmersiveMode(enabled);
    }
    return false;
  }

  public async getAudioStatus(): Promise<{ durationMs: number; currentPositionMs: number; isPlaying: boolean }> {
    if (Platform.OS === 'android' && ArchiveModule?.getAudioStatus) {
      return await ArchiveModule.getAudioStatus();
    }
    return { durationMs: 0, currentPositionMs: 0, isPlaying: false };
  }

  public async shareFiles(filePaths: string[], mimeType?: string): Promise<boolean> {
    if (Platform.OS === 'android') {
      if (!filePaths || filePaths.length === 0) return false;
      if (filePaths.length === 1 && ArchiveModule?.shareFile) {
        return await ArchiveModule.shareFile(filePaths[0], mimeType || '*/*');
      }
      if (ArchiveModule?.shareMultipleFiles) {
        return await ArchiveModule.shareMultipleFiles(filePaths, mimeType || '*/*');
      }
      if (ArchiveModule?.shareFile) {
        return await ArchiveModule.shareFile(filePaths[0], mimeType || '*/*');
      }
    }
    return false;
  }

  public async shareFile(filePath: string, mimeType?: string): Promise<boolean> {
    return this.shareFiles([filePath], mimeType);
  }

  public async getInitialSharedFile(): Promise<{ uri: string; action: string; mimeType?: string } | null> {
    if (Platform.OS === 'android' && ArchiveModule?.getInitialSharedFile) {
      return await ArchiveModule.getInitialSharedFile();
    }
    return null;
  }

  public async resolveContentUri(uriString: string): Promise<{ path: string; name: string; size: number }> {
    if (Platform.OS === 'android' && ArchiveModule?.resolveContentUri) {
      return await ArchiveModule.resolveContentUri(uriString);
    }
    const clean = uriString.startsWith('file://') ? uriString.substring(7) : uriString;
    const name = clean.split('/').pop() || 'doc';
    return { path: clean, name, size: 0 };
  }
}


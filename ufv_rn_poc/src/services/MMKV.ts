import { NativeModules, Platform } from 'react-native';

const { ArchiveModule } = NativeModules;

export interface LastPosition {
  page?: number;        // For PDF (1-based)
  slide?: number;       // For PPTX (1-based)
  timeMs?: number;      // For Audio/Video
  row?: number;         // For CSV/XLSX
  total?: number;       // Total pages/slides/duration
  timestamp: number;
}

export interface RecentFile {
  name: string;
  path: string;
  size: number;
  timestamp: number;
  category: string;
  mimeType?: string;
  lastPosition?: LastPosition;
}

const STORAGE_FILE_KEY = 'ufv_mmkv_recents';
const STORAGE_STARRED_KEY = 'ufv_mmkv_starred';

/**
 * MMKV-compatible fast key-value storage engine.
 * Employs synchronous memory lookup + persistent native background flush.
 */
class MMKVStorage {
  private memoryCache: Map<string, string> = new Map();
  private isLoaded: boolean = false;
  private saveTimeout: any = null;

  constructor() {
    this.init();
  }

  private async init() {
    if (this.isLoaded) return;
    try {
      if (Platform.OS === 'android' && ArchiveModule?.loadRunState) {
        const raw = await ArchiveModule.loadRunState();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed)) {
              this.memoryCache.set(k, String(v));
            }
          }
        }
      }
    } catch {
      // Memory cache is available immediately even if file reading takes a tick
    } finally {
      this.isLoaded = true;
    }
  }

  private scheduleFlush() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(async () => {
      try {
        if (Platform.OS === 'android' && ArchiveModule?.saveRunState) {
          const obj: Record<string, string> = {};
          this.memoryCache.forEach((v, k) => {
            obj[k] = v;
          });
          await ArchiveModule.saveRunState(JSON.stringify(obj));
        }
      } catch {
        // Best effort background flush
      }
    }, 200);
  }

  public set(key: string, value: string | number | boolean): void {
    this.memoryCache.set(key, String(value));
    this.scheduleFlush();
  }

  public getString(key: string): string | undefined {
    return this.memoryCache.get(key);
  }

  public getNumber(key: string): number | undefined {
    const val = this.memoryCache.get(key);
    if (val === undefined) return undefined;
    const num = Number(val);
    return isNaN(num) ? undefined : num;
  }

  public getBoolean(key: string): boolean | undefined {
    const val = this.memoryCache.get(key);
    if (val === undefined) return undefined;
    return val === 'true';
  }

  public delete(key: string): void {
    this.memoryCache.delete(key);
    this.scheduleFlush();
  }

  public clearAll(): void {
    this.memoryCache.clear();
    this.scheduleFlush();
  }

  public getAllKeys(): string[] {
    return Array.from(this.memoryCache.keys());
  }

  // --- Specialized Recent Files Helpers ---

  public getRecentFiles(): RecentFile[] {
    const raw = this.getString(STORAGE_FILE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public addRecentFile(file: RecentFile): void {
    const recents = this.getRecentFiles().filter((r) => r.path !== file.path);
    // Keep most recent first, max 30 items
    const updated = [file, ...recents].slice(0, 30);
    this.set(STORAGE_FILE_KEY, JSON.stringify(updated));
  }

  public clearRecentFiles(): void {
    this.delete(STORAGE_FILE_KEY);
  }

  // --- Specialized Starred / Favorites Helpers ---

  public getStarredFiles(): RecentFile[] {
    const raw = this.getString(STORAGE_STARRED_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  public isStarred(path: string): boolean {
    const starred = this.getStarredFiles();
    return starred.some((s) => s.path === path);
  }

  public toggleStarred(file: RecentFile): boolean {
    const starred = this.getStarredFiles();
    const existingIndex = starred.findIndex((s) => s.path === file.path);
    if (existingIndex >= 0) {
      starred.splice(existingIndex, 1);
      this.set(STORAGE_STARRED_KEY, JSON.stringify(starred));
      return false;
    } else {
      starred.unshift(file);
      this.set(STORAGE_STARRED_KEY, JSON.stringify(starred));
      return true;
    }
  }

  public removeStarred(path: string): void {
    const starred = this.getStarredFiles().filter((s) => s.path !== path);
    this.set(STORAGE_STARRED_KEY, JSON.stringify(starred));
  }

  // --- Continue Reading / Last Position Tracking ---

  public savePosition(filePath: string, pos: Omit<LastPosition, 'timestamp'>): void {
    const key = `pos_${filePath}`;
    const payload: LastPosition = {
      ...pos,
      timestamp: Date.now(),
    };
    this.set(key, JSON.stringify(payload));
  }

  public getPosition(filePath: string): LastPosition | null {
    const raw = this.getString(`pos_${filePath}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  public getContinueReadingFiles(): Array<RecentFile & { pos: LastPosition }> {
    const recents = this.getRecentFiles();
    const result: Array<RecentFile & { pos: LastPosition }> = [];
    for (const r of recents) {
      const pos = this.getPosition(r.path);
      if (pos && ((pos.page && pos.page > 1) || (pos.slide && pos.slide > 1) || (pos.timeMs && pos.timeMs > 3000))) {
        result.push({ ...r, pos });
      }
    }
    return result;
  }
}

export const MMKV = new MMKVStorage();
export default MMKV;


import { NativeModules, Platform } from 'react-native';
import { MMKV } from './MMKV';

const { StorageModule } = NativeModules;

export interface StorageCategoryCount {
  count: number;
  totalBytes: number;
}

export interface DashboardCounts {
  pdf: StorageCategoryCount;
  word: StorageCategoryCount;
  excel: StorageCategoryCount;
  pptx: StorageCategoryCount;
  archive: StorageCategoryCount;
  audio: StorageCategoryCount;
  video: StorageCategoryCount;
  image: StorageCategoryCount;
}

export interface CategoryFileInfo {
  uri: string;
  name: string;
  size: number;
  modified: number;
  mime: string;
  ext: string;
  category: string;
}

export interface StorageUsage {
  usedBytes: number;
  totalBytes: number;
  freeBytes: number;
}

export interface PermissionState {
  media: 'granted' | 'denied' | 'partial';
  documentsTreeGranted: boolean;
  treeUri: string | null;
  allFiles: boolean;
}

export interface ResolvedLocalFile {
  localPath: string;
  name: string;
  size: number;
  mimeType: string;
}

const DASHBOARD_COUNTS_CACHE_KEY = 'storage_dashboard_counts_v1';

export class StorageService {
  private static instance: StorageService;

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  async getPermissionState(): Promise<PermissionState> {
    if (Platform.OS !== 'android' || !StorageModule) {
      return {
        media: 'granted',
        documentsTreeGranted: false,
        treeUri: null,
        allFiles: false,
      };
    }
    try {
      return await StorageModule.getPermissionState();
    } catch (err) {
      console.warn('StorageService.getPermissionState failed', err);
      return {
        media: 'denied',
        documentsTreeGranted: false,
        treeUri: null,
        allFiles: false,
      };
    }
  }

  async requestDocumentsTree(): Promise<{ granted: boolean; uri: string | null }> {
    if (Platform.OS !== 'android' || !StorageModule) {
      return { granted: false, uri: null };
    }
    try {
      return await StorageModule.requestDocumentsTree();
    } catch (err) {
      console.warn('StorageService.requestDocumentsTree failed', err);
      return { granted: false, uri: null };
    }
  }

  getCachedDashboardCounts(): DashboardCounts | null {
    try {
      const raw = MMKV.getString(DASHBOARD_COUNTS_CACHE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (err) {
      console.warn('Failed to parse cached dashboard counts', err);
    }
    return null;
  }

  async getStorageDashboardCounts(forceRefresh = false): Promise<DashboardCounts> {
    if (Platform.OS !== 'android' || !StorageModule) {
      return this.getEmptyCounts();
    }

    if (!forceRefresh) {
      const cached = this.getCachedDashboardCounts();
      if (cached) {
        // Return cached immediately and refresh in background
        StorageModule.getStorageDashboardCounts()
          .then((liveCounts: DashboardCounts) => {
            MMKV.set(DASHBOARD_COUNTS_CACHE_KEY, JSON.stringify(liveCounts));
          })
          .catch((err: any) => console.warn('Background counts refresh error', err));
        return cached;
      }
    }

    try {
      const liveCounts: DashboardCounts = await StorageModule.getStorageDashboardCounts();
      // Cache in MMKV
      MMKV.set(DASHBOARD_COUNTS_CACHE_KEY, JSON.stringify(liveCounts));
      return liveCounts;
    } catch (err) {
      console.warn('StorageService.getStorageDashboardCounts error', err);
      const cached = this.getCachedDashboardCounts();
      return cached || this.getEmptyCounts();
    }
  }

  async queryCategoryFiles(
    category: string,
    offset = 0,
    limit = 50
  ): Promise<CategoryFileInfo[]> {
    if (Platform.OS !== 'android' || !StorageModule) {
      return [];
    }
    try {
      return await StorageModule.queryCategoryFiles(category, offset, limit);
    } catch (err) {
      console.warn('StorageService.queryCategoryFiles error', err);
      return [];
    }
  }

  async getStorageUsage(): Promise<StorageUsage> {
    if (Platform.OS !== 'android' || !StorageModule) {
      return { usedBytes: 0, totalBytes: 0, freeBytes: 0 };
    }
    try {
      return await StorageModule.getStorageUsage();
    } catch (err) {
      console.warn('StorageService.getStorageUsage error', err);
      return { usedBytes: 0, totalBytes: 0, freeBytes: 0 };
    }
  }

  async resolveToLocalFile(uri: string): Promise<ResolvedLocalFile> {
    if (Platform.OS !== 'android' || !StorageModule) {
      return {
        localPath: uri,
        name: uri.split('/').pop() || 'file',
        size: 0,
        mimeType: 'application/octet-stream',
      };
    }
    return await StorageModule.resolveToLocalFile(uri);
  }

  private getEmptyCounts(): DashboardCounts {
    const emptyCount = () => ({ count: 0, totalBytes: 0 });
    return {
      pdf: emptyCount(),
      word: emptyCount(),
      excel: emptyCount(),
      pptx: emptyCount(),
      archive: emptyCount(),
      audio: emptyCount(),
      video: emptyCount(),
      image: emptyCount(),
    };
  }
}

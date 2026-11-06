import { NativeModules, Platform } from 'react-native';

const { ArchiveModule } = NativeModules;

export interface ReadDirItem {
  name: string;
  path: string;
  size: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
  mtime?: Date;
}

export interface StatResult {
  name: string;
  path: string;
  size: number;
  mode: number;
  mtime: Date;
  isFile: () => boolean;
  isDirectory: () => boolean;
}

export class RNFSService {
  public static MainBundlePath = '';
  public static CachesDirectoryPath = '/data/user/0/com.ufv_rn_poc/cache';
  public static DocumentDirectoryPath = '/storage/emulated/0';
  public static DownloadDirectoryPath = '/storage/emulated/0/Download';
  public static ExternalStorageDirectoryPath = '/storage/emulated/0';
  public static TemporaryDirectoryPath = '/data/local/tmp';

  public static async readDir(dirPath: string): Promise<ReadDirItem[]> {
    if (Platform.OS !== 'android' || !ArchiveModule) return [];

    try {
      const files: any[] = await ArchiveModule.listFolder(dirPath);
      return files.map((f) => {
        const isDir = Boolean(f.isDirectory);
        return {
          name: f.name,
          path: f.path,
          size: isDir ? 0 : f.size || 0,
          isFile: () => !isDir,
          isDirectory: () => isDir,
          mtime: new Date(),
        };
      }).sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    } catch (err) {
      console.warn('RNFS.readDir error:', err);
      return [];
    }
  }

  public static async stat(filePath: string): Promise<StatResult> {
    const name = filePath.split('/').pop() || '';
    return {
      name,
      path: filePath,
      size: 0,
      mode: 0,
      mtime: new Date(),
      isFile: () => !filePath.endsWith('/'),
      isDirectory: () => filePath.endsWith('/'),
    };
  }

  public static async exists(filePath: string): Promise<boolean> {
    try {
      if (ArchiveModule?.readFileHeader) {
        await ArchiveModule.readFileHeader(filePath, 4);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public static async readFile(filePath: string, encoding: string = 'utf8'): Promise<string> {
    if (encoding === 'base64') {
      return await ArchiveModule.readFileBase64(filePath);
    }
    const res = await ArchiveModule.readTextChunk(filePath, 0, 512 * 1024, 'UTF-8');
    return res.text || '';
  }

  public static async unlink(filePath: string): Promise<boolean> {
    return await ArchiveModule.deleteCachedFile(filePath);
  }
}

export const RNFS = RNFSService;
export default RNFS;


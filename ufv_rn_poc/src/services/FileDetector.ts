import { NativeModules } from 'react-native';

const { ArchiveModule } = NativeModules;

export type DetectedCategory =
  | 'PDF'
  | 'OFFICE_DOCX'
  | 'OFFICE_XLSX'
  | 'OFFICE_PPTX'
  | 'OFFICE_PASSWORD_PROTECTED'
  | 'LEGACY_OLE_DOC'
  | 'LEGACY_OLE_XLS'
  | 'LEGACY_OLE_PPT'
  | 'SPREADSHEET_CSV'
  | 'ARCHIVE_ZIP'
  | 'ARCHIVE_RAR4'
  | 'ARCHIVE_RAR5'
  | 'IMAGE'
  | 'AUDIO'
  | 'VIDEO'
  | 'TEXT_CODE'
  | 'ZERO_BYTE'
  | 'ERROR_CORRUPT'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export interface DetectionResult {
  category: DetectedCategory;
  mimeType: string;
  magicHex: string;
  displayName: string;
  extension: string;
  sizeBytes: number;
  hasExtensionMismatch: boolean;
  notes: string;
}

export class FileDetector {
  /**
   * Strictly inspects file content by raw magic bytes and inner container trees.
   * Never blindly trusts file extensions.
   */
  public static async detectFile(filePath: string, fileName?: string): Promise<DetectionResult> {
    const cleanFileName = fileName || filePath.split('/').pop() || 'unknown_file';
    const declaredExt = (cleanFileName.split('.').pop() || '').toLowerCase();

    // 1. Read header bytes (first 64 bytes)
    let headerData: { hexString: string; hexBytes: string[]; size: number } = {
      hexString: '',
      hexBytes: [],
      size: 0,
    };

    try {
      headerData = await ArchiveModule.readFileHeader(filePath, 64);
    } catch (e: any) {
      return {
        category: 'UNKNOWN',
        mimeType: 'application/octet-stream',
        magicHex: '',
        displayName: 'Unreadable File',
        extension: declaredExt,
        sizeBytes: 0,
        hasExtensionMismatch: false,
        notes: `Failed to read file header: ${e.message}`,
      };
    }

    const { size, hexBytes } = headerData;
    const hex = hexBytes.join('').toUpperCase();

    // 2. Handle 0-byte files
    if (size === 0) {
      return {
        category: 'ZERO_BYTE',
        mimeType: 'application/x-empty',
        magicHex: '',
        displayName: 'Empty File (0 Bytes)',
        extension: declaredExt,
        sizeBytes: 0,
        hasExtensionMismatch: false,
        notes: 'File contains 0 bytes. Nothing to render.',
      };
    }

    // 2.5 Git Index File: DIRC (0x44 0x49 0x52 0x43)
    if (hex.startsWith('44495243') || cleanFileName.toLowerCase() === 'index') {
      return {
        category: 'UNSUPPORTED',
        mimeType: 'application/x-git-index',
        magicHex: '44 49 52 43 (DIRC)',
        displayName: 'Git Index / Binary File',
        extension: declaredExt || 'bin',
        sizeBytes: size,
        hasExtensionMismatch: false,
        notes: 'Git repository internal binary index. Cannot be rendered as text.',
      };
    }

    // 3. PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
    if (hex.startsWith('255044462D')) {
      return {
        category: 'PDF',
        mimeType: 'application/pdf',
        magicHex: '25 50 44 46 2D (%PDF-)',
        displayName: 'PDF Document',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'pdf',
        notes: declaredExt !== 'pdf' ? `Extension mismatch: renamed as .${declaredExt} but is a valid PDF` : 'Valid PDF signature',
      };
    }

    // 4. RAR4: 52 61 72 21 1A 07 00
    if (hex.startsWith('526172211A0700')) {
      return {
        category: 'ARCHIVE_RAR4',
        mimeType: 'application/vnd.rar',
        magicHex: '52 61 72 21 1A 07 00',
        displayName: 'RAR4 Archive',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'rar',
        notes: 'Legacy RAR 4.x container format',
      };
    }

    // 5. RAR5: 52 61 72 21 1A 07 01 00
    if (hex.startsWith('526172211A070100')) {
      return {
        category: 'ARCHIVE_RAR5',
        mimeType: 'application/x-rar-compressed',
        magicHex: '52 61 72 21 1A 07 01 00',
        displayName: 'RAR5 Archive',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'rar',
        notes: 'Modern RAR 5.x container format',
      };
    }

    // 6. GZip (tar.gz): 1F 8B
    if (hex.startsWith('1F8B')) {
      return {
        category: 'UNSUPPORTED',
        mimeType: 'application/gzip',
        magicHex: '1F 8B (GZIP)',
        displayName: 'GZip Archive (tar.gz)',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: false,
        notes: 'tar.gz is outside Phase 1 scope. Native extraction not implemented.',
      };
    }

    // 7. 7-Zip: 37 7A BC AF 27 1C
    if (hex.startsWith('377ABCAF271C')) {
      return {
        category: 'UNSUPPORTED',
        mimeType: 'application/x-7z-compressed',
        magicHex: '37 7A BC AF 27 1C (7z)',
        displayName: '7-Zip Archive (7z)',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== '7z',
        notes: '7z is outside Phase 1 scope. Native extraction not implemented.',
      };
    }

    // 8. ZIP & Strict OOXML Detection (PK.. 0x50 0x4B 0x03 0x04)
    if (hex.startsWith('504B0304')) {
      try {
        const entries = await ArchiveModule.listArchive(filePath, '');
        const entryPaths = new Set(entries.map((e: any) => e.path || ''));

        // Non-negotiable Rule Phase 3 a: Strict OOXML check
        // ONLY when ZIP contains exact entry [Content_Types].xml
        // AND exact entry word/document.xml (docx), xl/workbook.xml (xlsx), or ppt/presentation.xml (pptx).
        // Never use substring matching!
        if (entryPaths.has('[Content_Types].xml')) {
          if (entryPaths.has('word/document.xml')) {
            return {
              category: 'OFFICE_DOCX',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              magicHex: '50 4B 03 04 + [Content_Types].xml + word/document.xml',
              displayName: 'Microsoft Word (DOCX)',
              extension: declaredExt,
              sizeBytes: size,
              hasExtensionMismatch: declaredExt !== 'docx',
              notes: 'Valid OOXML Word Document',
            };
          }

          if (entryPaths.has('xl/workbook.xml')) {
            return {
              category: 'OFFICE_XLSX',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              magicHex: '50 4B 03 04 + [Content_Types].xml + xl/workbook.xml',
              displayName: 'Microsoft Excel (XLSX)',
              extension: declaredExt,
              sizeBytes: size,
              hasExtensionMismatch: declaredExt !== 'xlsx',
              notes: 'Valid OOXML Excel Workbook',
            };
          }

          if (entryPaths.has('ppt/presentation.xml')) {
            return {
              category: 'OFFICE_PPTX',
              mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              magicHex: '50 4B 03 04 + [Content_Types].xml + ppt/presentation.xml',
              displayName: 'Microsoft PowerPoint (PPTX)',
              extension: declaredExt,
              sizeBytes: size,
              hasExtensionMismatch: declaredExt !== 'pptx',
              notes: 'Valid OOXML PowerPoint Presentation',
            };
          }
        }
      } catch (e) {
        // Continue to regular zip categorization if listing fails
      }

      return {
        category: 'ARCHIVE_ZIP',
        mimeType: 'application/zip',
        magicHex: '50 4B 03 04 (PK..)',
        displayName: 'ZIP Archive',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'zip',
        notes: declaredExt !== 'zip' ? `File renamed as .${declaredExt} is actually a ZIP container` : 'Standard PKZIP container',
      };
    }

    // 9. Legacy Microsoft OLE Compound Document (D0 CF 11 E0 A1 B1 1A E1)
    if (hex.startsWith('D0CF11E0A1B11AE1')) {
      // Non-negotiable Rule Phase 3 c: Check for EncryptedPackage stream in OLE directory
      if (ArchiveModule?.inspectOleCompound) {
        try {
          const oleRes = await ArchiveModule.inspectOleCompound(filePath);
          if (oleRes?.isEncryptedPackage) {
            return {
              category: 'OFFICE_PASSWORD_PROTECTED',
              mimeType: 'application/encrypted-office',
              magicHex: 'D0 CF 11 E0 + EncryptedPackage',
              displayName: 'Password-protected Office document',
              extension: declaredExt,
              sizeBytes: size,
              hasExtensionMismatch: false,
              notes: 'Password-protected Office document (encrypted package in OLE container)',
            };
          }
        } catch (oe) {
          // ignore
        }
      }

      let legacyType: DetectedCategory = 'LEGACY_OLE_DOC';
      let name = 'Legacy Word Document (DOC)';
      if (declaredExt === 'xls') {
        legacyType = 'LEGACY_OLE_XLS';
        name = 'Legacy Excel Workbook (XLS)';
      } else if (declaredExt === 'ppt') {
        legacyType = 'LEGACY_OLE_PPT';
        name = 'Legacy PowerPoint (PPT)';
      }
      return {
        category: legacyType,
        mimeType: 'application/x-ole-storage',
        magicHex: 'D0 CF 11 E0 A1 B1 1A E1 (OLE2)',
        displayName: name,
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: false,
        notes: 'Legacy Microsoft OLE Compound File (Requires LibreOffice engine)',
      };
    }

    // 10. Audio Signatures (Phase 3 b)

    // WAV: RIFF....WAVE (52 49 46 46 at 0, 57 41 56 45 at byte 8)
    if (hex.startsWith('52494646') && hex.length >= 24 && hex.substring(16, 24) === '57415645') {
      return {
        category: 'AUDIO',
        mimeType: 'audio/wav',
        magicHex: '52 49 46 46 ... 57 41 56 45 (RIFF...WAVE)',
        displayName: 'WAV Audio',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'wav',
        notes: 'Waveform Audio File Format',
      };
    }

    // OGG & Opus: OggS (4F 67 67 53)
    if (hex.startsWith('4F676753')) {
      const isOpus = hex.includes('4F70757348656164'); // OpusHead in packet
      return {
        category: 'AUDIO',
        mimeType: isOpus ? 'audio/opus' : 'audio/ogg',
        magicHex: isOpus ? '4F 67 67 53 (OggS) + OpusHead' : '4F 67 67 53 (OggS)',
        displayName: isOpus ? 'Opus Audio' : 'Ogg Vorbis Audio',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: !['ogg', 'opus'].includes(declaredExt),
        notes: isOpus ? 'Opus interactive audio codec' : 'Ogg bitstream container',
      };
    }

    // AAC ADTS: byte 0 = 0xFF, (byte 1 & 0xF6) == 0xF0
    if (hex.length >= 4 && hex.startsWith('FF')) {
      const b1 = parseInt(hex.substring(2, 4), 16);
      if ((b1 & 0xF6) === 0xF0) {
        return {
          category: 'AUDIO',
          mimeType: 'audio/aac',
          magicHex: `FF ${hex.substring(2, 4)} (AAC ADTS Sync)`,
          displayName: 'AAC Audio',
          extension: declaredExt,
          sizeBytes: size,
          hasExtensionMismatch: declaredExt !== 'aac',
          notes: 'Advanced Audio Coding ADTS stream',
        };
      }
    }

    // AC3: 0x0B 0x77 (0B 77)
    if (hex.startsWith('0B77')) {
      return {
        category: 'AUDIO',
        mimeType: 'audio/ac3',
        magicHex: '0B 77 (AC3 Sync)',
        displayName: 'Dolby AC3 Audio',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'ac3',
        notes: 'Dolby Digital AC3 audio stream',
      };
    }

    // FLAC: 66 4C 61 43 (fLaC)
    if (hex.startsWith('664C6143')) {
      return {
        category: 'AUDIO',
        mimeType: 'audio/flac',
        magicHex: '66 4C 61 43 (fLaC)',
        displayName: 'FLAC Audio',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'flac',
        notes: 'Free Lossless Audio Codec',
      };
    }

    // MP3: ID3 (49 44 33) or sync 0xFF 0xFB/F3/F2
    if (hex.startsWith('494433') || hex.startsWith('FFFB') || hex.startsWith('FFF3') || hex.startsWith('FFF2')) {
      return {
        category: 'AUDIO',
        mimeType: 'audio/mpeg',
        magicHex: hex.substring(0, 6) + ' (ID3/Sync)',
        displayName: 'MP3 Audio',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'mp3',
        notes: 'MPEG Audio Layer III',
      };
    }

    // 11. Video Signatures (Phase 3 b)

    // Matroska MKV / WebM: 1A 45 DF A3
    if (hex.startsWith('1A45DFA3')) {
      return {
        category: 'VIDEO',
        mimeType: 'video/x-matroska',
        magicHex: '1A 45 DF A3 (EBML)',
        displayName: 'Matroska Video (MKV)',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: !['mkv', 'webm'].includes(declaredExt),
        notes: 'EBML Matroska multimedia container',
      };
    }

    // RIFF AVI: 52 49 46 46 .... 41 56 49 20 (AVI ) at byte 8
    if (hex.startsWith('52494646') && hex.length >= 24 && hex.substring(16, 24) === '41564920') {
      return {
        category: 'VIDEO',
        mimeType: 'video/x-msvideo',
        magicHex: '52 49 46 46 ... 41 56 49 20 (RIFF...AVI )',
        displayName: 'Audio Video Interleave (AVI)',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'avi',
        notes: 'Legacy AVI container',
      };
    }

    // MP4 / M4A / HEIC / HEIF / AVIF: ....ftyp (hex bytes 4-7: 66 74 79 70)
    if (hex.length >= 16 && hex.substring(8, 16) === '66747970') {
      const brand = hex.length >= 24 ? hex.substring(16, 24).toLowerCase() : '';

      // Check HEIC / HEIF / AVIF image brands
      // '68656963' = heic, '68656978' = heix, '68657663' = hevc, '68657678' = hevx
      // '6d696631' = mif1, '6d736631' = msf1, '6865696d' = heim, '68656973' = heis
      // '61766966' = avif, '61766973' = avis
      const isHeif = [
        '68656963',
        '68656978',
        '68657663',
        '68657678',
        '6d696631',
        '6d736631',
        '6865696d',
        '68656973',
        '61766966',
        '61766973',
      ].includes(brand);

      const isHeifName =
        ['heic', 'heif', 'avif'].includes(declaredExt) ||
        cleanFileName.toLowerCase().includes('.heic') ||
        cleanFileName.toLowerCase().includes('.heif');

      if (isHeif || isHeifName) {
        return {
          category: 'IMAGE',
          mimeType: 'image/heif',
          magicHex: '.... 66 74 79 70 ' + brand.toUpperCase(),
          displayName: 'High Efficiency Image (HEIF/HEIC)',
          extension: declaredExt || 'heif',
          sizeBytes: size,
          hasExtensionMismatch: false,
          notes: 'ISO Base Media File Format Still Image',
        };
      }

      const isM4A = brand === '4d344120'; // Brand "M4A "
      if (isM4A || declaredExt === 'm4a') {
        return {
          category: 'AUDIO',
          mimeType: 'audio/mp4',
          magicHex: '.... 66 74 79 70 4D 34 41 20 (ftyp M4A )',
          displayName: 'M4A Audio',
          extension: declaredExt,
          sizeBytes: size,
          hasExtensionMismatch: declaredExt !== 'm4a',
          notes: 'MPEG-4 Audio container',
        };
      }
      return {
        category: 'VIDEO',
        mimeType: 'video/mp4',
        magicHex: '.... 66 74 79 70 (ftyp)',
        displayName: 'MPEG-4 Video (MP4)',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: !['mp4', 'm4v', 'mov'].includes(declaredExt),
        notes: 'ISO Base Media File Format',
      };
    }

    // 12. Images
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (hex.startsWith('89504E470D0A1A0A')) {
      return {
        category: 'IMAGE',
        mimeType: 'image/png',
        magicHex: '89 50 4E 47',
        displayName: 'PNG Image',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'png',
        notes: 'Lossless raster image',
      };
    }

    // JPEG: FF D8 FF
    if (hex.startsWith('FFD8FF')) {
      return {
        category: 'IMAGE',
        mimeType: 'image/jpeg',
        magicHex: 'FF D8 FF',
        displayName: 'JPEG Image',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: !['jpg', 'jpeg'].includes(declaredExt),
        notes: 'JFIF/EXIF raster image',
      };
    }

    // GIF: 47 49 46 38 (GIF87a or GIF89a)
    if (hex.startsWith('47494638')) {
      return {
        category: 'IMAGE',
        mimeType: 'image/gif',
        magicHex: '47 49 46 38 (GIF8)',
        displayName: 'GIF Image / Animation',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'gif',
        notes: 'Animated/Indexed palette image',
      };
    }

    // WebP: 52 49 46 46 .... 57 45 42 50
    if (hex.startsWith('52494646') && hex.includes('57454250')) {
      return {
        category: 'IMAGE',
        mimeType: 'image/webp',
        magicHex: '52 49 46 46 (RIFF...WEBP)',
        displayName: 'WebP Image',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'webp',
        notes: 'Google WebP image format',
      };
    }

    // BMP: 42 4D
    if (hex.startsWith('424D')) {
      return {
        category: 'IMAGE',
        mimeType: 'image/bmp',
        magicHex: '42 4D (BM)',
        displayName: 'Bitmap Image (BMP)',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: declaredExt !== 'bmp',
        notes: 'Windows bitmap',
      };
    }

    // 13. Phase 3 d: Corrupt Extension Check
    // If extension says .pdf / .rar / .zip but magic is invalid, report ERROR_CORRUPT
    if (['pdf', 'zip', 'rar'].includes(declaredExt)) {
      return {
        category: 'ERROR_CORRUPT',
        mimeType: 'application/octet-stream',
        magicHex: hex.substring(0, 16),
        displayName: `Corrupted / Damaged ${declaredExt.toUpperCase()} File`,
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: false,
        notes: `File declared as .${declaredExt} has corrupt or invalid header magic`,
      };
    }

    // 14. Spreadsheets CSV / TSV or Plain Text / Log
    if (declaredExt === 'csv') {
      return {
        category: 'SPREADSHEET_CSV',
        mimeType: 'text/csv',
        magicHex: hex.substring(0, 16),
        displayName: 'Comma-Separated Spreadsheet (CSV)',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: false,
        notes: 'Delimited tabular text data',
      };
    }

    // Check if first 64 bytes contain null or binary control chars
    let hasBinaryBytes = false;
    for (let i = 0; i < Math.min(hexBytes.length, 64); i++) {
      const code = parseInt(hexBytes[i], 16);
      if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
        hasBinaryBytes = true;
        break;
      }
    }

    if (hasBinaryBytes && !['txt', 'log', 'json', 'xml', 'md', 'html', 'csv', 'tsv', 'rtf'].includes(declaredExt)) {
      return {
        category: 'UNSUPPORTED',
        mimeType: 'application/octet-stream',
        magicHex: hex.substring(0, 16),
        displayName: 'Binary Data File',
        extension: declaredExt || 'bin',
        sizeBytes: size,
        hasExtensionMismatch: false,
        notes: 'File contains raw binary bytes or null characters. Cannot be viewed as text.',
      };
    }

    // Check if ASCII / UTF-8 printable text
    const isPrintable = hexBytes.slice(0, 32).every((h) => {
      const code = parseInt(h, 16);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    });

    if (isPrintable || ['txt', 'log', 'json', 'xml', 'md', 'rtf', 'html'].includes(declaredExt)) {
      return {
        category: 'TEXT_CODE',
        mimeType: 'text/plain',
        magicHex: hex.substring(0, 16) + ' (Printable ASCII/UTF-8)',
        displayName: 'Text / Log / Code Document',
        extension: declaredExt,
        sizeBytes: size,
        hasExtensionMismatch: false,
        notes: 'Plaintext stream (scripts disabled)',
      };
    }

    return {
      category: 'UNKNOWN',
      mimeType: 'application/octet-stream',
      magicHex: hex.substring(0, 16),
      displayName: 'Unknown Binary Format',
      extension: declaredExt,
      sizeBytes: size,
      hasExtensionMismatch: false,
      notes: `Unrecognized magic header: ${hex.substring(0, 16)}`,
    };
  }
}

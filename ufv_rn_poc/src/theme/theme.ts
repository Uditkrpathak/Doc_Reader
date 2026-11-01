export const theme = {
  colors: {
    // Primary Brand Colors
    primary: '#1a73e8',
    primaryDark: '#1557b0',
    primaryLight: '#e8f0fe',
    accent: '#0d9488',

    // Neutral Surfaces & Backgrounds
    background: '#f8fafc',
    surface: '#ffffff',
    surfaceElevated: '#ffffff',
    cardBorder: '#e2e8f0',
    divider: '#f1f5f9',

    // Text & Content
    textPrimary: '#0f172a',
    textSecondary: '#64748b',
    textMuted: '#94a3b8',
    textInverse: '#ffffff',

    // Semantic States
    success: '#10b981',
    successBg: '#ecfdf5',
    warning: '#f59e0b',
    warningBg: '#fffbeb',
    error: '#ef4444',
    errorBg: '#fef2f2',
    info: '#0284c7',
    infoBg: '#f0f9ff',

    // File Category Brand Colors
    pdf: '#dc2626',
    pdfBg: '#fef2f2',
    word: '#2563eb',
    wordBg: '#eff6ff',
    excel: '#107c41',
    excelBg: '#ecfdf5',
    csv: '#0284c7',
    csvBg: '#f0f9ff',
    powerpoint: '#ea580c',
    powerpointBg: '#fff7ed',
    image: '#8b5cf6',
    imageBg: '#f5f3ff',
    video: '#d946ef',
    videoBg: '#fdf4ff',
    audio: '#06b6d4',
    audioBg: '#ecfeff',
    archive: '#f97316',
    archiveBg: '#fff7ed',
    code: '#475569',
    codeBg: '#f1f5f9',
    folder: '#eab308',
    folderBg: '#fefce8',
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
  },

  borderRadius: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },

  typography: {
    titleLarge: {
      fontSize: 20,
      fontWeight: '800' as const,
      lineHeight: 26,
    },
    titleMedium: {
      fontSize: 16,
      fontWeight: '700' as const,
      lineHeight: 22,
    },
    titleSmall: {
      fontSize: 14,
      fontWeight: '700' as const,
      lineHeight: 18,
    },
    bodyLarge: {
      fontSize: 14,
      fontWeight: '500' as const,
      lineHeight: 20,
    },
    bodyMedium: {
      fontSize: 12,
      fontWeight: '400' as const,
      lineHeight: 16,
    },
    caption: {
      fontSize: 11,
      fontWeight: '600' as const,
      lineHeight: 14,
    },
  },

  shadows: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 2,
    },
    cardElevated: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
  },
};

export type Theme = typeof theme;

/**
 * Returns icon, color, and background tint for any file by extension or directory flag
 */
export function getFileCategoryInfo(fileName: string, isDirectory: boolean = false) {
  if (isDirectory) {
    return {
      icon: '📁',
      label: 'DIR',
      color: theme.colors.folder,
      bg: theme.colors.folderBg,
      category: 'FOLDER',
    };
  }

  const ext = (fileName.split('.').pop() || '').toLowerCase();

  switch (ext) {
    case 'pdf':
      return { icon: '📕', label: 'PDF', color: theme.colors.pdf, bg: theme.colors.pdfBg, category: 'PDF' };
    case 'docx':
    case 'doc':
    case 'rtf':
      return { icon: '📘', label: 'DOCX', color: theme.colors.word, bg: theme.colors.wordBg, category: 'OFFICE_DOCX' };
    case 'xlsx':
    case 'xls':
      return { icon: '📗', label: 'XLSX', color: theme.colors.excel, bg: theme.colors.excelBg, category: 'OFFICE_XLSX' };
    case 'csv':
    case 'tsv':
      return { icon: '📊', label: 'CSV', color: theme.colors.csv, bg: theme.colors.csvBg, category: 'SPREADSHEET_CSV' };
    case 'pptx':
    case 'ppt':
      return { icon: '📙', label: 'PPTX', color: theme.colors.powerpoint, bg: theme.colors.powerpointBg, category: 'OFFICE_PPTX' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
    case 'bmp':
    case 'heic':
    case 'heif':
    case 'avif':
      return { icon: '🖼️', label: ext.toUpperCase(), color: theme.colors.image, bg: theme.colors.imageBg, category: 'IMAGE' };
    case 'mp4':
    case 'mkv':
    case 'webm':
    case 'avi':
    case 'mov':
      return { icon: '🎬', label: ext.toUpperCase(), color: theme.colors.video, bg: theme.colors.videoBg, category: 'VIDEO' };
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
    case 'ogg':
    case 'm4a':
      return { icon: '🎵', label: ext.toUpperCase(), color: theme.colors.audio, bg: theme.colors.audioBg, category: 'AUDIO' };
    case 'zip':
    case '7z':
    case 'tar':
    case 'gz':
      return { icon: '📦', label: 'ZIP', color: theme.colors.archive, bg: theme.colors.archiveBg, category: 'ARCHIVE_ZIP' };
    case 'rar':
      return { icon: '🗜️', label: 'RAR', color: theme.colors.archive, bg: theme.colors.archiveBg, category: 'ARCHIVE_RAR' };
    case 'txt':
    case 'log':
    case 'json':
    case 'xml':
    case 'md':
    case 'ts':
    case 'js':
    case 'html':
      return { icon: '📝', label: ext.toUpperCase(), color: theme.colors.code, bg: theme.colors.codeBg, category: 'TEXT_CODE' };
    default:
      return { icon: '📄', label: ext.toUpperCase() || 'FILE', color: theme.colors.textSecondary, bg: theme.colors.divider, category: 'UNKNOWN' };
  }
}


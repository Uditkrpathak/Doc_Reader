import React from 'react';
import { View, StyleSheet, Text } from 'react-native';

interface IconProps {
  size?: number;
  color?: string;
  innerColor?: string;
}

/**
 * 1. Phone Icon (Outline Smartphone with home indicator)
 * Figma: [ 📱 No sign-in ]
 */
export const PhoneOutlineIcon: React.FC<IconProps> = ({ size = 14, color = '#016EEF' }) => {
  const w = size * 0.7;
  const h = size;
  return (
    <View
      style={[
        styles.center,
        {
          width: w,
          height: h,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          justifyContent: 'flex-end',
          paddingBottom: 1.5,
        },
      ]}>
      {/* Home dot / bar */}
      <View
        style={{
          width: 3,
          height: 1,
          borderRadius: 0.5,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

/**
 * 2. Lock Icon (Outline Padlock with shackle & body)
 * Figma: [ 🔒 On-device ]
 */
export const LockOutlineIcon: React.FC<IconProps> = ({ size = 14, color = '#016EEF' }) => {
  const w = size * 0.85;
  const h = size;
  const shackleW = w * 0.6;
  const shackleH = h * 0.45;
  const bodyH = h * 0.55;

  return (
    <View style={[styles.center, { width: w, height: h }]}>
      {/* Shackle */}
      <View
        style={{
          width: shackleW,
          height: shackleH,
          borderTopLeftRadius: shackleW / 2,
          borderTopRightRadius: shackleW / 2,
          borderWidth: 1.5,
          borderBottomWidth: 0,
          borderColor: color,
          marginBottom: -1,
        }}
      />
      {/* Body */}
      <View
        style={[
          styles.center,
          {
            width: w,
            height: bodyH,
            borderRadius: 2.5,
            borderWidth: 1.5,
            borderColor: color,
          },
        ]}>
        <View style={{ width: 1.5, height: 2.5, backgroundColor: color, borderRadius: 0.5 }} />
      </View>
    </View>
  );
};

/**
 * 3. No-Ads Icon (Circle with diagonal slash)
 * Figma: [ ⃠ No ads first ]
 */
export const NoAdsOutlineIcon: React.FC<IconProps> = ({ size = 14, color = '#016EEF' }) => {
  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
          position: 'relative',
        },
      ]}>
      {/* 45 degree diagonal slash */}
      <View
        style={{
          position: 'absolute',
          width: size - 3,
          height: 1.5,
          backgroundColor: color,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
};

/**
 * 4. External Link / Open in App Icon
 * Figma: [ ↗ Open a file from another app ]
 */
export const ExternalLinkIcon: React.FC<IconProps> = ({ size = 14, color = '#016EEF' }) => {
  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {/* Box */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: size * 0.75,
          height: size * 0.75,
          borderWidth: 1.5,
          borderColor: color,
          borderRadius: 2,
          borderTopWidth: 0,
          borderRightWidth: 0,
        }}
      />
      {/* Arrow / top-right corner */}
      <Text
        style={{
          position: 'absolute',
          top: -2,
          right: -1,
          fontSize: size * 0.85,
          color,
          fontWeight: '900',
          lineHeight: size,
        }}>
        ↗
      </Text>
    </View>
  );
};

/**
 * 5. Folder Outline Icon
 * Figma: Header `My Files` & Browse tab
 */
export const FolderOutlineIcon: React.FC<IconProps> = ({ size = 20, color = '#016EEF' }) => {
  const w = size;
  const h = size * 0.8;
  const tabW = w * 0.45;
  const tabH = h * 0.28;

  return (
    <View style={{ width: w, height: h, position: 'relative' }}>
      {/* Tab */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: tabW,
          height: tabH,
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
          borderWidth: 1.5,
          borderBottomWidth: 0,
          borderColor: color,
        }}
      />
      {/* Body */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: w,
          height: h - tabH + 1,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
        }}
      />
    </View>
  );
};

/**
 * 6. Home Icon (Clean Outline House with roof & doorway)
 * Figma: Bottom Nav Home Tab
 */
export const HomeOutlineIcon: React.FC<IconProps> = ({ size = 22, color = '#016EEF' }) => {
  return (
    <View style={[styles.center, { width: size, height: size, position: 'relative' }]}>
      {/* Roof peak triangle */}
      <View
        style={{
          width: size * 0.65,
          height: size * 0.65,
          borderTopWidth: 2,
          borderLeftWidth: 2,
          borderColor: color,
          borderTopLeftRadius: 3,
          transform: [{ rotate: '45deg' }],
          position: 'absolute',
          top: 1,
        }}
      />
      {/* House body */}
      <View
        style={[
          styles.center,
          {
            position: 'absolute',
            bottom: 1.5,
            width: size * 0.72,
            height: size * 0.5,
            borderWidth: 2,
            borderTopWidth: 0,
            borderColor: color,
            borderBottomLeftRadius: 2.5,
            borderBottomRightRadius: 2.5,
            justifyContent: 'flex-end',
          },
        ]}>
        {/* Doorway */}
        <View
          style={{
            width: 4,
            height: 5,
            borderTopLeftRadius: 2,
            borderTopRightRadius: 2,
            backgroundColor: color,
          }}
        />
      </View>
    </View>
  );
};

/**
 * 7. Browse Folder Icon (Solid/Dual tone Folder)
 * Figma: Bottom Nav Browse Tab
 */
export const BrowseFolderIcon: React.FC<IconProps> = ({ size = 22, color = '#64748B' }) => {
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      <FolderOutlineIcon size={size * 0.9} color={color} />
    </View>
  );
};

/**
 * 8. Media Photos Icon (Dual overlapping photo frames)
 * Figma: Bottom Nav Media Tab
 */
export const MediaPhotosIcon: React.FC<IconProps> = ({ size = 22, color = '#64748B' }) => {
  const frameSize = size * 0.72;
  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {/* Back Frame */}
      <View
        style={{
          position: 'absolute',
          top: 1,
          right: 1,
          width: frameSize,
          height: frameSize,
          borderRadius: 3,
          borderWidth: 1.5,
          borderColor: color,
          opacity: 0.6,
        }}
      />
      {/* Front Frame with Mountain & Sun */}
      <View
        style={{
          position: 'absolute',
          bottom: 1,
          left: 1,
          width: frameSize,
          height: frameSize,
          borderRadius: 3,
          borderWidth: 1.8,
          borderColor: color,
          backgroundColor: '#FFFFFF',
          overflow: 'hidden',
        }}>
        {/* Sun dot */}
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: 2.5,
            width: 3,
            height: 3,
            borderRadius: 1.5,
            backgroundColor: color,
          }}
        />
        {/* Mountain peak */}
        <View
          style={{
            position: 'absolute',
            bottom: -2,
            left: 1,
            width: 8,
            height: 8,
            borderTopWidth: 1.5,
            borderLeftWidth: 1.5,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
          }}
        />
      </View>
    </View>
  );
};

/**
 * 9. Favourites Star Icon (Clean 5-point outline star)
 * Figma: Bottom Nav Favourites Tab
 */
export const StarOutlineIcon: React.FC<IconProps> = ({ size = 22, color = '#64748B' }) => {
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      <Text style={{ fontSize: size * 0.95, color, lineHeight: size, fontWeight: '400' }}>
        ☆
      </Text>
    </View>
  );
};

/**
 * 10. Coin Wallet Pill Icon
 * Figma: Header (🪙 120)
 */
export const CoinIcon: React.FC<IconProps> = ({ size = 15, color = '#016EEF' }) => {
  return (
    <View
      style={[
        styles.center,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
          backgroundColor: '#EFF6FF',
        },
      ]}>
      <View
        style={{
          width: 3,
          height: 3,
          borderRadius: 1.5,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

/**
 * 11. Settings Gear Icon
 * Figma: Header ⚙️
 */
export const SettingsGearIcon: React.FC<IconProps> = ({ size = 18, color = '#0F172A' }) => {
  return (
    <View style={[styles.center, { width: size, height: size }]}>
      <Text style={{ fontSize: size, color, lineHeight: size }}>⚙</Text>
    </View>
  );
};

/**
 * 12. Document File Shape (Folded corner + colored format badge)
 * Figma: 40x48 Document file icon in Recents
 */
interface FileDocIconProps {
  label: string;
  badgeBg: string;
  badgeText: string;
  width?: number;
  height?: number;
}

export const DocumentFileBadgeIcon: React.FC<FileDocIconProps> = ({
  label,
  badgeBg,
  badgeText,
  width = 40,
  height = 48,
}) => {
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        position: 'relative',
        padding: 4,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 1,
      }}>
      {/* Folded Top-Right Corner */}
      <View
        style={{
          position: 'absolute',
          top: -1,
          right: -1,
          width: 10,
          height: 10,
          borderBottomLeftRadius: 4,
          backgroundColor: '#F1F5F9',
          borderLeftWidth: 1.5,
          borderBottomWidth: 1.5,
          borderColor: '#CBD5E1',
        }}
      />

      {/* Decorative document horizontal lines */}
      <View
        style={{
          width: '55%',
          height: 2.5,
          backgroundColor: '#E2E8F0',
          borderRadius: 1,
          marginTop: 6,
          marginBottom: 3,
        }}
      />
      <View
        style={{
          width: '70%',
          height: 2.5,
          backgroundColor: '#F1F5F9',
          borderRadius: 1,
        }}
      />

      {/* Format Badge Pinned at Bottom Left */}
      <View
        style={{
          position: 'absolute',
          bottom: 3,
          left: 3,
          backgroundColor: badgeBg,
          borderRadius: 4,
          paddingHorizontal: 4,
          paddingVertical: 1.5,
          alignSelf: 'flex-start',
        }}>
        <Text
          style={{
            color: badgeText,
            fontSize: 8.5,
            fontWeight: '900',
            letterSpacing: 0.3,
          }}>
          {label}
        </Text>
      </View>
    </View>
  );
};

/**
 * 13. Search Magnifying Glass Icon (Crisp Vector)
 */
export const SearchOutlineIcon: React.FC<IconProps> = ({ size = 18, color = '#016EEF' }) => {
  const circleSize = Math.round(size * 0.72);
  const handleLen = Math.round(size * 0.33);
  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <View
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: circleSize / 2,
          borderWidth: 2,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: 0.5,
          right: 0.5,
          width: handleLen,
          height: 2,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

/**
 * 13b. Warning Triangle Outline Icon (Figma Screen 3: Search - error)
 */
export const WarningTriangleIcon: React.FC<IconProps> = ({ size = 24, color = '#016EEF', innerColor = '#EFF6FF' }) => {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.45,
          borderRightWidth: size * 0.45,
          borderBottomWidth: size * 0.8,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.35,
          borderRightWidth: size * 0.35,
          borderBottomWidth: size * 0.65,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: innerColor,
          top: size * 0.22,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 2,
          height: size * 0.25,
          backgroundColor: color,
          borderRadius: 1,
          top: size * 0.4,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: 2,
          height: 2,
          backgroundColor: color,
          borderRadius: 1,
          bottom: size * 0.2,
        }}
      />
    </View>
  );
};

/**
 * 14. Category: Documents Icon (Red Vector Document Outline)
 * Figma: Documents Category button
 */
export const CategoryDocIcon: React.FC<IconProps> = ({ size = 24, color = '#DC2626' }) => {
  const w = size * 0.78;
  const h = size;
  return (
    <View
      style={{
        width: w,
        height: h,
        borderWidth: 1.8,
        borderColor: color,
        borderRadius: 4,
        padding: 2.5,
        justifyContent: 'center',
        gap: 2.5,
      }}>
      <View style={{ width: '80%', height: 1.8, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: '60%', height: 1.8, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: '70%', height: 1.8, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
};

/**
 * 15. Category: Sheets Icon (Green Vector Spreadsheet Table Grid)
 * Figma: Sheets Category button
 */
export const CategorySheetIcon: React.FC<IconProps> = ({ size = 24, color = '#16A34A' }) => {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: 1.8,
        borderColor: color,
        borderRadius: 4,
        overflow: 'hidden',
      }}>
      {/* Horizontal row divider */}
      <View
        style={{
          position: 'absolute',
          top: '50%',
          left: 0,
          right: 0,
          height: 1.5,
          backgroundColor: color,
        }}
      />
      {/* Vertical column divider */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '50%',
          width: 1.5,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

/**
 * 16. Category: Images Icon (Purple Vector Photo Frame)
 * Figma: Images Category button
 */
export const CategoryImgIcon: React.FC<IconProps> = ({ size = 24, color = '#7C3AED' }) => {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: 1.8,
        borderColor: color,
        borderRadius: 4,
        position: 'relative',
        overflow: 'hidden',
      }}>
      {/* Sun */}
      <View
        style={{
          position: 'absolute',
          top: 3,
          right: 3,
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: color,
        }}
      />
      {/* Mountain peak */}
      <View
        style={{
          position: 'absolute',
          bottom: -3,
          left: 2,
          width: 12,
          height: 12,
          borderTopWidth: 1.8,
          borderLeftWidth: 1.8,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

/**
 * 17. Category: Archives Icon (Brown Vector Box Outline)
 * Figma: Archives Category button
 */
export const CategoryArchiveIcon: React.FC<IconProps> = ({ size = 24, color = '#B45309' }) => {
  const w = size;
  const h = size * 0.82;
  return (
    <View style={{ width: w, height: h, position: 'relative' }}>
      {/* Lid */}
      <View
        style={{
          width: w,
          height: 4,
          backgroundColor: color,
          borderRadius: 2,
          marginBottom: 1,
        }}
      />
      {/* Box Body */}
      <View
        style={{
          width: w,
          height: h - 5,
          borderWidth: 1.8,
          borderTopWidth: 0,
          borderColor: color,
          borderBottomLeftRadius: 4,
          borderBottomRightRadius: 4,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {/* Handle / label */}
        <View
          style={{
            width: 8,
            height: 3,
            borderWidth: 1.2,
            borderColor: color,
            borderRadius: 1.5,
          }}
        />
      </View>
    </View>
  );
};

/**
 * 18. Internal Storage Hard Drive Icon (Crisp Vector)
 * Figma: Storage section icon
 */
export const HardDriveStorageIcon: React.FC<IconProps> = ({ size = 20, color = '#0F172A' }) => {
  const w = size;
  const h = size * 0.7;
  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: 3.5,
        borderWidth: 1.8,
        borderColor: color,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 3,
      }}>
      {/* Disc slot line */}
      <View style={{ width: '60%', height: 2, backgroundColor: color, borderRadius: 1 }} />
      {/* LED indicator */}
      <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: color }} />
    </View>
  );
};

/**
 * 19. Sponsored Document Scanner Icon (Purple Vector)
 * Figma: Sponsored ad icon
 */
export const DocScannerIcon: React.FC<IconProps> = ({ size = 22, color = '#7C3AED' }) => {
  return (
    <View
      style={{
        width: size * 0.8,
        height: size,
        borderWidth: 1.8,
        borderColor: color,
        borderRadius: 3.5,
        position: 'relative',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 2,
      }}>
      {/* Scanner horizontal line */}
      <View style={{ width: '85%', height: 2, backgroundColor: color, borderRadius: 1, marginVertical: 2 }} />
      <View style={{ width: '60%', height: 1.5, backgroundColor: color, borderRadius: 1, opacity: 0.6 }} />
    </View>
  );
};

/**
 * 20. Empty Document Outline Icon
 * Figma: First launch empty recent state
 */
export const EmptyDocOutlineIcon: React.FC<IconProps> = ({ size = 38, color = '#94A3B8' }) => {
  const w = size * 0.76;
  const h = size;
  return (
    <View
      style={{
        width: w,
        height: h,
        borderWidth: 1.5,
        borderColor: color,
        borderStyle: 'dashed',
        borderRadius: 4,
        position: 'relative',
        backgroundColor: '#FFFFFF',
      }}>
      {/* Folded corner */}
      <View
        style={{
          position: 'absolute',
          top: -1,
          right: -1,
          width: 9,
          height: 9,
          borderBottomLeftRadius: 3,
          backgroundColor: '#FFFFFF',
          borderLeftWidth: 1.5,
          borderBottomWidth: 1.5,
          borderColor: color,
        }}
      />
    </View>
  );
};

/**
 * 21. Right Arrow Icon (Crisp vector arrow with chevron head)
 * Figma: Hero card browse arrow button (color: #246B50)
 */
export const RightArrowIcon: React.FC<{ size?: number; color?: string; strokeWidth?: number }> = ({
  size = 20,
  color = '#246B50',
  strokeWidth = 2.4,
}) => {
  const headSize = size * 0.44;
  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
      }}>
      {/* Horizontal stem line */}
      <View
        style={{
          position: 'absolute',
          left: 2,
          width: size - 4,
          height: strokeWidth,
          backgroundColor: color,
          borderRadius: strokeWidth / 2,
        }}
      />
      {/* Arrowhead chevron pointing right */}
      <View
        style={{
          position: 'absolute',
          right: 3,
          width: headSize,
          height: headSize,
          borderTopWidth: strokeWidth,
          borderRightWidth: strokeWidth,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

/**
 * 22. Empty Folder Dashed Outline Icon
 * Figma Screen 6: Browse — empty folder
 */
export const EmptyFolderDashedIcon: React.FC<IconProps> = ({ size = 64, color = '#CBD5E1' }) => {
  const w = size;
  const h = size * 0.76;
  const tabW = w * 0.44;
  const tabH = h * 0.28;

  return (
    <View style={{ width: w, height: h, position: 'relative' }}>
      {/* Top folder tab */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: tabW,
          height: tabH,
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          borderWidth: 1.8,
          borderBottomWidth: 0,
          borderColor: color,
          borderStyle: 'dashed',
        }}
      />
      {/* Folder body */}
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: w,
          height: h - tabH + 2,
          borderRadius: 8,
          borderWidth: 1.8,
          borderColor: color,
          borderStyle: 'dashed',
        }}
      />
    </View>
  );
};

/**
 * 23. Audio Note Icon
 * Figma Screen 8: Browse — no files in category (Audio)
 */
export const AudioNoteIcon: React.FC<IconProps> = ({ size = 26, color = '#016EEF' }) => {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: size, color, fontWeight: '800', lineHeight: size + 2 }}>♫</Text>
    </View>
  );
};

/**
 * 24. Share Node Vector Icon (3 circles with 2 branching lines)
 * Figma: Selection Mode & File Menu
 */
export const ShareVectorIcon: React.FC<IconProps> = ({ size = 18, color = '#016EEF' }) => {
  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {/* Upper line */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.28,
          left: size * 0.22,
          width: size * 0.52,
          height: 1.6,
          backgroundColor: color,
          transform: [{ rotate: '-30deg' }],
        }}
      />
      {/* Lower line */}
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.28,
          left: size * 0.22,
          width: size * 0.52,
          height: 1.6,
          backgroundColor: color,
          transform: [{ rotate: '30deg' }],
        }}
      />
      {/* Left Node */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.36,
          left: 1,
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: size * 0.14,
          borderWidth: 1.6,
          borderColor: color,
          backgroundColor: '#FFFFFF',
        }}
      />
      {/* Top Right Node */}
      <View
        style={{
          position: 'absolute',
          top: 1,
          right: 1,
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: size * 0.14,
          borderWidth: 1.6,
          borderColor: color,
          backgroundColor: '#FFFFFF',
        }}
      />
      {/* Bottom Right Node */}
      <View
        style={{
          position: 'absolute',
          bottom: 1,
          right: 1,
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: size * 0.14,
          borderWidth: 1.6,
          borderColor: color,
          backgroundColor: '#FFFFFF',
        }}
      />
    </View>
  );
};

/**
 * 25. Info Circle Vector Icon
 * Figma: File Menu (File information)
 */
export const InfoCircleIcon: React.FC<IconProps> = ({ size = 18, color = '#0F172A' }) => {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.6,
        borderColor: color,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      <Text style={{ fontSize: size * 0.65, fontWeight: '800', color, marginTop: -1 }}>i</Text>
    </View>
  );
};

/**
 * 26. Checkmark Square Icon for Selection Mode
 * Figma Screen 10: Browse — selection mode
 */
export const SelectionCheckbox: React.FC<{ selected: boolean; size?: number }> = ({
  selected,
  size = 20,
}) => {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        backgroundColor: selected ? '#016EEF' : '#FFFFFF',
        borderWidth: selected ? 0 : 1.6,
        borderColor: '#CBD5E1',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      {selected && (
        <Text style={{ color: '#FFFFFF', fontSize: size * 0.68, fontWeight: '900', marginTop: -1 }}>
          ✓
        </Text>
      )}
    </View>
  );
};

/**
 * 27. Zoom In Icon (Magnifier with +)
 * Figma: PDF viewer floating bottom bar #0D084C
 */
export const ZoomInIcon: React.FC<IconProps> = ({ size = 20, color = '#FFFFFF' }) => {
  const circleSize = Math.round(size * 0.72);
  const handleLen = Math.round(size * 0.33);
  const crossSize = Math.round(circleSize * 0.52);

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {/* Circle lens */}
      <View
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: circleSize / 2,
          borderWidth: 2,
          borderColor: color,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        {/* Horizontal line of + */}
        <View
          style={{
            position: 'absolute',
            width: crossSize,
            height: 1.8,
            backgroundColor: color,
            borderRadius: 0.9,
          }}
        />
        {/* Vertical line of + */}
        <View
          style={{
            position: 'absolute',
            width: 1.8,
            height: crossSize,
            backgroundColor: color,
            borderRadius: 0.9,
          }}
        />
      </View>
      {/* 45deg Handle */}
      <View
        style={{
          position: 'absolute',
          bottom: 1,
          right: 1,
          width: handleLen,
          height: 2,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

/**
 * 28. Zoom Out Icon (Magnifier with -)
 * Figma: PDF viewer floating bottom bar #0D084C
 */
export const ZoomOutIcon: React.FC<IconProps> = ({ size = 20, color = '#FFFFFF' }) => {
  const circleSize = Math.round(size * 0.72);
  const handleLen = Math.round(size * 0.33);
  const minusWidth = Math.round(circleSize * 0.52);

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {/* Circle lens */}
      <View
        style={{
          width: circleSize,
          height: circleSize,
          borderRadius: circleSize / 2,
          borderWidth: 2,
          borderColor: color,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        {/* Horizontal line of - */}
        <View
          style={{
            width: minusWidth,
            height: 1.8,
            backgroundColor: color,
            borderRadius: 0.9,
          }}
        />
      </View>
      {/* 45deg Handle */}
      <View
        style={{
          position: 'absolute',
          bottom: 1,
          right: 1,
          width: handleLen,
          height: 2,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

/**
 * 29. Document Pages / TOC Outline Icon (Card with 3 stripes)
 * Figma: PDF viewer floating bottom bar #0D084C
 */
export const DocListOutlineIcon: React.FC<IconProps> = ({ size = 20, color = '#FFFFFF' }) => {
  const w = size * 0.75;
  const h = size;

  return (
    <View
      style={{
        width: w,
        height: h,
        borderRadius: 4,
        borderWidth: 2,
        borderColor: color,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 2.5,
      }}>
      <View
        style={{
          width: '100%',
          height: 1.8,
          backgroundColor: color,
          borderRadius: 0.9,
          marginBottom: 2.5,
        }}
      />
      <View
        style={{
          width: '100%',
          height: 1.8,
          backgroundColor: color,
          borderRadius: 0.9,
          marginBottom: 2.5,
        }}
      />
      <View
        style={{
          width: '65%',
          height: 1.8,
          backgroundColor: color,
          borderRadius: 0.9,
          alignSelf: 'flex-start',
        }}
      />
    </View>
  );
};

/**
 * 30. Eye Outline Icon
 */
export const EyeOutlineIcon: React.FC<IconProps> = ({ size = 18, color = '#64748B' }) => {
  return (
    <View
      style={{
        width: size,
        height: size * 0.65,
        borderRadius: size * 0.35,
        borderWidth: 1.6,
        borderColor: color,
        justifyContent: 'center',
        alignItems: 'center',
      }}>
      <View
        style={{
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: size * 0.14,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

/**
 * 31. Eye Off Outline Icon (Eye with slash)
 */
export const EyeOffOutlineIcon: React.FC<IconProps> = ({ size = 18, color = '#64748B' }) => {
  return (
    <View style={{ width: size, height: size * 0.7, position: 'relative', justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          width: size,
          height: size * 0.65,
          borderRadius: size * 0.35,
          borderWidth: 1.6,
          borderColor: color,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        <View
          style={{
            width: size * 0.28,
            height: size * 0.28,
            borderRadius: size * 0.14,
            backgroundColor: color,
          }}
        />
      </View>
      {/* Slash */}
      <View
        style={{
          position: 'absolute',
          width: size * 1.15,
          height: 1.8,
          backgroundColor: color,
          borderRadius: 1,
          transform: [{ rotate: '-45deg' }],
        }}
      />
    </View>
  );
};

/**
 * 29. Rotate Vector Icon (Circular Arrow)
 * Matches Image 4
 */
export const RotateVectorIcon: React.FC<IconProps> = ({ size = 20, color = '#1E1B4B' }) => {
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <View
        style={{
          width: size * 0.82,
          height: size * 0.82,
          borderRadius: (size * 0.82) / 2,
          borderWidth: 1.8,
          borderColor: color,
          borderTopColor: 'transparent',
          transform: [{ rotate: '-45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: size * 0.2,
          width: 0,
          height: 0,
          borderLeftWidth: size * 0.16,
          borderRightWidth: size * 0.16,
          borderBottomWidth: size * 0.24,
          borderStyle: 'solid',
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
};

/**
 * 30. Frame Expand / Fit Vector Icon (4-corner viewfinder brackets)
 * Matches Image 4
 */
export const FrameExpandVectorIcon: React.FC<IconProps> = ({ size = 20, color = '#1E1B4B' }) => {
  const cornerSize = size * 0.3;
  const stroke = 1.8;
  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {/* Top-Left */}
      <View style={{ position: 'absolute', top: 1, left: 1, width: cornerSize, height: cornerSize, borderTopWidth: stroke, borderLeftWidth: stroke, borderColor: color }} />
      {/* Top-Right */}
      <View style={{ position: 'absolute', top: 1, right: 1, width: cornerSize, height: cornerSize, borderTopWidth: stroke, borderRightWidth: stroke, borderColor: color }} />
      {/* Bottom-Left */}
      <View style={{ position: 'absolute', bottom: 1, left: 1, width: cornerSize, height: cornerSize, borderBottomWidth: stroke, borderLeftWidth: stroke, borderColor: color }} />
      {/* Bottom-Right */}
      <View style={{ position: 'absolute', bottom: 1, right: 1, width: cornerSize, height: cornerSize, borderBottomWidth: stroke, borderRightWidth: stroke, borderColor: color }} />
    </View>
  );
};

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});


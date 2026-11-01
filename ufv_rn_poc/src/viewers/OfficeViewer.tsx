import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Dimensions,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Image,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { MMKV } from '../services/MMKV';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface OfficeViewerProps {
  filePath: string;
  fileName: string;
  formatType: 'DOCX' | 'PPTX' | 'DOC' | 'PPT';
  onClose: () => void;
}

// Phase 1 / Phase 2 PPTX Schema
interface PptxElement {
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
}

interface PptxSlideData {
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
  elements: PptxElement[];
}

interface LegacySlideData {
  slideNumber: number;
  title: string;
  bullets: string[];
  imageUris?: string[];
}

export const OfficeViewer: React.FC<OfficeViewerProps> = ({
  filePath,
  fileName,
  formatType,
  onClose,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [base64Content, setBase64Content] = useState<string>('');

  // PPTX Presentation States
  const [slideCount, setSlideCount] = useState<number>(1);
  const [slideAspectRatio, setSlideAspectRatio] = useState<number>(16 / 9);
  const [slideWidthEMU, setSlideWidthEMU] = useState<number>(12192000);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [isLandscape, setIsLandscape] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'deck' | 'cards'>('deck');
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  // Cached parsed slides
  const [pptxSlides, setPptxSlides] = useState<Record<number, PptxSlideData>>({});
  const [legacySlides, setLegacySlides] = useState<LegacySlideData[]>([]);
  const flatListRef = useRef<FlatList<any>>(null);
  const thumbnailListRef = useRef<FlatList<any>>(null);
  const webViewRef = useRef<WebView>(null);

  // Word DOCX display states
  const [docFontScale, setDocFontScale] = useState<number>(1.0);
  const [docViewMode, setDocViewMode] = useState<'a4' | 'reading'>('a4');

  const engine = ArchiveEngine.getInstance();
  const isLegacy = formatType === 'DOC' || formatType === 'PPT';
  const isDocx = formatType === 'DOCX';
  const isPptx = formatType === 'PPTX';

  const handleShare = async () => {
    try {
      const mime = isDocx
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : isPptx
        ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        : 'application/octet-stream';
      await engine.shareFile(filePath, mime);
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  const handleOpenExternal = async () => {
    try {
      await engine.shareFile(filePath, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    } catch (err) {
      console.warn('External open error', err);
    }
  };

  // Fetch individual slide with prefetching
  const fetchSlide = useCallback(
    async (index: number) => {
      if (pptxSlides[index]) return;
      try {
        const slide = await engine.getPptxSlide(filePath, index);
        if (slide) {
          setPptxSlides((prev) => ({ ...prev, [index]: slide as unknown as PptxSlideData }));
        }
      } catch (err) {
        console.warn(`Error loading slide ${index + 1}:`, err);
      }
    },
    [filePath, pptxSlides]
  );

  // Pre-fetch adjacent slides
  useEffect(() => {
    if (!isPptx || slideCount <= 0) return;
    fetchSlide(currentSlideIndex);
    if (currentSlideIndex + 1 < slideCount) {
      fetchSlide(currentSlideIndex + 1);
    }
    if (currentSlideIndex - 1 >= 0) {
      fetchSlide(currentSlideIndex - 1);
    }
  }, [isPptx, currentSlideIndex, slideCount, fetchSlide]);

  // Load Presentation Metadata and Initial Slides
  const loadPptxPresentation = async () => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      // 1. Get Presentation Metadata (fast OpenXML header check)
      const meta = await engine.getPptxMeta(filePath);
      const count = meta.slideCount > 0 ? meta.slideCount : 1;
      const aspect = meta.aspectRatio > 0 ? meta.aspectRatio : 16 / 9;
      setSlideCount(count);
      setSlideAspectRatio(aspect);
      if (meta.widthEMU) setSlideWidthEMU(meta.widthEMU);

      // Restore last read position from MMKV
      const lastPos = MMKV.getPosition(filePath);
      let initialIdx = 0;
      if (lastPos?.slide && lastPos.slide > 0 && lastPos.slide <= count) {
        initialIdx = lastPos.slide - 1;
        setCurrentSlideIndex(initialIdx);
      }

      // 2. Fetch the initial slide
      const initialSlide = await engine.getPptxSlide(filePath, initialIdx);
      if (initialSlide) {
        setPptxSlides({ [initialIdx]: initialSlide as unknown as PptxSlideData });
      }

      // Prefetch adjacent
      if (initialIdx + 1 < count) {
        engine.getPptxSlide(filePath, initialIdx + 1).then((s) => {
          if (s) setPptxSlides((prev) => ({ ...prev, [initialIdx + 1]: s as unknown as PptxSlideData }));
        });
      }

      // Also parse legacy slides in background for "Cards View" fallback
      engine.parsePptxSlides(filePath).then((res) => {
        if (res && res.slides) {
          setLegacySlides(res.slides);
        }
      }).catch(() => {});

      setIsLoading(false);

      if (initialIdx > 0) {
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index: initialIdx, animated: false });
        }, 120);
      }
    } catch (err: any) {
      console.warn('Native PPTX parser failed, trying legacy fallback:', err);
      // Fallback to legacy parser if new parser fails
      try {
        const res = await engine.parsePptxSlides(filePath);
        if (res && res.slides && res.slides.length > 0) {
          setLegacySlides(res.slides);
          setSlideCount(res.slides.length);
          setViewMode('cards');
          setIsLoading(false);
          return;
        }
      } catch (legacyErr: any) {
        setErrorMsg(`Failed to open PPTX: ${err.message || String(err)}`);
      }
      setIsLoading(false);
    }
  };

  // Load Content on Mount
  useEffect(() => {
    setIsLoading(true);
    setErrorMsg(null);

    if (isPptx) {
      loadPptxPresentation();
    } else if (isDocx) {
      ArchiveEngine.getInstance()
        .readFileBase64(filePath)
        .then((b64) => {
          const clean = b64.replace(/[\r\n\s]/g, '');
          setBase64Content(clean);
          setIsLoading(false);
        })
        .catch((err) => {
          setIsLoading(false);
          setErrorMsg(`Failed to read document: ${err.message || String(err)}`);
        });
    } else {
      setIsLoading(false);
    }
  }, [filePath, formatType, isDocx, isPptx]);

  // Dimensions for presentation slide
  const availableWidth = isLandscape ? SCREEN_HEIGHT - 32 : SCREEN_WIDTH - 24;
  const slideWidth = availableWidth * zoomLevel;
  const slideHeight = slideWidth / slideAspectRatio;

  // Scale from PPTX points to screen pixels
  // 1 EMU = 1/12700 pt
  const slideWidthPt = (slideWidthEMU || 12192000) / 12700;
  const fontScale = (slideWidth / slideWidthPt);

  // --- Render Single Native Presentation Slide ---
  const renderNativeSlide = (slide: PptxSlideData | undefined, index: number) => {
    if (!slide) {
      return (
        <View style={[styles.slideCanvas, { width: slideWidth, height: slideHeight, backgroundColor: '#0f172a' }]}>
          <ActivityIndicator color="#38bdf8" size="small" />
          <Text style={styles.loadingSlideText}>Loading Slide {index + 1}...</Text>
        </View>
      );
    }

    const bg = slide.background;
    let bgColor = '#FFFFFF';
    if (bg) {
      if (bg.type === 'solid' && bg.color) {
        bgColor = bg.color;
      } else if (bg.type === 'gradient' && bg.stops && bg.stops.length > 0) {
        bgColor = bg.stops[0].color;
      }
    }

    return (
      <View
        style={[
          styles.slideCanvas,
          {
            width: slideWidth,
            height: slideHeight,
            backgroundColor: bgColor,
          },
        ]}>
        {/* Background Image if any */}
        {bg?.type === 'image' && bg.imageUri && (
          <Image
            source={{ uri: bg.imageUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
        )}

        {/* Elements in Z-Order */}
        {slide.elements.map((el, elIdx) => {
          const elX = el.x * slideWidth;
          const elY = el.y * slideHeight;
          const elW = Math.max(2, el.w * slideWidth);
          const elH = Math.max(2, el.h * slideHeight);

          // Geometry styling
          let borderRadius = 0;
          if (el.geometry === 'ellipse') {
            borderRadius = 9999;
          } else if (el.geometry === 'roundRect') {
            borderRadius = Math.min(elW, elH) * 0.12;
          }

          // Fill styling
          let fillBg: string | undefined = undefined;
          if (el.fill?.type === 'solid' && el.fill.color) {
            fillBg = el.fill.color;
          } else if (el.fill?.type === 'none') {
            fillBg = 'transparent';
          }

          // Border styling (prevents phantom border outlines on text frames)
          let borderWidth = 0;
          let borderColor = 'transparent';
          if (el.line && el.line.color && el.line.color !== 'transparent') {
            const hasText = el.paragraphs && el.paragraphs.length > 0;
            const isTextFrame = el.type === 'text' || hasText;
            if (!isTextFrame) {
              borderWidth = Math.max(1, (el.line.width || 1) * fontScale * 0.75);
              borderColor = el.line.color;
            }
          }

          // Transforms (rotation & flip)
          const transformStyles: any[] = [];
          if (el.rotation) transformStyles.push({ rotate: `${el.rotation}deg` });
          if (el.flipH) transformStyles.push({ scaleX: -1 });
          if (el.flipV) transformStyles.push({ scaleY: -1 });

          // Anchor (vertical text alignment)
          const justifyContent =
            el.anchor === 'middle' ? 'center' : el.anchor === 'bottom' ? 'flex-end' : 'flex-start';

          return (
            <View
              key={`el-${elIdx}`}
              style={[
                styles.slideElement,
                {
                  left: elX,
                  top: elY,
                  width: elW,
                  height: elH,
                  borderRadius,
                  backgroundColor: fillBg,
                  borderWidth,
                  borderColor,
                  justifyContent,
                  transform: transformStyles.length > 0 ? transformStyles : undefined,
                },
              ]}>
              {/* 1. Image Element */}
              {el.type === 'image' && el.imageUri && (
                <Image
                  source={{ uri: el.imageUri }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              )}

              {/* 2. Text Element */}
              {el.paragraphs && el.paragraphs.length > 0 && (
                <View style={{ width: '100%' }}>
                  {el.paragraphs.map((p, pIdx) => {
                    const align = p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left';
                    return (
                      <View
                        key={`p-${pIdx}`}
                        style={[
                          styles.paragraphRow,
                          {
                            justifyContent:
                              align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
                          },
                        ]}>
                        {/* Bullet point */}
                        {p.bullet && (
                          <Text
                            style={[
                              styles.bulletSymbol,
                              {
                                fontSize: Math.max(8, 14 * fontScale),
                                color: p.runs[0]?.color || '#000000',
                              },
                            ]}>
                            {p.bullet === 'auto' ? `${pIdx + 1}. ` : `${p.bullet} `}
                          </Text>
                        )}

                        {/* Runs */}
                        <Text style={{ textAlign: align, flexShrink: 1 }}>
                          {p.runs.map((r, rIdx) => {
                            const calculatedSize = Math.max(
                              7.5,
                              (r.sizePt || 16) * fontScale * (el.autofit?.fontScale || 1.0)
                            );
                            return (
                              <Text
                                key={`r-${rIdx}`}
                                style={{
                                  fontSize: calculatedSize,
                                  fontWeight: r.bold ? '700' : '400',
                                  fontStyle: r.italic ? 'italic' : 'normal',
                                  textDecorationLine: r.underline ? 'underline' : 'none',
                                  color: r.color || '#000000',
                                }}>
                                {r.text}
                              </Text>
                            );
                          })}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* 3. Table Element */}
              {el.type === 'table' && el.table && (
                <View style={styles.tableBox}>
                  {el.table.rows.map((row, rIdx) => (
                    <View key={`tr-${rIdx}`} style={styles.tableRow}>
                      {row.map((cell, cIdx) => (
                        <View
                          key={`tc-${cIdx}`}
                          style={[styles.tableCell, { backgroundColor: cell.fill || '#FFFFFF' }]}>
                          <Text style={{ fontSize: Math.max(7, 11 * fontScale), color: '#000000' }}>
                            {cell.text}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              )}

              {/* 4. Unsupported Shape / Chart Indicator */}
              {el.type === 'unsupported' && (
                <View style={styles.unsupportedBadge}>
                  <Text style={styles.unsupportedText}>[{el.kind || 'Graphic'}]</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  // --- Render Slide Card for Reading View Fallback ---
  const renderReadingCard = (item: LegacySlideData) => {
    return (
      <View style={[styles.readingCard, { width: availableWidth }]}>
        <View style={styles.slideCardHeader}>
          <View style={styles.slideNumberBadge}>
            <Text style={styles.slideNumberText}>
              Slide {item.slideNumber} of {slideCount}
            </Text>
          </View>
        </View>

        <Text style={styles.slideCardTitle} numberOfLines={2}>
          {item.title}
        </Text>

        {item.imageUris && item.imageUris.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScroll}>
            {item.imageUris.map((uri, idx) => (
              <Image key={idx} source={{ uri }} style={styles.slideThumbnail} resizeMode="contain" />
            ))}
          </ScrollView>
        )}

        <ScrollView style={styles.slideBodyScroll} showsVerticalScrollIndicator={false}>
          {item.bullets.map((bullet, idx) => (
            <View key={idx} style={styles.bulletRow}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletText}>{bullet}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  };

  // DOCX Offline HTML Template for WebView
  const docxHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
  <script src="file:///android_asset/jszip.min.js"></script>
  <script src="file:///android_asset/docx-preview.min.js"></script>
  <script src="file:///android_asset/mammoth.browser.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 10px 8px;
      background: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #1e293b;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    #docx-container {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .docx-wrapper {
      background: transparent !important;
      padding: 0 !important;
      width: 100% !important;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .docx-wrapper > section.docx {
      background: #ffffff !important;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25) !important;
      margin-bottom: 16px !important;
      padding: 24px 18px !important;
      width: 100% !important;
      max-width: 820px !important;
      border-radius: 10px !important;
      box-sizing: border-box !important;
    }
    table {
      max-width: 100% !important;
      border-collapse: collapse !important;
      margin: 12px 0 !important;
      font-size: 13px !important;
    }
    th, td {
      border: 1px solid #cbd5e1 !important;
      padding: 8px 10px !important;
      text-align: left !important;
      vertical-align: top !important;
    }
    th {
      background: #f1f5f9 !important;
      font-weight: 700 !important;
      color: #0f172a !important;
    }
  </style>
</head>
<body>
  <div id="docx-container"></div>
  <div id="mammoth-fallback" style="display:none;"></div>
  <script>
    function base64ToArrayBuffer(base64) {
      var binaryString = window.atob(base64);
      var len = binaryString.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }

    var isRendering = false;
    function doRender(b64) {
      if (!b64 || b64.length === 0 || isRendering) return;
      var container = document.getElementById("docx-container");
      var fallbackContainer = document.getElementById("mammoth-fallback");
      var arrayBuffer = base64ToArrayBuffer(b64);

      function tryDocx() {
        if (typeof docx !== 'undefined' && docx.renderAsync) {
          isRendering = true;
          docx.renderAsync(arrayBuffer, container, null, {
            className: "docx",
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            experimental: true,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true,
          }).then(function() {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DOCX_RENDERED', engine: 'docx-preview' }));
            }
          }).catch(function(err) {
            console.warn('docx-preview error, falling back to mammoth:', err);
            tryMammoth();
          });
          return true;
        }
        return false;
      }

      function tryMammoth() {
        if (typeof mammoth !== 'undefined' && mammoth.convertToHtml) {
          isRendering = true;
          mammoth.convertToHtml({ arrayBuffer: arrayBuffer }).then(function(result) {
            container.style.display = 'none';
            fallbackContainer.style.display = 'block';
            fallbackContainer.innerHTML = result.value;
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DOCX_RENDERED', engine: 'mammoth' }));
            }
          }).catch(function(err) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DOCX_ERROR', error: err.message || String(err) }));
            }
          });
          return true;
        }
        return false;
      }

      // Poll until docx-preview or mammoth is ready
      var tries = 0;
      function pollLibraries() {
        if (tryDocx()) return;
        tries++;
        if (tries < 40) {
          setTimeout(pollLibraries, 50);
        } else {
          tryMammoth();
        }
      }
      pollLibraries();
    }

    window.renderDocx = doRender;

    function checkAndRun() {
      var b64 = window.__DOCX_B64__;
      if (b64 && b64.length > 0) {
        doRender(b64);
      }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      checkAndRun();
    } else {
      window.addEventListener('DOMContentLoaded', checkAndRun);
      window.addEventListener('load', checkAndRun);
    }
  </script>
</body>
</html>
`;

  const applyDocxStyle = useCallback((font = docFontScale, mode = docViewMode) => {
    if (!webViewRef.current) return;
    const isRead = mode === 'reading';
    const percent = Math.round(font * 100);
    const js = `
      (function() {
        var container = document.getElementById('docx-container');
        if (container) {
          container.style.fontSize = '${percent}%';
        }
        var sections = document.querySelectorAll('.docx-wrapper > section.docx');
        for (var i = 0; i < sections.length; i++) {
          var s = sections[i];
          s.style.fontSize = '${percent}%';
          if (${isRead}) {
            s.style.maxWidth = '100%';
            s.style.padding = '16px';
            s.style.boxShadow = 'none';
            s.style.borderRadius = '0px';
          } else {
            s.style.maxWidth = '820px';
            s.style.padding = '40px 32px';
            s.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.1)';
            s.style.borderRadius = '8px';
          }
        }
      })();
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [docFontScale, docViewMode]);

  useEffect(() => {
    if (isDocx && !isLoading && base64Content.length > 0) {
      applyDocxStyle(docFontScale, docViewMode);
    }
  }, [isDocx, isLoading, base64Content, docFontScale, docViewMode, applyDocxStyle]);

  // Keep thumbnail list centered on current slide
  useEffect(() => {
    if (thumbnailListRef.current && slideCount > 0) {
      try {
        thumbnailListRef.current.scrollToIndex({
          index: currentSlideIndex,
          animated: true,
          viewPosition: 0.5,
        });
      } catch {}
    }
  }, [currentSlideIndex, slideCount]);

  const onWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'DOCX_RENDERED') {
        setIsLoading(false);
        applyDocxStyle();
      } else if (data.type === 'DOCX_ERROR') {
        setIsLoading(false);
        setErrorMsg(data.error || 'Failed to render document.');
      }
    } catch {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerMainRow}>
          <TouchableOpacity style={styles.backCloseBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.backCloseIcon}>←</Text>
          </TouchableOpacity>

          <View style={styles.headerTitleBox}>
            <Text style={styles.fileName} numberOfLines={1}>
              {isDocx ? '📘' : isPptx ? '📙' : '📄'} {fileName}
            </Text>
            <Text style={styles.subText}>
              {isDocx
                ? 'Word Document'
                : isPptx
                ? `Presentation • ${slideCount} Slide${slideCount > 1 ? 's' : ''}`
                : 'Legacy Office Document'}
            </Text>
          </View>

          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
            <Text style={styles.shareIconText}>📤</Text>
          </TouchableOpacity>
        </View>

        {/* Sub-Toolbar for Mode & Formatting */}
        <View style={styles.subToolbar}>
          {isDocx && (
            <View style={styles.toolbarContent}>
              <TouchableOpacity
                style={[styles.toolPill, docViewMode === 'reading' && styles.toolPillActive]}
                onPress={() => setDocViewMode((m) => (m === 'a4' ? 'reading' : 'a4'))}
                activeOpacity={0.7}>
                <Text style={[styles.toolPillText, docViewMode === 'reading' && styles.toolPillTextActive]}>
                  {docViewMode === 'reading' ? '📖 Reading View' : '📄 A4 Page View'}
                </Text>
              </TouchableOpacity>

              <View style={styles.fontScaleGroup}>
                <TouchableOpacity
                  style={[styles.fontStepBtn, docFontScale <= 0.8 && styles.stepBtnDisabled]}
                  disabled={docFontScale <= 0.8}
                  onPress={() => setDocFontScale((s) => Math.max(0.8, Number((s - 0.1).toFixed(1))))}
                  activeOpacity={0.7}>
                  <Text style={styles.fontStepText}>A−</Text>
                </TouchableOpacity>
                <Text style={styles.fontScaleDisplay}>{Math.round(docFontScale * 100)}%</Text>
                <TouchableOpacity
                  style={[styles.fontStepBtn, docFontScale >= 1.6 && styles.stepBtnDisabled]}
                  disabled={docFontScale >= 1.6}
                  onPress={() => setDocFontScale((s) => Math.min(1.6, Number((s + 0.1).toFixed(1))))}
                  activeOpacity={0.7}>
                  <Text style={styles.fontStepText}>A+</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {isPptx && (
            <View style={styles.toolbarContent}>
              <TouchableOpacity
                style={[styles.toolPill, viewMode === 'deck' && styles.toolPillActive]}
                onPress={() => setViewMode(viewMode === 'deck' ? 'cards' : 'deck')}
                activeOpacity={0.7}>
                <Text style={[styles.toolPillText, viewMode === 'deck' && styles.toolPillTextActive]}>
                  {viewMode === 'deck' ? '🎨 Slide Deck' : '📝 Text Cards'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.toolPill, isLandscape && styles.toolPillActive]}
                onPress={() => setIsLandscape(!isLandscape)}
                activeOpacity={0.7}>
                <Text style={[styles.toolPillText, isLandscape && styles.toolPillTextActive]}>
                  {isLandscape ? '📱 Portrait' : '🔄 Landscape'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Loading Overlay */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#38bdf8" size="large" />
          <Text style={styles.loadingText}>
            {isPptx ? 'Rendering presentation...' : 'Rendering document...'}
          </Text>
        </View>
      )}

      {/* Error Message */}
      {errorMsg && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
        </View>
      )}

      {/* 1. DOCX: High-Fidelity WebView Renderer */}
      {isDocx && base64Content.length > 0 && (
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{
            html: docxHtml,
            baseUrl: 'file:///android_asset/',
          }}
          injectedJavaScriptBeforeContentLoaded={`
            window.__DOCX_B64__ = ${JSON.stringify(base64Content)};
            true;
          `}
          onLoadEnd={() => {
            if (base64Content) {
              webViewRef.current?.injectJavaScript(`
                window.__DOCX_B64__ = ${JSON.stringify(base64Content)};
                if (typeof window.renderDocx === 'function') {
                  window.renderDocx(${JSON.stringify(base64Content)});
                }
                true;
              `);
            }
          }}
          style={styles.webView}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          onMessage={onWebViewMessage}
        />
      )}

      {/* 2. PPTX: Phase 2 Native High-Fidelity Presentation Deck */}
      {isPptx && (
        <View style={styles.pptxContainer}>
          <FlatList
            ref={flatListRef}
            data={Array.from({ length: slideCount }).map((_, i) => i)}
            keyExtractor={(idx) => `slide-${idx}`}
            horizontal
            pagingEnabled={zoomLevel <= 1.0}
            showsHorizontalScrollIndicator={false}
            snapToInterval={availableWidth + 16}
            decelerationRate="fast"
            contentContainerStyle={styles.pptxListContent}
            onScrollToIndexFailed={() => {}}
            onMomentumScrollEnd={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              const idx = Math.round(x / (availableWidth + 16));
              const safeIdx = Math.max(0, Math.min(idx, slideCount - 1));
              setCurrentSlideIndex(safeIdx);
              MMKV.savePosition(filePath, { slide: safeIdx + 1, total: slideCount });
            }}
            renderItem={({ item: index }) => {
              if (viewMode === 'cards' && legacySlides[index]) {
                return renderReadingCard(legacySlides[index]);
              }
              const slideData = pptxSlides[index];
              return (
                <View style={[styles.slideWrapper, { width: availableWidth }]}>
                  <ScrollView
                    horizontal={zoomLevel > 1.0}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ alignItems: 'center', justifyContent: 'center' }}>
                    {renderNativeSlide(slideData, index)}
                  </ScrollView>
                </View>
              );
            }}
          />

          {/* Thumbnails Tray */}
          {slideCount > 1 && (
            <View style={styles.thumbnailTrayContainer}>
              <FlatList
                ref={thumbnailListRef}
                data={Array.from({ length: slideCount }).map((_, i) => i)}
                keyExtractor={(idx) => `thumb-${idx}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.thumbnailTrayContent}
                onScrollToIndexFailed={() => {}}
                renderItem={({ item: idx }) => {
                  const isActive = idx === currentSlideIndex;
                  return (
                    <TouchableOpacity
                      style={[styles.thumbnailPill, isActive && styles.thumbnailPillActive]}
                      onPress={() => {
                        setCurrentSlideIndex(idx);
                        flatListRef.current?.scrollToIndex({ index: idx, animated: true });
                        MMKV.savePosition(filePath, { slide: idx + 1, total: slideCount });
                      }}
                      activeOpacity={0.7}>
                      <Text style={[styles.thumbnailPillText, isActive && styles.thumbnailPillTextActive]}>
                        {idx + 1}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>
          )}

          {/* Bottom Toolbar for PPTX with Zoom and Navigation */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={[styles.navBtn, currentSlideIndex === 0 && styles.navBtnDisabled]}
              disabled={currentSlideIndex === 0}
              onPress={() => {
                const target = Math.max(0, currentSlideIndex - 1);
                setCurrentSlideIndex(target);
                flatListRef.current?.scrollToIndex({ index: target, animated: true });
                MMKV.savePosition(filePath, { slide: target + 1, total: slideCount });
              }}
              activeOpacity={0.7}>
              <Text style={styles.navBtnText}>◀ Prev</Text>
            </TouchableOpacity>

            {/* Slide Index Badge */}
            <View style={styles.slidePill}>
              <Text style={styles.slidePillText}>
                Slide {currentSlideIndex + 1} / {slideCount}
              </Text>
            </View>

            {/* Zoom Controls */}
            {viewMode === 'deck' && (
              <View style={styles.zoomControls}>
                <TouchableOpacity
                  style={[styles.zoomBtn, zoomLevel <= 1.0 && styles.zoomBtnDisabled]}
                  disabled={zoomLevel <= 1.0}
                  onPress={() => setZoomLevel((z) => Math.max(1.0, z - 0.25))}
                  activeOpacity={0.7}>
                  <Text style={styles.zoomBtnText}>−</Text>
                </TouchableOpacity>

                <Text style={styles.zoomLabel}>{Math.round(zoomLevel * 100)}%</Text>

                <TouchableOpacity
                  style={[styles.zoomBtn, zoomLevel >= 2.5 && styles.zoomBtnDisabled]}
                  disabled={zoomLevel >= 2.5}
                  onPress={() => setZoomLevel((z) => Math.min(2.5, z + 0.25))}
                  activeOpacity={0.7}>
                  <Text style={styles.zoomBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity
              style={[styles.navBtn, currentSlideIndex === slideCount - 1 && styles.navBtnDisabled]}
              disabled={currentSlideIndex === slideCount - 1}
              onPress={() => {
                const target = Math.min(slideCount - 1, currentSlideIndex + 1);
                setCurrentSlideIndex(target);
                flatListRef.current?.scrollToIndex({ index: target, animated: true });
                MMKV.savePosition(filePath, { slide: target + 1, total: slideCount });
              }}
              activeOpacity={0.7}>
              <Text style={styles.navBtnText}>Next ▶</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 3. Legacy DOC/PPT Notice */}
      {isLegacy && (
        <View style={styles.legacyBox}>
          <Text style={styles.legacyIcon}>📄</Text>
          <Text style={styles.legacyTitle}>Legacy Office Binary ({formatType})</Text>
          <Text style={styles.legacyDesc}>
            This binary format uses older proprietary encoding. Tap below to open in Google Docs / Microsoft 365 or share to view.
          </Text>
          <TouchableOpacity style={styles.openExternalBtn} onPress={handleOpenExternal} activeOpacity={0.7}>
            <Text style={styles.openExternalText}>Open in Office App</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  header: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  backCloseIcon: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
  },
  headerTitleBox: {
    flex: 1,
    marginRight: 10,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
  },
  subText: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1e293b',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  shareIconText: {
    fontSize: 16,
  },
  subToolbar: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(51, 65, 85, 0.4)',
  },
  toolbarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolPill: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  toolPillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  toolPillText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  toolPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  fontScaleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#334155',
  },
  fontStepBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fontStepText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  fontScaleDisplay: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
  stepBtnDisabled: {
    opacity: 0.35,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  headerBtnActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  headerBtnText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '600',
  },
  closeBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  closeBtnText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 15, 25, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  loadingText: {
    color: '#38bdf8',
    marginTop: 10,
    fontSize: 14,
    fontWeight: '600',
  },
  loadingSlideText: {
    color: '#94a3b8',
    marginTop: 8,
    fontSize: 12,
  },
  errorBox: {
    margin: 12,
    backgroundColor: '#7f1d1d',
    padding: 12,
    borderRadius: 8,
  },
  errorText: {
    color: '#fecaca',
    fontSize: 13,
    fontWeight: '600',
  },
  webView: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  pptxContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  pptxListContent: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  slideWrapper: {
    marginRight: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideCanvas: {
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  slideElement: {
    position: 'absolute',
    overflow: 'hidden',
  },
  paragraphRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    marginBottom: 2,
  },
  bulletSymbol: {
    marginRight: 4,
    lineHeight: 18,
  },
  tableBox: {
    width: '100%',
    height: '100%',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  tableRow: {
    flexDirection: 'row',
    flex: 1,
  },
  tableCell: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: '#cbd5e1',
    padding: 2,
    justifyContent: 'center',
  },
  unsupportedBadge: {
    flex: 1,
    backgroundColor: 'rgba(100, 116, 139, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(100, 116, 139, 0.3)',
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unsupportedText: {
    fontSize: 10,
    color: '#94a3b8',
    fontWeight: '600',
  },
  readingCard: {
    backgroundColor: '#131d31',
    borderRadius: 14,
    padding: 18,
    marginRight: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    minHeight: 280,
  },
  slideCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  slideNumberBadge: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  slideNumberText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },
  slideCardTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
    lineHeight: 24,
  },
  imageScroll: {
    maxHeight: 120,
    marginBottom: 10,
  },
  slideThumbnail: {
    width: 140,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#0f172a',
    marginRight: 8,
  },
  slideBodyScroll: {
    flex: 1,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  bulletDot: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '800',
    marginRight: 8,
    lineHeight: 20,
  },
  bulletText: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 19,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  navBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navBtnText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  slidePill: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  slidePillText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
  },
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: '#334155',
  },
  zoomBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  zoomBtnDisabled: {
    opacity: 0.3,
  },
  zoomBtnText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  zoomLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  legacyBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  legacyIcon: {
    fontSize: 54,
    marginBottom: 16,
  },
  legacyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 8,
  },
  legacyDesc: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  openExternalBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  openExternalText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  thumbnailTrayContainer: {
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingVertical: 6,
  },
  thumbnailTrayContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  thumbnailPill: {
    minWidth: 44,
    height: 34,
    borderRadius: 6,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  thumbnailPillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#38bdf8',
  },
  thumbnailPillText: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  thumbnailPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
});

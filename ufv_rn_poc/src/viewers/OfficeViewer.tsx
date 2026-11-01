import React, { useState, useEffect, useRef } from 'react';
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
import { NativeModules } from 'react-native';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { MMKV } from '../services/MMKV';

const { ArchiveModule } = NativeModules;
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface OfficeViewerProps {
  filePath: string;
  fileName: string;
  formatType: 'DOCX' | 'PPTX' | 'DOC' | 'PPT';
  onClose: () => void;
}

interface SlideData {
  slideNumber: number;
  title: string;
  bullets: string[];
  imageUris?: string[];
  rawText?: string[];
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

  // PPTX Slide states
  const [slides, setSlides] = useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState<number>(0);
  const [slideCount, setSlideCount] = useState<number>(1);
  const [isLandscape, setIsLandscape] = useState<boolean>(false);
  const flatListRef = useRef<FlatList<SlideData>>(null);

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

  // --- High-Performance Native PPTX Parser ---
  const loadPptxSlides = async () => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      // 1. High-Performance Native Kotlin Parser
      const res = await engine.parsePptxSlides(filePath);
      if (res && res.slides && res.slides.length > 0) {
        setSlides(res.slides);
        setSlideCount(res.slides.length);

        // Restore last read position
        const lastPos = MMKV.getPosition(filePath);
        if (lastPos?.slide && lastPos.slide > 0 && lastPos.slide <= res.slides.length) {
          const target = lastPos.slide - 1;
          setCurrentSlideIndex(target);
          setTimeout(() => {
            flatListRef.current?.scrollToIndex({ index: target, animated: false });
          }, 80);
        }
        setIsLoading(false);
        return;
      }
    } catch (nativeErr) {
      console.warn('Native PPTX parser notice, falling back to entry reader:', nativeErr);
    }

    // 2. Fallback XML Reader
    const parsedSlides: SlideData[] = [];
    try {
      for (let i = 1; i <= 60; i++) {
        try {
          const entryPath = `ppt/slides/slide${i}.xml`;
          const res = await ArchiveModule.readZipEntryText(filePath, entryPath);
          const xml = res.content || '';

          if (!xml) {
            if (i > 1) break;
            continue;
          }

          const paraMatches = xml.match(/<a:p[^>]*>(.*?)<\/a:p>/gs);
          const allText: string[] = [];
          let slideTitle = '';
          const slideBullets: string[] = [];

          if (paraMatches) {
            for (const para of paraMatches) {
              const textMatches = para.match(/<a:t[^>]*>(.*?)<\/a:t>/gs);
              if (!textMatches) continue;

              const fullParaText = textMatches
                .map((m: string) => m.replace(/<a:t[^>]*>/, '').replace(/<\/a:t>/, ''))
                .join('')
                .trim();

              if (fullParaText) {
                allText.push(fullParaText);
                if (!slideTitle) {
                  slideTitle = fullParaText;
                } else {
                  slideBullets.push(fullParaText);
                }
              }
            }
          }

          parsedSlides.push({
            slideNumber: i,
            title: slideTitle || `Slide ${i}`,
            bullets: slideBullets.length > 0 ? slideBullets : allText,
            rawText: allText,
          });
        } catch {
          if (i > 1) break;
        }
      }

      if (parsedSlides.length === 0) {
        parsedSlides.push({
          slideNumber: 1,
          title: fileName,
          bullets: ['No text slides found in this presentation.'],
          rawText: [],
        });
      }

      setSlides(parsedSlides);
      setSlideCount(parsedSlides.length);
    } catch (err: any) {
      setErrorMsg(`Failed to parse presentation: ${err.message || String(err)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Load Content on Mount
  useEffect(() => {
    setIsLoading(true);
    setErrorMsg(null);

    if (isPptx) {
      loadPptxSlides();
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

  // --- DOCX Offline HTML Template for WebView ---
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
      padding: 12px;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1f2937;
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
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 100%;
    }
    .docx-wrapper > section.docx {
      background: #ffffff !important;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1) !important;
      margin-bottom: 20px !important;
      padding: 40px 32px !important;
      width: 100% !important;
      max-width: 794px !important;
      min-height: 1000px;
      border-radius: 6px !important;
      border: 1px solid #e2e8f0;
    }
    table {
      border-collapse: collapse;
      width: 100% !important;
      margin: 16px 0;
    }
    td, th {
      border: 1px solid #cbd5e1 !important;
      padding: 8px 12px;
      font-size: 13px;
    }
    th {
      background-color: #f8fafc;
      font-weight: 600;
    }
    img {
      max-width: 100% !important;
      height: auto !important;
      display: block;
      margin: 12px auto;
    }
    #mammoth-fallback {
      width: 100%;
      max-width: 794px;
      background: #ffffff;
      padding: 40px 32px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
      border-radius: 6px;
      border: 1px solid #e2e8f0;
    }
    #notice-box {
      display: none;
      width: 100%;
      max-width: 794px;
      background: #fef2f2;
      border: 1px solid #f87171;
      color: #991b1b;
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 14px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div id="notice-box"></div>
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

    function loadDocxFile() {
      var container = document.getElementById('docx-container');
      var noticeBox = document.getElementById('notice-box');
      var fallbackContainer = document.getElementById('mammoth-fallback');

      try {
        var b64 = window.__DOCX_B64__;
        if (!b64 || b64.length === 0) {
          throw new Error('No DOCX file data provided');
        }

        var arrayBuffer = base64ToArrayBuffer(b64);

        if (typeof docx !== 'undefined' && docx.renderAsync) {
          docx.renderAsync(arrayBuffer, container, null, {
            className: 'docx',
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
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'DOCX_RENDERED',
                engine: 'docx-preview'
              }));
            }
          }).catch(function(err) {
            console.warn('docx-preview failed, trying mammoth fallback:', err);
            tryMammothFallback(arrayBuffer);
          });
          return;
        }

        tryMammothFallback(arrayBuffer);
      } catch (err) {
        noticeBox.style.display = 'block';
        noticeBox.innerHTML = '<strong>Render Notice:</strong> ' + (err.message || String(err));
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'DOCX_ERROR',
            error: err.message || String(err)
          }));
        }
      }

      function tryMammothFallback(buf) {
        if (typeof mammoth !== 'undefined' && mammoth.convertToHtml) {
          mammoth.convertToHtml({ arrayBuffer: buf })
            .then(function(result) {
              container.style.display = 'none';
              fallbackContainer.style.display = 'block';
              fallbackContainer.innerHTML = result.value;
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'DOCX_RENDERED',
                  engine: 'mammoth'
                }));
              }
            })
            .catch(function(err) {
              noticeBox.style.display = 'block';
              noticeBox.innerHTML = '<strong>Conversion Error:</strong> ' + (err.message || String(err));
            });
        }
      }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      loadDocxFile();
    } else {
      window.addEventListener('DOMContentLoaded', loadDocxFile);
    }
  </script>
</body>
</html>
`;

  const onWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'DOCX_RENDERED') {
        setIsLoading(false);
      } else if (data.type === 'DOCX_ERROR') {
        setIsLoading(false);
        setErrorMsg(data.error || 'Failed to render document.');
      }
    } catch {
      setIsLoading(false);
    }
  };

  // Dimensions for 16:9 Presentation Cards
  const cardWidth = isLandscape ? SCREEN_HEIGHT - 48 : SCREEN_WIDTH - 32;
  const cardHeight = isLandscape ? SCREEN_WIDTH - 150 : cardWidth * (10 / 16);

  // --- Render Slide Card for PPTX Native Engine ---
  const renderSlideCard = ({ item }: { item: SlideData }) => {
    return (
      <View style={[styles.slideCard, { width: cardWidth, minHeight: cardHeight }]}>
        {/* Slide Header */}
        <View style={styles.slideCardHeader}>
          <View style={styles.slideNumberBadge}>
            <Text style={styles.slideNumberText}>
              Slide {item.slideNumber} of {slideCount}
            </Text>
          </View>
        </View>

        {/* Slide Title */}
        <Text style={styles.slideCardTitle} numberOfLines={2}>
          {item.title}
        </Text>

        {/* Slide Images if any */}
        {item.imageUris && item.imageUris.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.imageScroll}
            contentContainerStyle={styles.imageScrollContent}>
            {item.imageUris.map((uri, idx) => (
              <Image
                key={idx}
                source={{ uri }}
                style={styles.slideThumbnail}
                resizeMode="contain"
              />
            ))}
          </ScrollView>
        )}

        {/* Slide Bullets */}
        <ScrollView
          style={styles.slideBodyScroll}
          contentContainerStyle={styles.slideBodyContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled>
          {item.bullets.length > 0 ? (
            item.bullets.map((bullet, idx) => (
              <View key={idx} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>•</Text>
                <Text style={styles.bulletText}>{bullet}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.visualSlideNotice}>[Visual slide with graphic layout]</Text>
          )}
        </ScrollView>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      {/* Top Header */}
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: 8 }}>
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

        <View style={styles.headerRight}>
          {isPptx && (
            <TouchableOpacity
              style={[styles.headerBtn, isLandscape && styles.headerBtnActive]}
              onPress={() => setIsLandscape(!isLandscape)}
              activeOpacity={0.7}>
              <Text style={styles.headerBtnText}>
                {isLandscape ? '📱 Portrait' : '⛶ Landscape'}
              </Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.headerBtn} onPress={handleShare} activeOpacity={0.7}>
            <Text style={styles.headerBtnText}>📤 Share</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Loading Overlay */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#38bdf8" size="large" />
          <Text style={styles.loadingText}>
            {isPptx ? 'Opening slides...' : 'Rendering document...'}
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
          originWhitelist={['*']}
          source={{
            html: docxHtml,
            baseUrl: 'file:///android_asset/',
          }}
          injectedJavaScriptBeforeContentLoaded={`
            window.__DOCX_B64__ = ${JSON.stringify(base64Content)};
            true;
          `}
          style={styles.webView}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          onMessage={onWebViewMessage}
        />
      )}

      {/* 2. PPTX: Pure Native 16:9 Presentation Engine (Zero Freeze, Instant Load) */}
      {isPptx && (
        <View style={styles.pptxContainer}>
          <FlatList
            ref={flatListRef}
            data={slides}
            keyExtractor={(item) => `slide-${item.slideNumber}`}
            renderItem={renderSlideCard}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            snapToInterval={cardWidth + 16}
            decelerationRate="fast"
            contentContainerStyle={styles.pptxListContent}
            onMomentumScrollEnd={(e) => {
              const x = e.nativeEvent.contentOffset.x;
              const idx = Math.round(x / (cardWidth + 16));
              const safeIdx = Math.max(0, Math.min(idx, slideCount - 1));
              setCurrentSlideIndex(safeIdx);
              MMKV.savePosition(filePath, { slide: safeIdx + 1, total: slideCount });
            }}
          />

          {/* Bottom Toolbar for PPTX */}
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

            <View style={styles.slidePill}>
              <Text style={styles.slidePillText}>
                Slide {currentSlideIndex + 1} / {slideCount}
              </Text>
            </View>

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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
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
    fontSize: 12,
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
    paddingVertical: 12,
  },
  pptxListContent: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  slideCard: {
    backgroundColor: '#131d31',
    borderRadius: 14,
    padding: 18,
    marginRight: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
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
  imageScrollContent: {
    gap: 8,
    alignItems: 'center',
  },
  slideThumbnail: {
    width: 140,
    height: 100,
    borderRadius: 8,
    backgroundColor: '#0f172a',
  },
  slideBodyScroll: {
    flex: 1,
  },
  slideBodyContent: {
    paddingVertical: 4,
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
  visualSlideNotice: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
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
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  slidePillText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
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
});

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TextInput,
  Dimensions,
  NativeModules,
  Alert,
} from 'react-native';
import * as XLSX from 'xlsx';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { PasswordModal } from '../components/PasswordModal';
import { WarningTriangleIcon, InfoCircleIcon } from '../components/AppIcons';

interface XlsxViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export const XlsxViewer: React.FC<XlsxViewerProps> = ({
  filePath,
  fileName,
  onClose,
}) => {
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fileSizeStr, setFileSizeStr] = useState<string>('');
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const cancelLoadingRef = useRef<boolean>(false);

  // Zoom scale: 0.7 (70%), 1.0 (100%), 1.25 (125%), 1.5 (150%)
  const [zoom, setZoom] = useState<number>(1.0);

  // Search in sheet
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Cell & Floating Pill
  const [selectedCell, setSelectedCell] = useState<{
    row: number;
    col: number;
    address: string;
    value: string;
  } | null>(null);

  // Password Protection State
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState<boolean>(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Column Auto-Fit & Sort State
  const [colWidths, setColWidths] = useState<Record<number, number>>({});
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('ASC');
  const lastTapRef = React.useRef<{ colIdx: number; time: number }>({ colIdx: -1, time: 0 });

  const engine = ArchiveEngine.getInstance();
  const screenWidth = Dimensions.get('window').width;
  const BASE_ROW_HEIGHT = 38;
  const BASE_INDEX_WIDTH = 48;

  const activeSheetIndex = sheetNames.indexOf(activeSheet);
  const sheetIndexDisplay = activeSheetIndex >= 0 ? activeSheetIndex + 1 : 1;

  const adaptiveColWidth = useMemo(() => {
    if (headers.length === 0) return 90;
    const available = screenWidth - BASE_INDEX_WIDTH;
    if (headers.length <= 4) {
      return Math.floor(available / headers.length);
    }
    return Math.max(85, Math.min(160, Math.floor(available / Math.min(headers.length, 5))));
  }, [headers.length, screenWidth]);

  const colWidth = Math.round(adaptiveColWidth * zoom);
  const rowHeight = Math.round(BASE_ROW_HEIGHT * zoom);
  const indexWidth = Math.round(BASE_INDEX_WIDTH * zoom);
  const fontSize = Math.max(10, Math.round(13 * zoom));
  const headerFontSize = Math.max(10, Math.round(12 * zoom));

  const getColWidth = (colIdx: number) => {
    return colWidths[colIdx] ? Math.round(colWidths[colIdx] * zoom) : colWidth;
  };

  useEffect(() => {
    let isMounted = true;
    cancelLoadingRef.current = false;
    setLoadingProgress(24);

    NativeModules.ArchiveModule?.readFileHeader(filePath, 64)
      .then((res: any) => {
        if (!isMounted || !res || !res.size) return;
        setFileSizeBytes(res.size);
        const mb = res.size / (1024 * 1024);
        if (mb >= 1) {
          setFileSizeStr(`${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`);
        } else {
          setFileSizeStr(`${Math.max(1, Math.round(res.size / 1024))} KB`);
        }
      })
      .catch(() => {});

    const timer = setInterval(() => {
      setLoadingProgress((prev) => {
        if (prev >= 92) return prev;
        return prev + (prev < 60 ? 14 : 7);
      });
    }, 200);

    loadWorkbook();

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [filePath]);

  const loadWorkbook = async (password?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setPasswordError(null);

    try {
      const b64 = await engine.readFileBase64(filePath);
      if (cancelLoadingRef.current) return;

      const readOptions: XLSX.ParsingOptions = {
        type: 'base64',
        cellDates: true,
      };
      if (password) {
        readOptions.password = password;
      }

      const wb = XLSX.read(b64, readOptions);
      if (cancelLoadingRef.current) return;

      setWorkbook(wb);
      setSheetNames(wb.SheetNames || []);

      if (wb.SheetNames && wb.SheetNames.length > 0) {
        const firstSheet = wb.SheetNames[0];
        setActiveSheet(firstSheet);
        parseSheet(wb, firstSheet);
        setIsPasswordModalVisible(false);
      } else {
        setErrorMsg('Workbook contains no readable sheets.');
      }
    } catch (err: any) {
      if (cancelLoadingRef.current) return;
      const msg = err.message || String(err);
      if (
        msg.toLowerCase().includes('password') ||
        msg.toLowerCase().includes('encrypted') ||
        msg.toLowerCase().includes('ole')
      ) {
        setIsPasswordModalVisible(true);
        if (password) {
          setPasswordError('Incorrect password. Please try again.');
        }
      } else {
        setErrorMsg(`Failed to open workbook: ${msg}`);
      }
    } finally {
      if (!cancelLoadingRef.current) {
        setIsLoading(false);
      }
    }
  };

  const parseSheet = (wb: XLSX.WorkBook, sheetName: string) => {
    try {
      const ws = wb.Sheets[sheetName];
      if (!ws) {
        setHeaders([]);
        setDataRows([]);
        return;
      }

      const rawRows = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        defval: '',
      }) as string[][];

      if (rawRows.length === 0) {
        setHeaders(['A', 'B', 'C', 'D']);
        setDataRows([]);
        return;
      }

      const maxCols = Math.max(
        ...rawRows.slice(0, 100).map((r) => r.length),
        4
      );

      const generatedHeaders: string[] = [];
      const computedWidths: Record<number, number> = {};
      for (let i = 0; i < maxCols; i++) {
        const colLetter = getColumnLetter(i);
        generatedHeaders.push(colLetter);

        let maxLen = 4;
        for (let r = 0; r < Math.min(rawRows.length, 60); r++) {
          const val = String(rawRows[r]?.[i] || '');
          if (val.length > maxLen) maxLen = Math.min(val.length, 45);
        }
        computedWidths[i] = Math.max(85, Math.min(320, Math.round(maxLen * 8.5 + 24)));
      }

      setColWidths(computedWidths);
      setHeaders(generatedHeaders);
      setDataRows(rawRows);
    } catch (err: any) {
      setErrorMsg(`Failed to parse sheet "${sheetName}": ${err.message}`);
    }
  };

  const getColumnLetter = (colIndex: number): string => {
    let letter = '';
    let temp = colIndex;
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  };

  const handleSheetChange = (sheetName: string) => {
    if (workbook) {
      setActiveSheet(sheetName);
      parseSheet(workbook, sheetName);
    }
  };

  const handleShare = async () => {
    try {
      await engine.shareFile(
        filePath,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  const handleActionMenu = () => {
    Alert.alert(
      fileName,
      'Choose an action',
      [
        {
          text: isSearchOpen ? 'Hide Search' : 'Find in Sheet',
          onPress: () => setIsSearchOpen(!isSearchOpen),
        },
        {
          text: 'Share Spreadsheet',
          onPress: handleShare,
        },
        {
          text: 'Reset Zoom (100%)',
          onPress: () => setZoom(1.0),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  // Filter or highlight matching rows
  const queryLower = searchQuery.trim().toLowerCase();

  const totalGridWidth = indexWidth + headers.reduce((acc, _, i) => acc + getColWidth(i), 0);

  const handleHeaderTap = (colIdx: number) => {
    const now = Date.now();
    if (lastTapRef.current.colIdx === colIdx && now - lastTapRef.current.time < 350) {
      // Double Tap detected -> Auto-fit Column
      let maxLen = (headers[colIdx] || '').length;
      for (let r = 0; r < Math.min(dataRows.length, 150); r++) {
        const val = String(dataRows[r]?.[colIdx] || '');
        if (val.length > maxLen) maxLen = val.length;
      }
      const fitted = Math.min(380, Math.max(75, Math.round(maxLen * 8.5 + 28)));
      setColWidths((prev) => ({ ...prev, [colIdx]: fitted }));
      lastTapRef.current = { colIdx: -1, time: 0 };
      return;
    }
    lastTapRef.current = { colIdx, time: now };

    // Single Tap -> Sort Column
    let nextOrder: 'ASC' | 'DESC' = 'ASC';
    if (sortCol === colIdx) {
      nextOrder = sortOrder === 'ASC' ? 'DESC' : 'ASC';
    }
    setSortCol(colIdx);
    setSortOrder(nextOrder);

    const sorted = [...dataRows].sort((a, b) => {
      const valA = String(a[colIdx] || '');
      const valB = String(b[colIdx] || '');
      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB) && valA.trim() !== '' && valB.trim() !== '') {
        return nextOrder === 'ASC' ? numA - numB : numB - numA;
      }
      return nextOrder === 'ASC' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
    setDataRows(sorted);
  };

  const renderRow = ({ item, index }: { item: string[]; index: number }) => {
    const isRowMatched =
      queryLower.length > 0 &&
      item.some((cell) => String(cell).toLowerCase().includes(queryLower));

    return (
      <View
        style={[
          styles.tableRow,
          { height: rowHeight },
          index % 2 === 1 && styles.alternateRow,
          isRowMatched && styles.matchedRow,
        ]}>
        {/* Sticky Row Number */}
        <View style={[styles.indexCell, { width: indexWidth, height: rowHeight }]}>
          <Text style={[styles.indexCellText, { fontSize: headerFontSize }]}>
            {index + 1}
          </Text>
        </View>

        {/* Cells */}
        {headers.map((_, colIdx) => {
          const cellVal = item[colIdx] !== undefined ? String(item[colIdx]) : '';
          const currentWidth = getColWidth(colIdx);
          const isCellMatched =
            queryLower.length > 0 &&
            cellVal.toLowerCase().includes(queryLower);

          const isNumber = !isNaN(Number(cellVal)) && cellVal.trim() !== '';
          const isSelected =
            selectedCell?.row === index && selectedCell?.col === colIdx;

          return (
            <TouchableOpacity
              key={colIdx}
              activeOpacity={0.8}
              onPress={() => {
                const colLetter = headers[colIdx] || getColumnLetter(colIdx);
                const cellRef = XLSX.utils.encode_cell({ r: index, c: colIdx });
                const cellObj = workbook?.Sheets[activeSheet]?.[cellRef];
                const formulaDisplay = cellObj && cellObj.f ? `=${cellObj.f}` : cellVal;
                setSelectedCell({
                  row: index,
                  col: colIdx,
                  address: `${colLetter}${index + 1}`,
                  value: formulaDisplay,
                });
              }}
              style={[
                styles.dataCell,
                { width: currentWidth, height: rowHeight },
                isCellMatched && styles.matchedCell,
                isSelected && styles.selectedCell,
              ]}>
              <Text
                style={[
                  styles.cellText,
                  { fontSize },
                  isNumber && styles.numberCellText,
                  isCellMatched && styles.matchedCellText,
                  isSelected && styles.selectedCellText,
                ]}
                numberOfLines={1}>
                {cellVal}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />

      {/* Top App Header (Figma Blue #016EEF) */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerLeft}>
          <Text style={styles.title} numberOfLines={1}>
            {fileName}
          </Text>
          <Text style={styles.subtitle}>
            {isLoading || errorMsg
              ? `XLSX${fileSizeStr ? ` · ${fileSizeStr}` : ''}`
              : `XLSX${fileSizeStr ? ` · ${fileSizeStr}` : ''}${sheetNames.length > 0 ? ` · Sheet ${sheetIndexDisplay} of ${sheetNames.length}` : ''}`}
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.actionMenuBtn} onPress={handleActionMenu} activeOpacity={0.7}>
            <Text style={styles.actionMenuDots}>⋮</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Content Area */}
      {isLoading ? (
        /* FIGMA SCREEN 4: SPREADSHEET — LARGE SPREADSHEET OPENING */
        <View style={styles.loadingContainer}>
          {/* Card 1: 5-Column Skeleton Grid Card */}
          <View style={styles.skeletonCard}>
            {/* Header row pills */}
            <View style={styles.skeletonHeaderRow}>
              {[50, 64, 48, 58, 52].map((w, i) => (
                <View key={i} style={[styles.skeletonHeaderPill, { width: w }]} />
              ))}
            </View>
            {/* 5 data row pills */}
            {[0, 1, 2, 3, 4].map((rowIndex) => (
              <View key={rowIndex} style={styles.skeletonDataRow}>
                {[44, 58, 46, 52, 48].map((w, colIndex) => (
                  <View
                    key={colIndex}
                    style={[
                      styles.skeletonCellPill,
                      { width: colIndex === 0 ? 36 : w + ((rowIndex + colIndex) % 3) * 6 },
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>

          {/* Card 2: Loading Status Card */}
          <View style={styles.loadingProgressCard}>
            <Text style={styles.loadingTitle}>
              {fileSizeBytes > 2 * 1024 * 1024 ? 'Opening large spreadsheet...' : 'Opening spreadsheet...'}
            </Text>
            <Text style={styles.loadingSubtitle}>
              {dataRows.length > 0
                ? `Loaded ${dataRows.length.toLocaleString()} rows. You can leave and come back; nothing is lost.`
                : `Reading spreadsheet data${fileSizeStr ? ` (${fileSizeStr})` : ''}... You can leave and come back; nothing is lost.`}
            </Text>

            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${loadingProgress}%` }]} />
            </View>

            <TouchableOpacity
              style={styles.loadingCancelBtn}
              activeOpacity={0.8}
              onPress={() => {
                cancelLoadingRef.current = true;
                onClose();
              }}>
              <Text style={styles.loadingCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : errorMsg ? (
        /* FIGMA SCREEN 1/4: CANNOT DISPLAY SPREADSHEET ERROR STATE */
        <View style={styles.errorContainer}>
          <View style={styles.errorIconCircle}>
            <WarningTriangleIcon size={30} color="#EA580C" innerColor="#FFF7ED" />
          </View>
          <Text style={styles.errorHeading}>Some content can't be shown</Text>
          <Text style={styles.errorSubheading}>
            This spreadsheet uses features that aren't supported here. You can still share the original file.
          </Text>

          <TouchableOpacity
            style={styles.errorShareBtn}
            activeOpacity={0.8}
            onPress={handleShare}>
            <Text style={styles.errorShareBtnText}>Share file</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.errorBackBtn}
            activeOpacity={0.8}
            onPress={onClose}>
            <Text style={styles.errorBackBtnText}>Back to files</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* FIGMA SCREEN 3 & 5: SPREADSHEET VIEWER */
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          {/* Search Bar (Collapsible) */}
          {isSearchOpen && (
            <View style={styles.searchBar}>
              <Text style={styles.searchBarIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder="Search cells in this sheet..."
                placeholderTextColor="#94a3b8"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                clearButtonMode="while-editing"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => setSearchQuery('')}
                  style={styles.clearSearchBtn}>
                  <Text style={styles.clearSearchText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <ScrollView
            horizontal
            style={styles.horizontalScroll}
            contentContainerStyle={{ flexGrow: 1 }}
            showsHorizontalScrollIndicator={true}>
            <View style={{ width: Math.max(screenWidth, totalGridWidth), flex: 1 }}>
              {/* Sticky Header Row with Column Letters A, B, C, D */}
              <View style={[styles.headerRow, { height: rowHeight }]}>
                {/* Top-left empty corner */}
                <View
                  style={[
                    styles.cornerCell,
                    { width: indexWidth, height: rowHeight },
                  ]}>
                  <Text style={styles.cornerText}>#</Text>
                </View>

                {/* Column Letter Badges */}
                {headers.map((h, i) => (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.7}
                    onPress={() => handleHeaderTap(i)}
                    style={[
                      styles.headerCell,
                      { width: getColWidth(i), height: rowHeight },
                      sortCol === i && styles.headerCellSorted,
                    ]}>
                    <View style={styles.headerCellContent}>
                      <Text
                        style={[styles.headerCellText, { fontSize: headerFontSize }]}
                        numberOfLines={1}>
                        {h}
                      </Text>
                      {sortCol === i && (
                        <Text style={styles.sortArrow}>{sortOrder === 'ASC' ? '▲' : '▼'}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Virtualized Rows List */}
              <FlatList
                data={dataRows}
                keyExtractor={(_, index) => `row-${index}`}
                renderItem={renderRow}
                initialNumToRender={35}
                maxToRenderPerBatch={30}
                windowSize={11}
                removeClippedSubviews={true}
                getItemLayout={(_, index) => ({
                  length: rowHeight,
                  offset: rowHeight * index,
                  index,
                })}
              />
            </View>
          </ScrollView>

          {/* Figma Screen 3 & 5: Floating Deep Navy Pill (#0D084C) */}
          {selectedCell && (
            <View style={styles.floatingNavyPillContainer} pointerEvents="box-none">
              <View style={styles.floatingNavyPill}>
                <Text style={styles.floatingPillAddress}>{selectedCell.address}</Text>
                <Text style={styles.floatingPillValue}>{selectedCell.value}</Text>
              </View>
            </View>
          )}

          {/* Figma Screen 5: Format Notice Banner */}
          <View style={styles.figmaNoticeBanner}>
            <InfoCircleIcon size={14} color="#016EEF" />
            <Text style={styles.figmaNoticeText}>
              Charts and macros aren't shown. Cell values are.
            </Text>
          </View>

          {/* Figma Screen 3 & 5: Bottom Sheet Tabs (Summary, Q1, Q2, Forecast) */}
          {sheetNames.length > 0 && (
            <View style={styles.bottomSheetTabsBar}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.bottomSheetTabsScroll}>
                {sheetNames.map((name) => (
                  <TouchableOpacity
                    key={name}
                    style={[
                      styles.bottomSheetPill,
                      activeSheet === name && styles.bottomSheetPillActive,
                    ]}
                    onPress={() => handleSheetChange(name)}
                    activeOpacity={0.7}>
                    <Text
                      style={[
                        styles.bottomSheetPillText,
                        activeSheet === name && styles.bottomSheetPillTextActive,
                      ]}>
                      {name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* Password Modal */}
      <PasswordModal
        visible={isPasswordModalVisible}
        fileName={fileName}
        errorMsg={passwordError}
        isLoading={isLoading}
        onUnlock={(pwd) => loadWorkbook(pwd)}
        onCancel={() => {
          setIsPasswordModalVisible(false);
          onClose();
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#016EEF',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  backBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerLeft: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 2,
    fontWeight: '500',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareBtn: {
    backgroundColor: '#016EEF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  shareBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  searchToggleBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  searchIcon: {
    fontSize: 14,
    color: '#ffffff',
  },
  closeBtn: {
    backgroundColor: '#016EEF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  closeBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#cbd5e1',
  },
  searchBarIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    paddingVertical: 2,
  },
  clearSearchBtn: {
    padding: 4,
  },
  clearSearchText: {
    fontSize: 14,
    color: '#64748b',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 12,
  },
  zoomGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  zoomBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  zoomBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#016EEF',
  },
  zoomLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    paddingHorizontal: 6,
  },
  sheetTabsScroll: {
    flexDirection: 'row',
    gap: 6,
  },
  sheetTab: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#e2e8f0',
  },
  sheetTabActive: {
    backgroundColor: '#016EEF',
  },
  sheetTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  sheetTabTextActive: {
    color: '#ffffff',
  },
  horizontalScroll: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1.5,
    borderBottomColor: '#94a3b8',
  },
  cornerCell: {
    backgroundColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#cbd5e1',
  },
  cornerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  headerCell: {
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#cbd5e1',
    paddingHorizontal: 4,
  },
  headerCellText: {
    fontWeight: '700',
    color: '#334155',
  },
  tableRow: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  alternateRow: {
    backgroundColor: '#f8fafc',
  },
  matchedRow: {
    backgroundColor: '#fef9c3',
  },
  indexCell: {
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#cbd5e1',
  },
  indexCellText: {
    color: '#64748b',
    fontWeight: '600',
  },
  formulaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#d1d5db',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  cellAddressBox: {
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#d1d5db',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 42,
    alignItems: 'center',
  },
  cellAddressText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#016EEF',
  },
  fxSymbol: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6b7280',
    fontStyle: 'italic',
  },
  formulaInputBox: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  formulaText: {
    fontSize: 12,
    color: '#111827',
  },
  selectedCell: {
    borderWidth: 2,
    borderColor: '#016EEF',
    backgroundColor: '#EFF6FF',
    zIndex: 2,
  },
  selectedCellText: {
    color: '#016EEF',
    fontWeight: '700',
  },
  dataCell: {
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
  },
  matchedCell: {
    backgroundColor: '#fef08a',
  },
  cellText: {
    color: '#0f172a',
  },
  numberCellText: {
    textAlign: 'right',
  },
  matchedCellText: {
    fontWeight: '700',
    color: '#854d0e',
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#475569',
    fontWeight: '500',
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    maxWidth: 320,
  },
  errorIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#b91c1c',
    marginBottom: 6,
  },
  errorDesc: {
    fontSize: 12,
    color: '#7f1d1d',
    textAlign: 'center',
    lineHeight: 18,
  },
  headerCellContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  headerCellSorted: {
    backgroundColor: '#016EEF',
  },
  sortArrow: {
    fontSize: 9,
    color: '#ffffff',
  },
  floatingNavyPillContainer: {
    position: 'absolute',
    bottom: 84,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 99,
  },
  floatingNavyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0D084C',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    gap: 12,
  },
  floatingPillAddress: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  floatingPillValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  figmaNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderTopWidth: 1,
    borderTopColor: '#DBEAFE',
    paddingHorizontal: 16,
    paddingVertical: 9,
    gap: 8,
  },
  figmaNoticeIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  figmaNoticeText: {
    fontSize: 12.5,
    color: '#1E40AF',
    fontWeight: '500',
    flex: 1,
  },
  bottomSheetTabsBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingVertical: 8,
  },
  bottomSheetTabsScroll: {
    paddingHorizontal: 12,
    gap: 8,
  },
  bottomSheetPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  bottomSheetPillActive: {
    backgroundColor: '#016EEF',
  },
  bottomSheetPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  bottomSheetPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  actionMenuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionMenuDots: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 20,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 16,
  },
  skeletonCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  skeletonHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  skeletonHeaderPill: {
    height: 14,
    backgroundColor: '#CBD5E1',
    borderRadius: 7,
  },
  skeletonDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  skeletonCellPill: {
    height: 12,
    backgroundColor: '#E2E8F0',
    borderRadius: 6,
  },
  loadingProgressCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  loadingTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  loadingSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 6,
  },
  progressBarTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    marginTop: 14,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    backgroundColor: '#016EEF',
    borderRadius: 3,
  },
  loadingCancelBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#016EEF',
    borderRadius: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingCancelBtnText: {
    color: '#016EEF',
    fontSize: 14,
    fontWeight: '700',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  errorHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSubheading: {
    fontSize: 13.5,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
    maxWidth: 280,
  },
  errorShareBtn: {
    backgroundColor: '#016EEF',
    height: 48,
    borderRadius: 12,
    width: '100%',
    maxWidth: 280,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorShareBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBackBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#016EEF',
    height: 48,
    borderRadius: 12,
    width: '100%',
    maxWidth: 280,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  errorBackBtnText: {
    color: '#016EEF',
    fontSize: 15,
    fontWeight: '700',
  },
});

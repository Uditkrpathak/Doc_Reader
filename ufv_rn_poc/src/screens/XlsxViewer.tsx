import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  TextInput,
} from 'react-native';
import * as XLSX from 'xlsx';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { PasswordModal } from '../components/PasswordModal';

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

  // Zoom scale: 0.7 (70%), 1.0 (100%), 1.25 (125%), 1.5 (150%)
  const [zoom, setZoom] = useState<number>(1.0);

  // Search in sheet
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Cell & Formula Bar
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
  const BASE_COL_WIDTH = 110;
  const BASE_ROW_HEIGHT = 38;
  const BASE_INDEX_WIDTH = 48;

  const colWidth = Math.round(BASE_COL_WIDTH * zoom);
  const rowHeight = Math.round(BASE_ROW_HEIGHT * zoom);
  const indexWidth = Math.round(BASE_INDEX_WIDTH * zoom);
  const fontSize = Math.max(10, Math.round(13 * zoom));
  const headerFontSize = Math.max(10, Math.round(12 * zoom));

  const getColWidth = (colIdx: number) => {
    return colWidths[colIdx] ? Math.round(colWidths[colIdx] * zoom) : colWidth;
  };

  useEffect(() => {
    loadWorkbook();
  }, [filePath]);

  const loadWorkbook = async (password?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    setPasswordError(null);

    try {
      const b64 = await engine.readFileBase64(filePath);
      const readOptions: XLSX.ParsingOptions = {
        type: 'base64',
        cellDates: true,
      };
      if (password) {
        readOptions.password = password;
      }

      const wb = XLSX.read(b64, readOptions);

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
      setIsLoading(false);
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
      for (let i = 0; i < maxCols; i++) {
        const colLetter = getColumnLetter(i);
        generatedHeaders.push(colLetter);
      }

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

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(2.0, +(prev + 0.2).toFixed(1)));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(0.6, +(prev - 0.2).toFixed(1)));
  };

  const handleResetZoom = () => {
    setZoom(1.0);
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
      <StatusBar barStyle="light-content" backgroundColor="#107c41" />

      {/* Top App Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title} numberOfLines={1}>
            📊 {fileName}
          </Text>
          <Text style={styles.subtitle}>
            {dataRows.length.toLocaleString()} rows • {headers.length} columns
          </Text>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
            <Text style={styles.shareBtnText}>📤 Share</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.searchToggleBtn}
            onPress={() => setIsSearchOpen(!isSearchOpen)}>
            <Text style={styles.searchIcon}>{isSearchOpen ? '✕' : '🔍'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>
      </View>

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

      {/* Excel Toolbar: Zoom & Sheets */}
      <View style={styles.toolbar}>
        {/* Zoom Controls */}
        <View style={styles.zoomGroup}>
          <TouchableOpacity
            style={styles.zoomBtn}
            onPress={handleZoomOut}
            disabled={zoom <= 0.6}>
            <Text style={styles.zoomBtnText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleResetZoom}>
            <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.zoomBtn}
            onPress={handleZoomIn}
            disabled={zoom >= 2.0}>
            <Text style={styles.zoomBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        {/* Sheet Selector Tabs */}
        {sheetNames.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sheetTabsScroll}>
            {sheetNames.map((name) => (
              <TouchableOpacity
                key={name}
                style={[
                  styles.sheetTab,
                  activeSheet === name && styles.sheetTabActive,
                ]}
                onPress={() => handleSheetChange(name)}>
                <Text
                  style={[
                    styles.sheetTabText,
                    activeSheet === name && styles.sheetTabTextActive,
                  ]}>
                  {name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Excel Cell Formula Bar */}
      <View style={styles.formulaBar}>
        <View style={styles.cellAddressBox}>
          <Text style={styles.cellAddressText}>
            {selectedCell ? selectedCell.address : 'A1'}
          </Text>
        </View>
        <Text style={styles.fxSymbol}>fx</Text>
        <View style={styles.formulaInputBox}>
          <Text style={styles.formulaText} numberOfLines={1}>
            {selectedCell ? selectedCell.value : dataRows[0]?.[0] || '(Tap any cell to inspect value)'}
          </Text>
        </View>
      </View>

      {/* Main Grid Content */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#107c41" />
          <Text style={styles.loadingText}>Opening Excel Workbook...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.centerBox}>
          <View style={styles.errorCard}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>Error Opening File</Text>
            <Text style={styles.errorDesc}>{errorMsg}</Text>
          </View>
        </View>
      ) : (
        <ScrollView horizontal style={styles.horizontalScroll}>
          <View style={{ width: totalGridWidth }}>
            {/* Sticky Header Row with Column Letters */}
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
    backgroundColor: '#107c41',
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    fontSize: 11,
    color: '#e2f0d9',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareBtn: {
    backgroundColor: '#056230',
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
    backgroundColor: '#0d6535',
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
    color: '#107c41',
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
    backgroundColor: '#107c41',
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
    color: '#107c41',
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
    borderColor: '#107c41',
    backgroundColor: '#ecfdf5',
    zIndex: 2,
  },
  selectedCellText: {
    color: '#065f46',
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
    backgroundColor: '#0c5c30',
  },
  sortArrow: {
    fontSize: 9,
    color: '#ffffff',
  },
});

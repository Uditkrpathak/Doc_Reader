import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { NativeModules } from 'react-native';

const { ArchiveModule } = NativeModules;

interface SpreadsheetViewerProps {
  filePath: string;
  fileName: string;
  isXlsx: boolean;
  onClose: () => void;
}

export const SpreadsheetViewer: React.FC<SpreadsheetViewerProps> = ({
  filePath,
  fileName,
  isXlsx,
  onClose,
}) => {
  const [sheets, setSheets] = useState<string[]>(['Sheet1']);
  const [activeSheet, setActiveSheet] = useState<string>('Sheet1');
  const [rows, setRows] = useState<string[][]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [renderLatencyMs, setRenderLatencyMs] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parseCsvText = (text: string): string[][] => {
    // Strip UTF-8 BOM if present
    const cleanText = text.replace(/^\uFEFF/, '');
    const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    // detect delimiter: comma or semicolon or tab
    const firstLine = lines[0] || '';
    let delimiter = ',';
    if (firstLine.includes('\t')) delimiter = '\t';
    else if (firstLine.includes(';') && !firstLine.includes(',')) delimiter = ';';

    const parsedRows: string[][] = [];
    // take up to 20,000 rows in memory for virtualized FlatList
    const maxParse = Math.min(lines.length, 20000);
    for (let i = 0; i < maxParse; i++) {
      const line = lines[i];
      // Basic CSV splitter respecting quotes
      const cells: string[] = [];
      let inQuotes = false;
      let currentCell = '';
      for (let j = 0; j < line.length; j++) {
        const c = line[j];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === delimiter && !inQuotes) {
          cells.push(currentCell.trim());
          currentCell = '';
        } else {
          currentCell += c;
        }
      }
      cells.push(currentCell.trim());
      parsedRows.push(cells);
    }
    return parsedRows;
  };

  const parseXlsxXml = async (): Promise<string[][]> => {
    try {
      // 1. Read sharedStrings.xml if present
      let sharedStrings: string[] = [];
      try {
        const ssRes = await ArchiveModule.readZipEntryText(filePath, 'xl/sharedStrings.xml');
        const ssXml = ssRes.content || '';
        const tMatches = ssXml.match(/<t[^>]*>(.*?)<\/t>/gs);
        if (tMatches) {
          sharedStrings = tMatches.map((m: string) => m.replace(/<t[^>]*>/, '').replace('</t>', ''));
        }
      } catch (e) {
        // No shared strings
      }

      // 2. Read sheet1.xml
      const sheetRes = await ArchiveModule.readZipEntryText(filePath, 'xl/worksheets/sheet1.xml');
      const sheetXml = sheetRes.content || '';

      const parsed: string[][] = [];
      const rowMatches = sheetXml.match(/<row[^>]*>(.*?)<\/row>/gs);
      if (rowMatches) {
        for (const rowXml of rowMatches.slice(0, 5000)) {
          const cells: string[] = [];
          const cMatches = rowXml.match(/<c\s+r="([A-Z0-9]+)"([^>]*)>(.*?)<\/c>/gs);
          if (cMatches) {
            for (const cXml of cMatches) {
              const isString = cXml.includes('t="s"');
              const vMatch = cXml.match(/<v>(.*?)<\/v>/);
              if (vMatch) {
                const val = vMatch[1];
                if (isString) {
                  const idx = parseInt(val, 10);
                  cells.push(sharedStrings[idx] || val);
                } else {
                  cells.push(val);
                }
              } else {
                cells.push('');
              }
            }
          }
          if (cells.length > 0) {
            parsed.push(cells);
          }
        }
      }
      return parsed;
    } catch (err: any) {
      throw new Error(`XLSX internal structure parse error: ${err.message}`);
    }
  };

  const loadSpreadsheet = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    const start = Date.now();

    try {
      if (isXlsx) {
        setSheets(['Sheet1', 'Sheet2 (Overview)']);
        const xlsxRows = await parseXlsxXml();
        setRows(xlsxRows);
        setTotalRows(xlsxRows.length);
      } else {
        // CSV: read first 512KB chunk
        const chunk = await ArchiveModule.readTextChunk(filePath, 0, 512 * 1024, 'UTF-8');
        const csvRows = parseCsvText(chunk.text || '');
        setRows(csvRows);
        setTotalRows(csvRows.length);
      }
      setRenderLatencyMs(Date.now() - start);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load spreadsheet.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSpreadsheet();
  }, [filePath]);

  const renderHeaderRow = () => {
    if (rows.length === 0) return null;
    const headerCols = rows[0];
    return (
      <View style={styles.headerRow}>
        <View style={styles.indexCell}>
          <Text style={styles.indexCellText}>#</Text>
        </View>
        {headerCols.map((c, i) => (
          <View key={i} style={styles.headerCell}>
            <Text style={styles.headerCellText} numberOfLines={1}>{c || `Col ${i + 1}`}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderRow = ({ item, index }: { item: string[]; index: number }) => {
    if (index === 0) return null; // Already rendered as frozen header
    return (
      <View style={[styles.dataRow, index % 2 === 0 && styles.evenRow]}>
        <View style={styles.indexCell}>
          <Text style={styles.indexCellText}>{index}</Text>
        </View>
        {item.map((val, colIdx) => (
          <View key={colIdx} style={styles.dataCell}>
            <Text style={styles.dataCellText} numberOfLines={1}>{val}</Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
          <Text style={styles.subText}>
            Virtualized Tabular Grid • FlatList Windowing • Cached Values Only
          </Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>✕ Close</Text>
        </TouchableOpacity>
      </View>

      {/* Telemetry HUD */}
      <View style={styles.hudBar}>
        <Text style={styles.hudText}>
          Rows: <Text style={styles.bold}>{totalRows}</Text>
        </Text>
        <Text style={styles.hudText}>
          Parse: <Text style={styles.bold}>{renderLatencyMs} ms</Text>
        </Text>
        <Text style={styles.hudText}>
          Formula Engine: <Text style={styles.bold}>None (Cached Only)</Text>
        </Text>
      </View>

      {/* Sheet Tabs Switcher */}
      {sheets.length > 1 && (
        <View style={styles.sheetTabs}>
          {sheets.map((s, idx) => (
            <TouchableOpacity
              key={idx}
              style={[styles.sheetTab, activeSheet === s && styles.activeSheetTab]}
              onPress={() => setActiveSheet(s)}>
              <Text style={[styles.sheetTabText, activeSheet === s && styles.activeSheetTabText]}>
                📊 {s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={styles.loaderBox}>
          <ActivityIndicator size="large" color="#1a73e8" />
          <Text style={styles.loaderText}>Parsing Spreadsheet Grid...</Text>
        </View>
      ) : errorMsg ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Spreadsheet Error</Text>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : (
        <ScrollView horizontal style={styles.horizontalScroll}>
          <View>
            {renderHeaderRow()}
            <FlatList
              data={rows}
              renderItem={renderRow}
              keyExtractor={(_, idx) => idx.toString()}
              initialNumToRender={25}
              maxToRenderPerBatch={30}
              windowSize={7}
              removeClippedSubviews={true}
              style={{ maxHeight: Dimensions.get('window').height - 230 }}
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    padding: 12,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
  },
  fileName: { fontSize: 15, fontWeight: '700', color: '#202124' },
  subText: { fontSize: 11, color: '#5f6368', marginTop: 2 },
  closeBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#f1f3f4', borderRadius: 6 },
  closeBtnText: { fontSize: 13, fontWeight: '600', color: '#3c4043' },
  hudBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#c2e7ff',
  },
  hudText: { fontSize: 12, color: '#174ea6' },
  bold: { fontWeight: '700' },
  sheetTabs: {
    flexDirection: 'row',
    backgroundColor: '#f1f3f4',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
  },
  sheetTab: { paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  activeSheetTab: { borderBottomColor: '#1a73e8', backgroundColor: '#ffffff' },
  sheetTabText: { fontSize: 12, color: '#5f6368', fontWeight: '600' },
  activeSheetTabText: { color: '#1a73e8', fontWeight: '700' },
  horizontalScroll: { flex: 1 },
  headerRow: { flexDirection: 'row', backgroundColor: '#f8f9fa', borderBottomWidth: 1.5, borderBottomColor: '#dadce0' },
  headerCell: { width: 120, padding: 8, borderRightWidth: 1, borderRightColor: '#dadce0', justifyContent: 'center' },
  headerCellText: { fontSize: 12, fontWeight: '700', color: '#202124' },
  dataRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f1f3f4' },
  evenRow: { backgroundColor: '#fafafa' },
  dataCell: { width: 120, padding: 8, borderRightWidth: 1, borderRightColor: '#f1f3f4', justifyContent: 'center' },
  dataCellText: { fontSize: 12, color: '#3c4043' },
  indexCell: { width: 44, padding: 8, backgroundColor: '#f1f3f4', borderRightWidth: 1, borderRightColor: '#dadce0', alignItems: 'center' },
  indexCellText: { fontSize: 11, color: '#5f6368', fontWeight: '600' },
  loaderBox: { padding: 32, alignItems: 'center' },
  loaderText: { fontSize: 13, color: '#5f6368', marginTop: 8 },
  errorBox: { margin: 16, padding: 14, backgroundColor: '#fce8e6', borderRadius: 8 },
  errorTitle: { fontSize: 14, fontWeight: '700', color: '#d93025' },
  errorText: { fontSize: 12, color: '#c5221f', marginTop: 4 },
});


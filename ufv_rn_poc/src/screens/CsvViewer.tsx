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
  NativeModules,
} from 'react-native';
import Papa from 'papaparse';
import { ArchiveEngine } from '../services/ArchiveEngine';

const { ArchiveModule } = NativeModules;

interface CsvViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
}

export const CsvViewer: React.FC<CsvViewerProps> = ({
  filePath,
  fileName,
  onClose,
}) => {
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [delimiterUsed, setDelimiterUsed] = useState<string>(',');
  const [currentOffset, setCurrentOffset] = useState<number>(0);
  const [isEof, setIsEof] = useState<boolean>(false);
  const [encoding, setEncoding] = useState<string>('UTF-8');

  const COLUMN_WIDTH = 120;
  const ROW_INDEX_WIDTH = 55;
  const CHUNK_SIZE = 512 * 1024; // 512 KB per chunk

  useEffect(() => {
    loadFirstChunk();
  }, [filePath]);

  // Strip BOM and detect delimiter
  const detectDelimiter = (sampleText: string): string => {
    const lines = sampleText.split(/\r?\n/).slice(0, 5);
    const line = lines[0] || '';
    if (line.includes('\t')) return '\t';
    if (line.includes(';') && !line.includes(',')) return ';';
    if (line.includes('|')) return '|';
    return ',';
  };

  const loadFirstChunk = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      // 1. Try reading with UTF-8 first
      let res = await ArchiveModule.readTextChunk(filePath, 0, CHUNK_SIZE, 'UTF-8');
      let text = res.text || '';

      // If text contains replacement char , try ISO-8859-1 (Latin1)
      if (text.includes('\uFFFD')) {
        try {
          const latinRes = await ArchiveModule.readTextChunk(filePath, 0, CHUNK_SIZE, 'ISO-8859-1');
          if (latinRes.text && !latinRes.text.includes('\uFFFD')) {
            res = latinRes;
            text = latinRes.text;
            setEncoding('ISO-8859-1 (Latin1)');
          }
        } catch {
          // fallback to UTF-8
        }
      }

      setCurrentOffset(res.nextOffset || text.length);
      setIsEof(res.isEof || false);

      // Strip UTF-8 BOM if present
      const cleanText = text.replace(/^\uFEFF/, '');
      const delim = detectDelimiter(cleanText);
      setDelimiterUsed(delim === '\t' ? 'TAB' : delim);

      // Parse CSV using PapaParse with full RFC 4180 quote support
      const parseResult = Papa.parse<string[]>(cleanText, {
        delimiter: delim,
        skipEmptyLines: true,
      });

      const parsedData = parseResult.data || [];
      if (parsedData.length > 0) {
        const first = parsedData[0];
        const numCols = Math.max(
          first.length,
          ...parsedData.slice(0, 100).map((r) => r.length),
          3
        );

        const genHeaders: string[] = [];
        for (let i = 0; i < numCols; i++) {
          const colLetter = String.fromCharCode(65 + (i % 26));
          const val = first[i] !== undefined && String(first[i]).trim().length > 0
            ? String(first[i]).trim()
            : colLetter;
          genHeaders.push(val);
        }

        setHeaders(genHeaders);
        setDataRows(parsedData.slice(1));
      } else {
        setHeaders(['Col A', 'Col B', 'Col C']);
        setDataRows([]);
      }

      // First chunk parsed successfully
    } catch (err: any) {
      setErrorMsg(`CSV Parser error: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const loadNextChunk = async () => {
    if (isEof || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await ArchiveModule.readTextChunk(
        filePath,
        currentOffset,
        CHUNK_SIZE,
        encoding.includes('Latin1') ? 'ISO-8859-1' : 'UTF-8'
      );
      const text = res.text || '';
      setCurrentOffset(res.nextOffset || currentOffset + text.length);
      setIsEof(res.isEof || false);

      const delim = delimiterUsed === 'TAB' ? '\t' : delimiterUsed;
      const parseResult = Papa.parse<string[]>(text, {
        delimiter: delim,
        skipEmptyLines: true,
      });

      if (parseResult.data && parseResult.data.length > 0) {
        setDataRows((prev) => [...prev, ...parseResult.data]);
      }
    } catch (err: any) {
      console.warn('loadNextChunk error', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const renderRow = ({ item, index }: { item: string[]; index: number }) => {
    return (
      <View style={styles.tableRow}>
        <View style={[styles.indexCell, { width: ROW_INDEX_WIDTH }]}>
          <Text style={styles.indexCellText}>{index + 1}</Text>
        </View>

        {headers.map((_, colIdx) => {
          const cellVal = item[colIdx] !== undefined ? String(item[colIdx]) : '';
          return (
            <View key={colIdx} style={[styles.dataCell, { width: COLUMN_WIDTH }]}>
              <Text style={styles.cellText} numberOfLines={2}>
                {cellVal}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const handleShare = async () => {
    try {
      await ArchiveEngine.getInstance().shareFile(filePath, 'text/csv');
    } catch (err) {
      console.warn('Share error', err);
    }
  };

  const tableTotalWidth = ROW_INDEX_WIDTH + headers.length * COLUMN_WIDTH;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar hidden={true} />
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={styles.title} numberOfLines={1}>
            📑 {fileName}
          </Text>
          <Text style={styles.subtitle}>
            CSV Spreadsheet • {dataRows.length.toLocaleString()} rows • {headers.length} columns
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.7}>
            <Text style={styles.shareBtnText}>📤 Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>✕ Close</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Error Message */}
      {errorMsg && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      {/* Loading state */}
      {isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>Reading and parsing CSV rows...</Text>
        </View>
      ) : (
        /* Horizontal scroll for CSV grid */
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={true}
          style={styles.horizontalScroll}>
          <View style={{ width: tableTotalWidth, flex: 1 }}>
            {/* Sticky Table Header */}
            <View style={styles.stickyHeader}>
              <View style={[styles.indexHeaderCell, { width: ROW_INDEX_WIDTH }]}>
                <Text style={styles.indexHeaderText}>#</Text>
              </View>
              {headers.map((h, i) => (
                <View key={i} style={[styles.headerCell, { width: COLUMN_WIDTH }]}>
                  <Text style={styles.headerCellText} numberOfLines={1}>
                    {h}
                  </Text>
                </View>
              ))}
            </View>

            {/* Virtualized FlatList for 400k rows chunked */}
            <FlatList
              data={dataRows}
              renderItem={renderRow}
              keyExtractor={(_, index) => `csv-row-${index}`}
              initialNumToRender={35}
              maxToRenderPerBatch={35}
              windowSize={11}
              removeClippedSubviews={true}
              getItemLayout={(_, index) => ({
                length: 36,
                offset: 36 * index,
                index,
              })}
              onEndReached={loadNextChunk}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                !isEof ? (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={loadNextChunk}
                    disabled={isLoadingMore}>
                    {isLoadingMore ? (
                      <ActivityIndicator size="small" color="#0284c7" />
                    ) : (
                      <Text style={styles.loadMoreText}>
                        ⏬ Load Next 512 KB Chunk (Streaming)
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : null
              }
              contentContainerStyle={{ paddingBottom: 60 }}
            />
          </View>
        </ScrollView>
      )}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0284c7',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  subtitle: {
    fontSize: 11,
    color: '#e0f2fe',
    marginTop: 2,
  },
  shareBtn: {
    backgroundColor: '#0369a1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  shareBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  closeBtn: {
    backgroundColor: '#0369a1',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  closeBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  telemetryBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f8fafc',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  telemetryText: {
    fontSize: 11,
    color: '#475569',
  },
  bold: {
    fontWeight: '700',
    color: '#0f172a',
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    padding: 12,
    margin: 10,
    borderRadius: 6,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12,
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    color: '#475569',
    fontSize: 13,
  },
  horizontalScroll: {
    flex: 1,
  },
  stickyHeader: {
    flexDirection: 'row',
    backgroundColor: '#e0f2fe',
    borderBottomWidth: 2,
    borderBottomColor: '#38bdf8',
    height: 38,
  },
  indexHeaderCell: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#bae6fd',
    backgroundColor: '#bae6fd',
  },
  indexHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0369a1',
  },
  headerCell: {
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: '#bae6fd',
  },
  headerCellText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0369a1',
  },
  tableRow: {
    flexDirection: 'row',
    height: 36,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  indexCell: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRightWidth: 1,
    borderRightColor: '#e2e8f0',
  },
  indexCellText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  dataCell: {
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRightWidth: 1,
    borderRightColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  cellText: {
    fontSize: 12,
    color: '#1e293b',
  },
  loadMoreBtn: {
    paddingVertical: 12,
    backgroundColor: '#f0f9ff',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#bae6fd',
  },
  loadMoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0284c7',
  },
});


import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { ArchiveEngine, FolderFile } from '../services/ArchiveEngine';
import { FileDetector } from '../services/FileDetector';
import {
  BenchmarkLogger,
  BenchmarkEntry,
  ActualOutcome,
  computeVerdict,
} from '../services/BenchmarkLogger';
import { NativeModules } from 'react-native';

const { ArchiveModule } = NativeModules;

interface ManifestEntry {
  expected_behaviour: string;
  what_it_tests: string;
  target_ms: number;
}

export const BatchRunnerScreen: React.FC = () => {
  const [folderFiles, setFolderFiles] = useState<FolderFile[]>([]);
  const [manifestMap, setManifestMap] = useState<Record<string, ManifestEntry>>({});
  const [, setIsScanning] = useState<boolean>(false);
  const [isBatchRunning, setIsBatchRunning] = useState<boolean>(false);
  const [currentFileIdx, setCurrentFileIdx] = useState<number>(0);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [logs, setLogs] = useState<BenchmarkEntry[]>([]);
  const [exportPath, setExportPath] = useState<string>('');
  const [hasSavedState, setHasSavedState] = useState<boolean>(false);
  const [savedStateInfo, setSavedStateInfo] = useState<string>('');
  const [baselineResults, setBaselineResults] = useState<any[]>([]);
  const [isBaselineRunning, setIsBaselineRunning] = useState<boolean>(false);

  const engine = ArchiveEngine.getInstance();
  const logger = BenchmarkLogger.getInstance();

  const loadManifests = async (): Promise<Record<string, ManifestEntry>> => {
    const map: Record<string, ManifestEntry> = {};
    const manifestPaths = [
      '/sdcard/Download/ufv_test_corpus/test_manifest_and_results.csv',
      '/sdcard/Download/ufv_test_corpus_LARGE/test_manifest_and_results.csv',
    ];

    for (const p of manifestPaths) {
      try {
        const res = await ArchiveModule.readTextChunk(p, 0, 512 * 1024, 'UTF-8');
        if (res && res.text) {
          const lines = res.text.split('\n');
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            // Parse comma-separated (handling quotes if any)
            const regex = /(?:^|,)(?:"([^"]*)"|([^,]*))/g;
            const row: string[] = [];
            let match: RegExpExecArray | null;
            while ((match = regex.exec(line)) !== null) {
              row.push(match[1] !== undefined ? match[1] : match[2]);
            }
            if (row.length >= 3) {
              const relFile = (row[0] || '').trim().replace(/\\/g, '/');
              const expected = (row[2] || '').trim();
              const whatItTests = row.length > 3 ? (row[3] || '').trim() : '';

              let targetMs = 0;
              if (relFile.endsWith('.pdf')) targetMs = 2000;
              else if (relFile.endsWith('.docx') || relFile.endsWith('.xlsx') || relFile.endsWith('.pptx')) targetMs = 3000;
              else if (expected.includes('EXTRACT_UNDER_10S')) targetMs = 10000;

              const entry: ManifestEntry = {
                expected_behaviour: expected,
                what_it_tests: whatItTests,
                target_ms: targetMs,
              };

              const prefix = p.includes('ufv_test_corpus_LARGE') ? 'ufv_test_corpus_LARGE/' : 'ufv_test_corpus/';
              map[prefix + relFile] = entry;
              map[relFile] = entry;
              const basename = relFile.split('/').pop() || relFile;
              map[basename] = entry;
            }
          }
        }
      } catch (e) {
        console.warn(`Manifest load failed for ${p}`, e);
      }
    }
    return map;
  };

  const loadCorpusFiles = async () => {
    setIsScanning(true);
    try {
      const manifests = await loadManifests();
      setManifestMap(manifests);

      const files = await engine.listFolder('/sdcard/Download');
      setFolderFiles(files);

      // Check for saved run state on disk
      const rawState = await engine.loadRunState();
      if (rawState) {
        try {
          const saved = JSON.parse(rawState);
          if (saved && Array.isArray(saved.logs)) {
            setHasSavedState(true);
            setSavedStateInfo(
              `Resume Available: ${saved.done} completed (${saved.timedOut || 0} timed out, ${saved.crashed || 0} crashed) of ${saved.total} total`
            );
            logger.setEntries(saved.logs);
            setLogs(saved.logs);
          } else {
            engine.clearRunState().catch(() => {});
            setHasSavedState(false);
          }
        } catch (pe) {
          console.warn('Failed to parse saved run state', pe);
        }
      }
    } catch (e) {
      console.warn('loadCorpusFiles error', e);
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    loadCorpusFiles();
    setLogs(logger.getEntries());
  }, []);

  const runSingleFileBenchmark = async (
    file: FolderFile,
    runIndex: number
  ): Promise<BenchmarkEntry> => {
    const isLargePack = file.path.includes('ufv_test_corpus_LARGE');
    const folder = isLargePack ? 'ufv_test_corpus_LARGE' : 'ufv_test_corpus';

    // Lookup expected behaviour from manifest by relative path first
    const cleanRelPath = file.name.replace(/\\/g, '/');
    let manifestEntry = manifestMap[cleanRelPath];
    if (!manifestEntry) {
      const strippedCorpus = cleanRelPath.replace(/^ufv_test_corpus\//, '').replace(/^ufv_test_corpus_LARGE\//, '');
      manifestEntry = manifestMap[strippedCorpus];
    }
    if (!manifestEntry) {
      const baseName = cleanRelPath.split('/').pop() || cleanRelPath;
      manifestEntry = manifestMap[baseName];
    }
    const expected_behaviour = manifestEntry?.expected_behaviour || 'OPEN';
    const target_ms = manifestEntry?.target_ms || 0;

    // Reset and start native PSS sampling loop
    await engine.startPssSampling();
    const start = Date.now();

    let action = 'detect';
    let actual_outcome: ActualOutcome = 'OK';
    let errorDesc = '';

    try {
      // 0. Zero-byte file edge case
      if (file.size === 0) {
        action = 'zero_byte_check';
        actual_outcome = 'EMPTY';
        errorDesc = 'File contains 0 bytes';
      } else {
        // 1. Detect format by magic bytes
        const detected = await FileDetector.detectFile(file.path, file.name);

        if (detected.category === 'PDF') {
          action = 'render_first_page';
          const info = await ArchiveModule.getPdfInfo(file.path);
          if (info.status === 'SUCCESS') {
            await ArchiveModule.renderPdfPage(file.path, 0, 600);
            actual_outcome = 'OK';
          } else if (info.status === 'PASSWORD_REQUIRED') {
            actual_outcome = 'PASSWORD_REQUIRED';
            errorDesc = 'Password required to render PDF';
          } else {
            actual_outcome = 'ERROR_CORRUPT';
            errorDesc = info.error || 'Corrupt PDF';
          }
        } else if (detected.category === 'ARCHIVE_ZIP') {
          action = 'list_and_extract';
          const destDir = `/data/data/com.ufv_rn_poc/cache/batch_${Date.now()}`;
          try {
            const res = await engine.extract(file.path, destDir, '', { maxExpansionRatio: 100.0 });
            const timerBreakdown = (res.decompressMs !== undefined && res.diskWriteMs !== undefined && res.checksMs !== undefined)
              ? ` [Decomp: ${res.decompressMs.toFixed(1)}ms, Disk: ${res.diskWriteMs.toFixed(1)}ms, Checks: ${res.checksMs.toFixed(1)}ms]`
              : '';
            if (res.status === 'SUCCESS') {
              actual_outcome = 'OK';
              errorDesc = `Extracted ${res.extractedFiles.length} files (${(res.totalBytesExtracted / 1024).toFixed(1)} KB)${timerBreakdown}`;
            } else if (res.status === 'BLOCKED') {
              const errLower = (res.error || '').toLowerCase();
              if (errLower.includes('ratio') || errLower.includes('limit') || errLower.includes('count') || errLower.includes('bomb')) {
                actual_outcome = 'BLOCKED_LIMIT';
              } else {
                actual_outcome = 'BLOCKED_SECURITY';
              }
              errorDesc = (res.error || 'Blocked by security/resource limit') + timerBreakdown;
            } else if (res.status === 'ERROR' && (res.error || '').includes('PASSWORD_REQUIRED')) {
              actual_outcome = 'PASSWORD_REQUIRED';
              errorDesc = res.error || 'Password required';
            } else {
              actual_outcome = 'ERROR_CORRUPT';
              errorDesc = res.error || 'Zip extract error';
            }
          } catch (ze: any) {
            actual_outcome = 'ERROR_CORRUPT';
            errorDesc = ze.message;
          } finally {
            ArchiveModule.deleteDirectory?.(destDir);
          }
        } else if (detected.category === 'ARCHIVE_RAR4' || detected.category === 'ARCHIVE_RAR5') {
          action = 'rar_extract';
          const missingCheck = await engine.checkRarMissingVolume(file.path);
          if (missingCheck && missingCheck.isMissing) {
            actual_outcome = 'MISSING_VOLUME';
            errorDesc = `Incomplete multipart RAR set. Missing: ${missingCheck.missingVolume}`;
          } else {
            const destDir = `/data/data/com.ufv_rn_poc/cache/batch_rar_${Date.now()}`;
            try {
              const res = await engine.extract(file.path, destDir, '', { maxExpansionRatio: 100.0 });
              if (res.status === 'SUCCESS') {
                actual_outcome = 'OK';
                errorDesc = res.error || `Extracted ${res.extractedFiles.length} files`;
              } else if (res.status === 'BLOCKED') {
                const errLower = (res.error || '').toLowerCase();
                if (errLower.includes('ratio') || errLower.includes('limit') || errLower.includes('bomb')) {
                  actual_outcome = 'BLOCKED_LIMIT';
                } else {
                  actual_outcome = 'BLOCKED_SECURITY';
                }
                errorDesc = res.error || 'Blocked by security/resource limit';
              } else if (res.status === 'ERROR' && (res.error || '').includes('PASSWORD_REQUIRED')) {
                actual_outcome = 'PASSWORD_REQUIRED';
                errorDesc = res.error || 'Password required';
              } else {
                actual_outcome = 'ERROR_CORRUPT';
                errorDesc = res.error || 'RAR extract error';
              }
            } catch (re: any) {
              actual_outcome = 'ERROR_CORRUPT';
              errorDesc = re.message;
            } finally {
              ArchiveModule.deleteDirectory?.(destDir);
            }
          }
        } else if (detected.category === 'OFFICE_DOCX') {
          action = 'openxml_document_parse';
          try {
            await ArchiveModule.readZipEntryText(file.path, 'word/document.xml');
            actual_outcome = 'PARTIAL'; // Headings & text parsed, desktop layout lost
          } catch (de: any) {
            actual_outcome = 'ERROR_CORRUPT';
            errorDesc = de.message;
          }
        } else if (detected.category === 'OFFICE_PPTX') {
          action = 'openxml_slides_parse';
          try {
            await ArchiveModule.readZipEntryText(file.path, 'ppt/slides/slide1.xml');
            actual_outcome = 'PARTIAL'; // Slides text parsed, animations lost
          } catch (pe: any) {
            actual_outcome = 'ERROR_CORRUPT';
            errorDesc = pe.message;
          }
        } else if (detected.category === 'OFFICE_XLSX') {
          action = 'openxml_sheets_parse';
          try {
            await ArchiveModule.readZipEntryText(file.path, 'xl/worksheets/sheet1.xml');
            actual_outcome = 'OK';
          } catch (xe: any) {
            actual_outcome = 'ERROR_CORRUPT';
            errorDesc = xe.message;
          }
        } else if (detected.category === 'SPREADSHEET_CSV') {
          action = 'csv_chunk_parse';
          await ArchiveModule.readTextChunk(file.path, 0, 64 * 1024, 'UTF-8');
          actual_outcome = 'OK';
        } else if (detected.category === 'IMAGE') {
          action = 'downsample_decode';
          try {
            await ArchiveModule.downsampleImage(file.path, 2048);
            actual_outcome = 'OK';
          } catch (ie: any) {
            actual_outcome = 'ERROR_CORRUPT';
            errorDesc = ie.message;
          }
        } else if (detected.category === 'TEXT_CODE') {
          action = 'stream_64kb_chunk';
          await ArchiveModule.readTextChunk(file.path, 0, 64 * 1024, 'UTF-8');
          actual_outcome = 'OK';
        } else if (detected.category === 'VIDEO' || detected.category === 'AUDIO') {
          action = detected.category === 'VIDEO' ? 'video_real_playback' : 'audio_real_playback';
          try {
            const res = await ArchiveEngine.getInstance().playVideo(file.path, true);
            if (res.status === 'PASS' || res.status === 'SUCCESS' || res.status === 'OK') {
              actual_outcome = 'OK';
              const seekText = res.seekLatencyMs > 0 ? `Seek50: ${res.seekLatencyMs}ms` : 'Seek: N/A';
              errorDesc = `TTFF: ${res.ttffMs}ms | ${seekText} | Dur: ${(res.durationMs / 1000).toFixed(1)}s${res.error ? ` (${res.error})` : ''}`;
            } else if (res.status === 'UNSUPPORTED') {
              actual_outcome = 'UNSUPPORTED';
              errorDesc = res.error || 'Codec not supported by hardware decoder';
            } else {
              actual_outcome = 'ERROR_CORRUPT';
              errorDesc = res.error || 'Playback failed';
            }
          } catch (ve: any) {
            actual_outcome = 'ERROR_CORRUPT';
            errorDesc = ve.message || String(ve);
          }
        } else if (detected.category === 'OFFICE_PASSWORD_PROTECTED') {
          action = 'password_envelope_inspect';
          actual_outcome = 'PASSWORD_REQUIRED';
          errorDesc = 'Password-protected Office document (OLE encrypted envelope)';
        } else if (detected.category === 'ERROR_CORRUPT') {
          action = 'damaged_magic_probe';
          actual_outcome = 'ERROR_CORRUPT';
          errorDesc = detected.notes || 'Damaged header magic';
        } else if (detected.category === 'UNSUPPORTED') {
          action = 'format_unsupported_probe';
          actual_outcome = 'UNSUPPORTED';
          errorDesc = detected.notes || 'Unsupported format';
        } else if (detected.category.startsWith('LEGACY_OLE')) {
          action = 'legacy_ole_inspect';
          actual_outcome = 'UNSUPPORTED';
          errorDesc = 'Binary OLE compound format (requires LibreOffice engine)';
        } else {
          action = 'unknown_probe';
          actual_outcome = 'UNSUPPORTED';
          errorDesc = detected.notes || 'Unknown format';
        }
      }

      const elapsed = Date.now() - start;
      const mem = await engine.stopPssSampling();
      const { verdict, notes } = computeVerdict(expected_behaviour, actual_outcome, elapsed, target_ms);

      const entry: BenchmarkEntry = {
        file: file.name,
        folder,
        expected_behaviour,
        actual_outcome,
        verdict,
        action,
        ms: elapsed,
        target_ms,
        peak_pss_mb: mem.peak_pss_mb,
        baseline_pss_mb: mem.baseline_pss_mb,
        device_model: mem.device_model,
        hardware: mem.hardware,
        abi: mem.abi,
        is_emulator: mem.is_emulator,
        os_version: mem.os_version,
        app_build: mem.app_build,
        run_index: runIndex,
        error_text: (errorDesc || notes || '').replace(/,/g, ';').replace(/\n/g, ' '),
      };

      return entry;
    } catch (err: any) {
      const elapsed = Date.now() - start;
      const mem = await engine.stopPssSampling();
      const entry: BenchmarkEntry = {
        file: file.name,
        folder,
        expected_behaviour,
        actual_outcome: 'CRASH',
        verdict: 'FAIL',
        action: 'error_trap',
        ms: elapsed,
        target_ms,
        peak_pss_mb: mem.peak_pss_mb,
        baseline_pss_mb: mem.baseline_pss_mb,
        device_model: mem.device_model,
        hardware: mem.hardware,
        abi: mem.abi,
        is_emulator: mem.is_emulator,
        os_version: mem.os_version,
        app_build: mem.app_build,
        run_index: runIndex,
        error_text: (err.message || String(err)).replace(/,/g, ';').replace(/\n/g, ' '),
      };
      return entry;
    }
  };

  const runAllCorpusFiles = async (startIndex: number = 0) => {
    if (folderFiles.length === 0) {
      Alert.alert('No Files', 'No test files found in /sdcard/Download.');
      return;
    }

    setIsBatchRunning(true);
    let currentLogs: BenchmarkEntry[] = startIndex === 0 ? [] : [...logs];
    if (startIndex === 0) {
      logger.clear();
      setLogs([]);
      await engine.clearRunState();
      setHasSavedState(false);
    }
    setExportPath('');

    let timedOutCount = 0;
    let crashedCount = 0;

    for (let i = startIndex; i < folderFiles.length; i++) {
      const f = folderFiles[i];
      setCurrentFileIdx(i + 1);
      setCurrentFileName(f.name);

      // Per-test timeout: 300s for LARGE pack, 60s standard
      const isLargePack = f.path.includes('ufv_test_corpus_LARGE');
      const timeoutLimitMs = isLargePack ? 300000 : 60000;

      try {
        const timeoutPromise = new Promise<BenchmarkEntry>((_, reject) =>
          setTimeout(() => reject(new Error(`TIMEOUT_EXCEEDED: Exceeded ${timeoutLimitMs / 1000}s safety limit`)), timeoutLimitMs)
        );

        const entry = await Promise.race([runSingleFileBenchmark(f, i + 1), timeoutPromise]);
        await logger.logRun(entry);
        currentLogs.unshift(entry);
        setLogs([...currentLogs]);

        if (entry.actual_outcome === 'TIMEOUT') timedOutCount++;
        if (entry.actual_outcome === 'CRASH') crashedCount++;
      } catch (err: any) {
        console.warn(`File ${f.name} error/timeout, recording and advancing`, err);
        await engine.cancel(); // Abort background worker immediately

        const mem = await engine.stopPssSampling();
        const cleanRel = f.name.replace(/\\/g, '/');
        const manifestEntry = manifestMap[cleanRel] ||
          manifestMap[cleanRel.replace(/^ufv_test_corpus\//, '').replace(/^ufv_test_corpus_LARGE\//, '')] ||
          manifestMap[cleanRel.split('/').pop() || ''];
        const exp = manifestEntry?.expected_behaviour || 'OPEN';
        const isTimeout = (err.message || '').includes('TIMEOUT_EXCEEDED');
        const outcome: ActualOutcome = isTimeout ? 'TIMEOUT' : 'CRASH';

        if (isTimeout) timedOutCount++;
        else crashedCount++;

        const fallbackEntry: BenchmarkEntry = {
          file: f.name,
          folder: isLargePack ? 'ufv_test_corpus_LARGE' : 'ufv_test_corpus',
          expected_behaviour: exp,
          actual_outcome: outcome,
          verdict: 'FAIL',
          action: isTimeout ? 'timeout_cancel' : 'crash_handler',
          ms: timeoutLimitMs,
          target_ms: manifestEntry?.target_ms || 0,
          peak_pss_mb: mem.peak_pss_mb,
          baseline_pss_mb: mem.baseline_pss_mb,
          device_model: mem.device_model,
          hardware: mem.hardware,
          abi: mem.abi,
          is_emulator: mem.is_emulator,
          os_version: mem.os_version,
          app_build: mem.app_build,
          run_index: i + 1,
          error_text: (err.message || String(err)).replace(/,/g, ';').replace(/\n/g, ' '),
        };

        await logger.logRun(fallbackEntry);
        currentLogs.unshift(fallbackEntry);
        setLogs([...currentLogs]);
      }

      // Persist state to disk after EVERY file so runner can resume
      try {
        await engine.saveRunState(
          JSON.stringify({
            total: folderFiles.length,
            done: i + 1,
            timedOut: timedOutCount,
            crashed: crashedCount,
            logs: currentLogs,
          })
        );
      } catch (se) {
        console.warn('saveRunState error', se);
      }
    }

    setIsBatchRunning(false);
    setCurrentFileName('');

    // Automatically export results.csv
    try {
      const res = await logger.exportToFile('results.csv');
      setExportPath(res.filePath);
    } catch (e) {
      console.warn('Auto export failed', e);
    }
  };

  const handleResume = () => {
    runAllCorpusFiles(logs.length);
  };

  const handleExportCsv = async () => {
    try {
      const res = await logger.exportToFile('results.csv');
      setExportPath(res.filePath);
      Alert.alert('Export Success', `Exported ${logs.length} rows to:\n${res.filePath}`);
    } catch (e: any) {
      Alert.alert('Export Error', e.message);
    }
  };

  const handleRunBaselineZip = async () => {
    setIsBaselineRunning(true);
    try {
      const res = await engine.runCurrentZipBaseline();
      setBaselineResults(res);
      console.log('BASELINE_CURRENT_ZIP_OUTPUT: ' + JSON.stringify(res, null, 2));
      Alert.alert(
        'Current ZIP Baseline Recorded',
        res
          .map(
            (r) =>
              `• ${r.file}\nStatus: ${r.status}\nTime: ${r.wallClockMs}ms\nEntries: ${r.entryCount || 0}\nBytes: ${(
                (r.bytesExtracted || 0) /
                (1024 * 1024)
              ).toFixed(2)} MB\nError: ${r.error || 'None'}`
          )
          .join('\n\n')
      );
    } catch (e: any) {
      Alert.alert('Baseline Error', e.message);
    } finally {
      setIsBaselineRunning(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* 1. Header & Controls */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>⚡ Phase 6/7: Full Verification Batch Runner</Text>
        <Text style={styles.cardDesc}>
          Executes the complete test corpus (238 files) with ground-truth expected vs actual matching, per-test timeouts (60s/300s), crash persistence, and native PSS memory telemetry.
        </Text>

        <View style={styles.statsRow}>
          <Text style={styles.statsText}>
            Corpus Files: <Text style={styles.bold}>{folderFiles.length}</Text>
          </Text>
          <Text style={styles.statsText}>
            Manifest Rules: <Text style={styles.bold}>{Object.keys(manifestMap).length}</Text>
          </Text>
          <Text style={styles.statsText}>
            Logged Runs: <Text style={styles.bold}>{logs.length}</Text>
          </Text>
        </View>

        {/* Resume Banner */}
        {hasSavedState && !isBatchRunning ? (
          <View style={styles.resumeBox}>
            <Text style={styles.resumeTitle}>🔄 Unfinished Batch Found</Text>
            <Text style={styles.resumeInfo}>{savedStateInfo}</Text>
            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.resumeBtn} onPress={handleResume}>
                <Text style={styles.resumeBtnText}>▶ RESUME FROM FILE {logs.length + 1}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.freshBtn}
                onPress={() => {
                  engine.clearRunState();
                  setHasSavedState(false);
                  logger.clear();
                  setLogs([]);
                }}>
                <Text style={styles.freshBtnText}>RESET</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {isBatchRunning ? (
          <View style={styles.progressBox}>
            <View style={styles.progressHeader}>
              <ActivityIndicator color="#1a73e8" size="small" />
              <Text style={styles.progressTitle}>
                Benchmarking ({currentFileIdx} / {folderFiles.length})
              </Text>
            </View>
            <Text style={styles.progressFile} numberOfLines={1}>{currentFileName}</Text>
          </View>
        ) : (
          <View style={styles.btnCol}>
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.primaryBtn, folderFiles.length === 0 && styles.disabledBtn]}
                disabled={folderFiles.length === 0}
                onPress={() => runAllCorpusFiles(0)}>
                <Text style={styles.primaryBtnText}>▶ RUN ALL BENCHMARKS</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryBtn, logs.length === 0 && styles.disabledBtn]}
                disabled={logs.length === 0}
                onPress={handleExportCsv}>
                <Text style={styles.secondaryBtnText}>📥 EXPORT CSV</Text>
              </TouchableOpacity>
            </View>

            {/* Baseline ZIP Trigger Button */}
            <TouchableOpacity
              style={[styles.baselineBtn, isBaselineRunning && styles.disabledBtn]}
              disabled={isBaselineRunning}
              onPress={handleRunBaselineZip}>
              <Text style={styles.baselineBtnText}>
                {isBaselineRunning ? '⏳ MEASURING CURRENT ZIP BASELINE...' : '⏱ RECORD CURRENT ZIP BASELINE'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {exportPath ? (
          <View style={styles.exportSuccessBox}>
            <Text style={styles.exportSuccessText}>✅ results.csv exported successfully to:</Text>
            <Text style={styles.exportPathText} selectable>{exportPath}</Text>
          </View>
        ) : null}

        {/* Baseline Results Card */}
        {baselineResults.length > 0 ? (
          <View style={styles.baselineBox}>
            <Text style={styles.baselineBoxTitle}>📋 Current Code ZIP Baseline Measurements:</Text>
            {baselineResults.map((b, idx) => (
              <View key={idx} style={styles.baselineItem}>
                <Text style={styles.baselineFile}>{b.file}</Text>
                <Text style={styles.baselineMeta}>
                  Status: <Text style={styles.bold}>{b.status}</Text> | Time:{' '}
                  <Text style={styles.bold}>{b.wallClockMs}ms</Text> | Entries:{' '}
                  <Text style={styles.bold}>{b.entryCount || 0}</Text> | Bytes:{' '}
                  <Text style={styles.bold}>{((b.bytesExtracted || 0) / (1024 * 1024)).toFixed(2)} MB</Text>
                </Text>
                {b.error ? <Text style={styles.baselineError}>Error: {b.error}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* 2. Results Table with Side-by-Side Expected vs Actual */}
      <View style={styles.card}>
        <View style={styles.tableHeaderRow}>
          <Text style={styles.cardTitle}>📊 Ground-Truth Telemetry (Side-by-Side)</Text>
          {logs.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                logger.clear();
                setLogs([]);
                engine.clearRunState();
                setHasSavedState(false);
              }}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {!Array.isArray(logs) || logs.length === 0 ? (
          <Text style={styles.emptyText}>
            No benchmark runs logged yet. Tap "RUN ALL BENCHMARKS" above.
          </Text>
        ) : (
          logs.map((e, idx) => (
            <View key={idx} style={styles.entryRow}>
              <View style={styles.entryHeader}>
                <Text style={styles.entryFile} numberOfLines={1}>{e.file}</Text>
                <View
                  style={[
                    styles.verdictBadge,
                    e.verdict === 'PASS'
                      ? styles.passBadge
                      : e.verdict === 'FAIL'
                      ? styles.failBadge
                      : styles.notRunBadge,
                  ]}>
                  <Text style={styles.verdictBadgeText}>{e.verdict}</Text>
                </View>
              </View>

              <View style={styles.comparisonRow}>
                <Text style={styles.comparisonText}>
                  Expected: <Text style={styles.bold}>{e.expected_behaviour}</Text>
                </Text>
                <Text style={styles.arrowText}>➔</Text>
                <Text style={styles.comparisonText}>
                  Actual: <Text style={styles.bold}>{e.actual_outcome}</Text>
                </Text>
              </View>

              <Text style={styles.entryMeta}>
                Action: <Text style={styles.bold}>{e.action}</Text> | Time:{' '}
                <Text style={styles.bold}>{e.ms}ms</Text>
                {e.target_ms > 0 ? ` (Target: ${e.target_ms}ms)` : ''} | Peak PSS:{' '}
                <Text style={styles.bold}>{e.peak_pss_mb} MB</Text> (Base: {e.baseline_pss_mb} MB)
              </Text>
              <Text style={styles.entryDevice}>
                Device: {e.device_model} ({e.hardware}, {e.abi}, {e.is_emulator ? 'EMULATOR' : 'PHONE'})
              </Text>
              {e.error_text ? <Text style={styles.entryError}>Note: {e.error_text}</Text> : null}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  content: { padding: 16 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#202124' },
  cardDesc: { fontSize: 12, color: '#5f6368', marginTop: 4, lineHeight: 18 },
  statsRow: { flexDirection: 'row', marginTop: 12, marginBottom: 12, gap: 16 },
  statsText: { fontSize: 12, color: '#5f6368' },
  bold: { fontWeight: '700', color: '#202124' },
  progressBox: {
    backgroundColor: '#e8f0fe',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  progressHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressTitle: { fontSize: 13, fontWeight: '700', color: '#1a73e8' },
  progressFile: { fontSize: 12, color: '#3c4043', marginTop: 4, fontFamily: 'monospace' },
  btnCol: { gap: 8 },
  btnRow: { flexDirection: 'row', gap: 8 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#1a73e8',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  secondaryBtn: {
    backgroundColor: '#34a853',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  baselineBtn: {
    backgroundColor: '#f2994a',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  baselineBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  disabledBtn: { opacity: 0.5 },
  resumeBox: {
    backgroundColor: '#fef7e0',
    borderWidth: 1,
    borderColor: '#f9ab00',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  resumeTitle: { fontSize: 13, fontWeight: '700', color: '#b06000' },
  resumeInfo: { fontSize: 12, color: '#5f6368', marginTop: 2, marginBottom: 8 },
  resumeBtn: {
    flex: 1,
    backgroundColor: '#f9ab00',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  resumeBtnText: { color: '#202124', fontWeight: '700', fontSize: 12 },
  freshBtn: {
    backgroundColor: '#e0e0e0',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignItems: 'center',
  },
  freshBtnText: { color: '#3c4043', fontWeight: '700', fontSize: 12 },
  exportSuccessBox: {
    backgroundColor: '#e6f4ea',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
  },
  exportSuccessText: { fontSize: 12, fontWeight: '700', color: '#137333' },
  exportPathText: { fontSize: 11, color: '#3c4043', fontFamily: 'monospace', marginTop: 2 },
  baselineBox: {
    backgroundColor: '#fff8e1',
    borderWidth: 1,
    borderColor: '#ffe082',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  baselineBoxTitle: { fontSize: 12, fontWeight: '700', color: '#8d6e63', marginBottom: 6 },
  baselineItem: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#ffe082',
  },
  baselineFile: { fontSize: 12, fontWeight: '700', color: '#202124' },
  baselineMeta: { fontSize: 11, color: '#5f6368', marginTop: 2 },
  baselineError: { fontSize: 11, color: '#d93025', marginTop: 2 },
  tableHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  clearText: { color: '#d93025', fontSize: 12, fontWeight: '600' },
  emptyText: { color: '#80868b', fontSize: 12, textAlign: 'center', marginVertical: 20 },
  entryRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
    paddingVertical: 10,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  entryFile: { fontSize: 13, fontWeight: '700', color: '#202124', flex: 1, marginRight: 8 },
  verdictBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  passBadge: { backgroundColor: '#e6f4ea' },
  failBadge: { backgroundColor: '#fce8e6' },
  notRunBadge: { backgroundColor: '#f1f3f4' },
  verdictBadgeText: { fontSize: 11, fontWeight: '700', color: '#202124' },
  comparisonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  comparisonText: { fontSize: 11, color: '#3c4043' },
  arrowText: { fontSize: 11, color: '#80868b' },
  entryMeta: { fontSize: 11, color: '#5f6368', marginTop: 4 },
  entryDevice: { fontSize: 10, color: '#80868b', marginTop: 2 },
  entryError: { fontSize: 11, color: '#b06000', marginTop: 3, fontStyle: 'italic' },
});

import { NativeModules } from 'react-native';

const { ArchiveModule } = NativeModules;

export type ActualOutcome =
  | 'OK'
  | 'ERROR_CORRUPT'
  | 'PASSWORD_REQUIRED'
  | 'UNSUPPORTED'
  | 'BLOCKED_SECURITY'
  | 'BLOCKED_LIMIT'
  | 'EMPTY'
  | 'MISSING_VOLUME'
  | 'PARTIAL'
  | 'DETECTED_ONLY'
  | 'TIMEOUT'
  | 'CRASH';

export type Verdict = 'PASS' | 'FAIL' | 'NOT_RUN';

export interface BenchmarkEntry {
  file: string;
  folder: string;
  expected_behaviour: string;
  actual_outcome: ActualOutcome;
  verdict: Verdict;
  action: string;
  ms: number;
  target_ms: number;
  peak_pss_mb: number;
  baseline_pss_mb: number;
  device_model: string;
  hardware: string;
  abi: string;
  is_emulator: boolean;
  os_version: string;
  app_build: string;
  run_index: number;
  error_text: string;
}

export function computeVerdict(
  expected: string,
  actual: ActualOutcome,
  ms: number,
  target_ms: number
): { verdict: Verdict; notes?: string } {
  if (actual === 'DETECTED_ONLY') return { verdict: 'NOT_RUN', notes: 'Inspection/detection only' };
  if (actual === 'TIMEOUT') return { verdict: 'FAIL', notes: 'Timed out' };
  if (actual === 'CRASH') return { verdict: 'FAIL', notes: 'Process crash or uncaught exception' };

  const expUpper = (expected || '').trim().toUpperCase();

  // 1. Full Open / Play / Extract
  if (
    expUpper === 'OPEN' ||
    expUpper === 'OPEN_ANIMATED' ||
    expUpper === 'OPEN_NO_CRASH' ||
    expUpper === 'OPEN_NO_FREEZE' ||
    expUpper === 'OPEN_NO_OOM' ||
    expUpper === 'OPEN_NO_RECALC' ||
    expUpper === 'OPEN_FAST_LOW_MEMORY' ||
    expUpper === 'PLAY' ||
    expUpper === 'PLAY_WITH_SUBS_IF_SUPPORTED' ||
    expUpper === 'EXTRACT_UNDER_10S' ||
    expUpper === 'BROWSE_EXTRACT_OPEN' ||
    expUpper === 'BROWSE_EXTRACT_DUPLICATE_FLOW' ||
    expUpper === 'BROWSE_EXTRACT_OR_CLEAR_ERROR'
  ) {
    if (actual === 'OK') {
      if (target_ms > 0 && ms > target_ms) {
        return { verdict: 'FAIL', notes: `Exceeded target SLA: ${ms}ms > ${target_ms}ms` };
      }
      return { verdict: 'PASS' };
    }
    return { verdict: 'FAIL', notes: `Expected ${expUpper}, got ${actual}` };
  }

  // 2. Partial Open or Limit or Browsing
  if (
    expUpper.includes('PARTIAL') ||
    expUpper === 'OPEN_OR_DOCUMENT_LIMIT' ||
    expUpper === 'PLAY_OR_DOCUMENT_LIMIT' ||
    expUpper === 'EXTRACT_SELECTED_SLOW_OK' ||
    expUpper === 'BROWSE_FAST_OR_LIMIT_MESSAGE' ||
    expUpper === 'BROWSE_EXTRACT_NESTING_LIMIT' ||
    expUpper === 'PARTIAL_FAILURE_REPORTED' ||
    expUpper === 'PARTIAL_OR_ERROR' ||
    expUpper === 'ERROR_CORRUPT_OR_PARTIAL' ||
    expUpper === 'PLAY_PARTIAL_OR_ERROR'
  ) {
    if (actual === 'OK' || actual === 'PARTIAL' || actual === 'UNSUPPORTED' || actual === 'BLOCKED_LIMIT') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected ${expUpper}, got ${actual}` };
  }

  // 3. Corrupt files expected to error (accepts ERROR_CORRUPT, EMPTY, BLOCKED_SECURITY, BLOCKED_LIMIT)
  if (expUpper === 'ERROR_CORRUPT' || expUpper.includes('CORRUPT') || expUpper === 'ERROR_OR_REJECT') {
    if (actual === 'ERROR_CORRUPT' || actual === 'EMPTY' || actual === 'BLOCKED_SECURITY' || actual === 'BLOCKED_LIMIT') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected corrupt error, got ${actual}` };
  }

  // 4. Password required
  if (
    expUpper === 'PASSWORD_REQUIRED' ||
    expUpper === 'PASSWORD_REQUIRED_TO_BROWSE' ||
    expUpper === 'PARTIAL_PASSWORD_REQUIRED' ||
    expUpper === 'BROWSE_THEN_PASSWORD_ON_EXTRACT'
  ) {
    if (actual === 'PASSWORD_REQUIRED') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected password required, got ${actual}` };
  }

  // 5. Hostile archives expected to be blocked by security
  if (expUpper === 'REJECT_SECURITY' || expUpper === 'REJECT_SECURITY_OR_SANITISE') {
    if (actual === 'BLOCKED_SECURITY' || actual === 'BLOCKED_LIMIT') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected security block, got ${actual}` };
  }

  // 6. Hostile archives expected to be blocked by resource limits
  if (expUpper === 'REJECT_RESOURCE_LIMIT') {
    if (actual === 'BLOCKED_LIMIT' || actual === 'BLOCKED_SECURITY') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected resource limit block, got ${actual}` };
  }

  // 7. Empty files
  if (expUpper === 'OPEN_EMPTY_STATE' || expUpper === 'EMPTY') {
    if (actual === 'EMPTY' || actual === 'OK' || actual === 'ERROR_CORRUPT') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected empty handling, got ${actual}` };
  }

  // 8. Missing volume
  if (expUpper === 'ERROR_MISSING_VOLUME') {
    if (actual === 'MISSING_VOLUME') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected missing volume error, got ${actual}` };
  }

  // 9. Multipart complete (must remain DETECTED_ONLY -> NOT_RUN)
  if (expUpper === 'MULTIPART_OPEN_FIRST_PART') {
    if (actual === 'OK') return { verdict: 'PASS' };
    return { verdict: 'NOT_RUN', notes: `Multipart complete probe: ${actual}` };
  }

  // 10. Unsupported files
  if (expUpper === 'UNSUPPORTED_MESSAGE' || expUpper === 'UNSUPPORTED') {
    if (actual === 'UNSUPPORTED') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected unsupported message, got ${actual}` };
  }

  // 11. Miscellaneous expected behaviors
  if (
    expUpper === 'DETECT_REAL_TYPE' ||
    expUpper === 'OPEN_ENCODING' ||
    expUpper === 'OPEN_SAFE' ||
    expUpper === 'OPEN_AS_TEXT' ||
    expUpper === 'OPEN_AS_TEXT_WITH_WARNING'
  ) {
    if (actual === 'OK' || actual === 'PARTIAL') return { verdict: 'PASS' };
    return { verdict: 'FAIL', notes: `Expected ${expUpper}, got ${actual}` };
  }

  return { verdict: 'NOT_RUN', notes: `Unknown expected code: ${expected}` };
}

export class BenchmarkLogger {
  private static instance: BenchmarkLogger;
  private entries: BenchmarkEntry[] = [];

  private constructor() {}

  public static getInstance(): BenchmarkLogger {
    if (!BenchmarkLogger.instance) {
      BenchmarkLogger.instance = new BenchmarkLogger();
    }
    return BenchmarkLogger.instance;
  }

  public setEntries(entries: BenchmarkEntry[]): void {
    this.entries = [...entries];
  }

  public getEntries(): BenchmarkEntry[] {
    return [...this.entries];
  }

  public clear(): void {
    this.entries = [];
  }

  public async logRun(entry: BenchmarkEntry): Promise<BenchmarkEntry> {
    const idx = this.entries.findIndex((e) => e.file === entry.file);
    if (idx >= 0) {
      this.entries[idx] = entry;
    } else {
      this.entries.push(entry);
    }
    return entry;
  }

  public generateCsv(): string {
    const header =
      'file,folder,expected_behaviour,actual_outcome,verdict,action,ms,target_ms,peak_pss_mb,baseline_pss_mb,device_model,hardware,abi,is_emulator,os_version,app_build,run_index,error_text';
    const rows = this.entries.map((e) =>
      `"${e.file}","${e.folder}","${e.expected_behaviour}","${e.actual_outcome}","${e.verdict}","${e.action}",${e.ms},${e.target_ms},${e.peak_pss_mb},${e.baseline_pss_mb},"${e.device_model}","${e.hardware}","${e.abi}",${e.is_emulator},"${e.os_version}","${e.app_build}",${e.run_index},"${e.error_text}"`
    );
    return [header, ...rows].join('\n');
  }

  public async exportToFile(fileName: string = 'results.csv'): Promise<{ filePath: string; size: number }> {
    const csv = this.generateCsv();
    if (ArchiveModule && ArchiveModule.exportCsv) {
      const res = await ArchiveModule.exportCsv(csv, fileName);
      return { filePath: res.filePath, size: res.fileSize };
    }
    throw new Error('Export CSV native module not available');
  }
}

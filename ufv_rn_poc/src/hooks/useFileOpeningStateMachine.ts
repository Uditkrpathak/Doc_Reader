import { useReducer, useCallback, useRef } from 'react';
import {
  FileOpeningStateMachineState,
  INITIAL_STATE_MACHINE,
  fileOpeningReducer,
} from '../state/FileOpeningStateMachine';
import { StorageService } from '../services/StorageService';
import { ArchiveEngine } from '../services/ArchiveEngine';
import { FileDetector } from '../services/FileDetector';

export function useFileOpeningStateMachine(initialState?: Partial<FileOpeningStateMachineState>) {
  const [machine, dispatch] = useReducer(fileOpeningReducer, {
    ...INITIAL_STATE_MACHINE,
    ...initialState,
  });

  const storageService = StorageService.getInstance();
  const archiveEngine = ArchiveEngine.getInstance();
  const abortControllerRef = useRef<boolean>(false);

  const startOpen = useCallback((filePath: string, fileName: string, category?: string) => {
    dispatch({ type: 'START_OPEN', payload: { filePath, fileName, category } });
  }, []);

  const accessCheckPass = useCallback(() => {
    dispatch({ type: 'ACCESS_CHECK_PASS' });
  }, []);

  const accessCheckFail = useCallback(() => {
    dispatch({ type: 'ACCESS_CHECK_FAIL' });
  }, []);

  const validationPass = useCallback((resolvedPath: string, fileSize?: number) => {
    dispatch({ type: 'VALIDATION_PASS', payload: { resolvedPath, fileSize } });
  }, []);

  const validationFailLimit = useCallback((error: string) => {
    dispatch({ type: 'VALIDATION_FAIL_LIMIT', payload: { error } });
  }, []);

  const validationFailCorrupted = useCallback((error: string) => {
    dispatch({ type: 'VALIDATION_FAIL_CORRUPTED', payload: { error } });
  }, []);

  const typeDetected = useCallback((category: string, formatType?: string, mimeType?: string) => {
    dispatch({ type: 'TYPE_DETECTED', payload: { category, formatType, mimeType } });
  }, []);

  const typeUnknown = useCallback((error: string) => {
    dispatch({ type: 'TYPE_UNKNOWN', payload: { error } });
  }, []);

  const engineInitialized = useCallback(() => {
    dispatch({ type: 'ENGINE_INITIALIZED' });
  }, []);

  const enginePasswordNeeded = useCallback(() => {
    dispatch({ type: 'ENGINE_PASSWORD_NEEDED' });
  }, []);

  const submitPassword = useCallback((password: string) => {
    dispatch({ type: 'SUBMIT_PASSWORD', payload: { password } });
  }, []);

  const renderSuccess = useCallback(() => {
    dispatch({ type: 'RENDER_SUCCESS' });
  }, []);

  const renderFail = useCallback((error: string, canRetry = true) => {
    dispatch({ type: 'RENDER_FAIL', payload: { error, canRetry } });
  }, []);

  const retry = useCallback(() => {
    dispatch({ type: 'RETRY' });
  }, []);

  const cancel = useCallback(() => {
    abortControllerRef.current = true;
    dispatch({ type: 'CANCEL' });
  }, []);

  const reset = useCallback(() => {
    abortControllerRef.current = false;
    dispatch({ type: 'RESET' });
  }, []);

  /**
   * Automated Execution Pipeline following Section 5.2
   * IDLE -> ACCESS_CHECK -> FILE_VALIDATION -> TYPE_DETECTION -> ENGINE_INITIALIZATION
   */
  const executeOpenFile = useCallback(
    async (filePath: string, fileName: string, categoryHint?: string) => {
      abortControllerRef.current = false;

      // 1. Transition: IDLE -> ACCESS_CHECK
      dispatch({ type: 'START_OPEN', payload: { filePath, fileName, category: categoryHint } });

      try {
        // Step 1: ACCESS_CHECK
        const perms = await storageService.getPermissionState();
        if (abortControllerRef.current) return;

        // Content URIs from external apps carry their own temporary Activity URI permissions
        const isContentUri = filePath.startsWith('content://');
        const hasAccess = isContentUri || perms.allFiles || perms.documentsTreeGranted || perms.media === 'granted';

        if (!hasAccess) {
          dispatch({ type: 'ACCESS_CHECK_FAIL' });
          return;
        }

        // Transition: ACCESS_CHECK -> FILE_VALIDATION
        dispatch({ type: 'ACCESS_CHECK_PASS' });

        // Step 2: FILE_VALIDATION
        let resolvedPath = filePath;
        let fileSize = 0;
        try {
          const resolved = await archiveEngine.resolveContentUri(filePath);
          if (abortControllerRef.current) return;
          resolvedPath = resolved.path;
          fileSize = resolved.size || 0;
        } catch (valErr: any) {
          if (abortControllerRef.current) return;
          const msg = valErr?.message || String(valErr);
          if (msg.includes('LOW_STORAGE') || msg.includes('limit') || msg.includes('safety limit')) {
            dispatch({ type: 'VALIDATION_FAIL_LIMIT', payload: { error: msg } });
            return;
          }
          dispatch({ type: 'VALIDATION_FAIL_CORRUPTED', payload: { error: msg } });
          return;
        }

        // Transition: FILE_VALIDATION -> TYPE_DETECTION
        dispatch({ type: 'VALIDATION_PASS', payload: { resolvedPath, fileSize } });

        // Step 3: TYPE_DETECTION
        let detectedCategory = categoryHint;
        let detectedFormat: string | undefined = undefined;

        try {
          const detected = await FileDetector.detectFile(resolvedPath, fileName);
          if (abortControllerRef.current) return;
          detectedCategory = detected.category;

          const ext = (fileName.split('.').pop() || '').toLowerCase();
          if (ext === 'docx') detectedFormat = 'DOCX';
          else if (ext === 'doc') detectedFormat = 'DOC';
          else if (ext === 'pptx') detectedFormat = 'PPTX';
          else if (ext === 'ppt') detectedFormat = 'PPT';
        } catch (typeErr: any) {
          if (abortControllerRef.current) return;
          if (!categoryHint) {
            dispatch({ type: 'TYPE_UNKNOWN', payload: { error: 'Unsupported file type.' } });
            return;
          }
        }

        if (!detectedCategory || detectedCategory === 'UNKNOWN') {
          dispatch({ type: 'TYPE_UNKNOWN', payload: { error: `Cannot recognize format for "${fileName}".` } });
          return;
        }

        // Transition: TYPE_DETECTION -> ENGINE_INITIALIZATION
        dispatch({
          type: 'TYPE_DETECTED',
          payload: {
            category: detectedCategory,
            formatType: detectedFormat,
          },
        });

        // Transition: ENGINE_INITIALIZATION -> RENDERING
        dispatch({ type: 'ENGINE_INITIALIZED' });
      } catch (pipelineErr: any) {
        if (abortControllerRef.current) return;
        dispatch({
          type: 'VALIDATION_FAIL_RETRY',
          payload: { error: pipelineErr?.message || 'Pipeline execution failed.' },
        });
      }
    },
    [storageService, archiveEngine]
  );

  return {
    state: machine.state,
    context: machine.context,

    // Step Actions
    startOpen,
    accessCheckPass,
    accessCheckFail,
    validationPass,
    validationFailLimit,
    validationFailCorrupted,
    typeDetected,
    typeUnknown,
    engineInitialized,
    enginePasswordNeeded,
    submitPassword,
    renderSuccess,
    renderFail,
    retry,
    cancel,
    reset,

    // Pipeline Runner
    executeOpenFile,

    // State Classification Flags (Section 5.2)
    isIdle: machine.state === 'IDLE',
    isCheckingAccess: machine.state === 'ACCESS_CHECK',
    isValidating: machine.state === 'FILE_VALIDATION',
    isDetectingType: machine.state === 'TYPE_DETECTION',
    isInitializingEngine: machine.state === 'ENGINE_INITIALIZATION',
    isRendering: machine.state === 'RENDERING',
    isReady: machine.state === 'READY',

    isProcessing:
      machine.state === 'ACCESS_CHECK' ||
      machine.state === 'FILE_VALIDATION' ||
      machine.state === 'TYPE_DETECTION' ||
      machine.state === 'ENGINE_INITIALIZATION' ||
      machine.state === 'RENDERING',

    // Failure States (Section 5.2 Recoverable Failures)
    isAccessRequired: machine.state === 'ACCESS_REQUIRED',
    isUnsupportedFormat: machine.state === 'UNSUPPORTED_FORMAT',
    isCorruptedFile: machine.state === 'CORRUPTED_FILE',
    isPasswordRequired: machine.state === 'PASSWORD_REQUIRED',
    isResourceLimitReached: machine.state === 'RESOURCE_LIMIT_REACHED',
    isRetryAvailable: machine.state === 'RETRY_AVAILABLE',
    isCancelled: machine.state === 'CANCELLED',
    isError:
      machine.state === 'ACCESS_REQUIRED' ||
      machine.state === 'UNSUPPORTED_FORMAT' ||
      machine.state === 'CORRUPTED_FILE' ||
      machine.state === 'RESOURCE_LIMIT_REACHED' ||
      machine.state === 'RETRY_AVAILABLE',
  };
}

/**
 * Section 5.2 Strict State Machine for File Opening
 * Prevents invalid transitions, duplicate actions, and inconsistent UI states.
 */

export type FileOpeningState =
  | 'IDLE'
  | 'ACCESS_CHECK'
  | 'FILE_VALIDATION'
  | 'TYPE_DETECTION'
  | 'ENGINE_INITIALIZATION'
  | 'RENDERING'
  | 'READY'
  // Recoverable & Terminal Failures
  | 'RETRY_AVAILABLE'
  | 'ACCESS_REQUIRED'
  | 'UNSUPPORTED_FORMAT'
  | 'CORRUPTED_FILE'
  | 'PASSWORD_REQUIRED'
  | 'RESOURCE_LIMIT_REACHED'
  | 'CANCELLED';

export interface FileOpeningContext {
  filePath: string;
  fileName: string;
  resolvedLocalPath?: string;
  category?: string;
  formatType?: string;
  mimeType?: string;
  fileSize?: number;
  password?: string;
  error?: string;
  retryCount: number;
}

/**
 * Valid Transition Map conforming strictly to Section 5.2
 * Any transition not explicitly listed is illegal and rejected.
 */
export const VALID_TRANSITIONS: Record<FileOpeningState, FileOpeningState[]> = {
  IDLE: [
    'ACCESS_CHECK',
    'CANCELLED',
  ],

  ACCESS_CHECK: [
    'FILE_VALIDATION',
    'ACCESS_REQUIRED',
    'CANCELLED',
  ],

  ACCESS_REQUIRED: [
    'ACCESS_CHECK',
    'CANCELLED',
  ],

  FILE_VALIDATION: [
    'TYPE_DETECTION',
    'RESOURCE_LIMIT_REACHED',
    'CORRUPTED_FILE',
    'RETRY_AVAILABLE',
    'CANCELLED',
  ],

  TYPE_DETECTION: [
    'ENGINE_INITIALIZATION',
    'UNSUPPORTED_FORMAT',
    'CORRUPTED_FILE',
    'CANCELLED',
  ],

  ENGINE_INITIALIZATION: [
    'RENDERING',
    'PASSWORD_REQUIRED',
    'RETRY_AVAILABLE',
    'CORRUPTED_FILE',
    'CANCELLED',
  ],

  PASSWORD_REQUIRED: [
    'ENGINE_INITIALIZATION',
    'CANCELLED',
  ],

  RENDERING: [
    'READY',
    'RETRY_AVAILABLE',
    'CORRUPTED_FILE',
    'CANCELLED',
  ],

  READY: [
    'RENDERING',
    'IDLE',
    'CANCELLED',
  ],

  RETRY_AVAILABLE: [
    'ACCESS_CHECK',
    'FILE_VALIDATION',
    'ENGINE_INITIALIZATION',
    'RENDERING',
    'CANCELLED',
  ],

  UNSUPPORTED_FORMAT: [
    'IDLE',
    'CANCELLED',
  ],

  CORRUPTED_FILE: [
    'IDLE',
    'CANCELLED',
  ],

  RESOURCE_LIMIT_REACHED: [
    'IDLE',
    'CANCELLED',
  ],

  CANCELLED: [
    'IDLE',
    'ACCESS_CHECK',
  ],
};

export type FileOpeningAction =
  | { type: 'START_OPEN'; payload: { filePath: string; fileName: string; category?: string } }
  | { type: 'ACCESS_CHECK_PASS' }
  | { type: 'ACCESS_CHECK_FAIL' }
  | { type: 'VALIDATION_PASS'; payload: { resolvedPath: string; fileSize?: number } }
  | { type: 'VALIDATION_FAIL_LIMIT'; payload: { error: string } }
  | { type: 'VALIDATION_FAIL_CORRUPTED'; payload: { error: string } }
  | { type: 'VALIDATION_FAIL_RETRY'; payload: { error: string } }
  | { type: 'TYPE_DETECTED'; payload: { category: string; formatType?: string; mimeType?: string } }
  | { type: 'TYPE_UNKNOWN'; payload: { error: string } }
  | { type: 'ENGINE_INITIALIZED' }
  | { type: 'ENGINE_PASSWORD_NEEDED' }
  | { type: 'SUBMIT_PASSWORD'; payload: { password: string } }
  | { type: 'RENDER_SUCCESS' }
  | { type: 'RENDER_FAIL'; payload: { error: string; canRetry?: boolean } }
  | { type: 'RETRY' }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

export interface FileOpeningStateMachineState {
  state: FileOpeningState;
  context: FileOpeningContext;
}

export const INITIAL_CONTEXT: FileOpeningContext = {
  filePath: '',
  fileName: '',
  resolvedLocalPath: undefined,
  category: undefined,
  formatType: undefined,
  mimeType: undefined,
  fileSize: undefined,
  password: undefined,
  error: undefined,
  retryCount: 0,
};

export const INITIAL_STATE_MACHINE: FileOpeningStateMachineState = {
  state: 'IDLE',
  context: INITIAL_CONTEXT,
};

/**
 * Validates whether state transition from current to target is allowed
 */
export function canTransition(current: FileOpeningState, target: FileOpeningState): boolean {
  const allowed = VALID_TRANSITIONS[current];
  return allowed ? allowed.includes(target) : false;
}

/**
 * Pure State Reducer enforcing transition table
 */
export function fileOpeningReducer(
  prev: FileOpeningStateMachineState,
  action: FileOpeningAction
): FileOpeningStateMachineState {
  switch (action.type) {
    case 'START_OPEN': {
      if (!canTransition(prev.state, 'ACCESS_CHECK')) {
        console.warn(`[FSM 5.2] Invalid transition ${prev.state} -> ACCESS_CHECK ignored.`);
        return prev;
      }
      return {
        state: 'ACCESS_CHECK',
        context: {
          ...INITIAL_CONTEXT,
          filePath: action.payload.filePath,
          fileName: action.payload.fileName,
          category: action.payload.category,
        },
      };
    }

    case 'ACCESS_CHECK_PASS': {
      if (!canTransition(prev.state, 'FILE_VALIDATION')) return prev;
      return {
        ...prev,
        state: 'FILE_VALIDATION',
      };
    }

    case 'ACCESS_CHECK_FAIL': {
      if (!canTransition(prev.state, 'ACCESS_REQUIRED')) return prev;
      return {
        ...prev,
        state: 'ACCESS_REQUIRED',
        context: {
          ...prev.context,
          error: 'Storage permission required to read this file.',
        },
      };
    }

    case 'VALIDATION_PASS': {
      if (!canTransition(prev.state, 'TYPE_DETECTION')) return prev;
      return {
        ...prev,
        state: 'TYPE_DETECTION',
        context: {
          ...prev.context,
          resolvedLocalPath: action.payload.resolvedPath,
          fileSize: action.payload.fileSize,
        },
      };
    }

    case 'VALIDATION_FAIL_LIMIT': {
      if (!canTransition(prev.state, 'RESOURCE_LIMIT_REACHED')) return prev;
      return {
        ...prev,
        state: 'RESOURCE_LIMIT_REACHED',
        context: {
          ...prev.context,
          error: action.payload.error,
        },
      };
    }

    case 'VALIDATION_FAIL_CORRUPTED': {
      if (!canTransition(prev.state, 'CORRUPTED_FILE')) return prev;
      return {
        ...prev,
        state: 'CORRUPTED_FILE',
        context: {
          ...prev.context,
          error: action.payload.error,
        },
      };
    }

    case 'VALIDATION_FAIL_RETRY': {
      if (!canTransition(prev.state, 'RETRY_AVAILABLE')) return prev;
      return {
        ...prev,
        state: 'RETRY_AVAILABLE',
        context: {
          ...prev.context,
          error: action.payload.error,
        },
      };
    }

    case 'TYPE_DETECTED': {
      if (!canTransition(prev.state, 'ENGINE_INITIALIZATION')) return prev;
      return {
        ...prev,
        state: 'ENGINE_INITIALIZATION',
        context: {
          ...prev.context,
          category: action.payload.category,
          formatType: action.payload.formatType,
          mimeType: action.payload.mimeType,
        },
      };
    }

    case 'TYPE_UNKNOWN': {
      if (!canTransition(prev.state, 'UNSUPPORTED_FORMAT')) return prev;
      return {
        ...prev,
        state: 'UNSUPPORTED_FORMAT',
        context: {
          ...prev.context,
          error: action.payload.error,
        },
      };
    }

    case 'ENGINE_INITIALIZED': {
      if (!canTransition(prev.state, 'RENDERING')) return prev;
      return {
        ...prev,
        state: 'RENDERING',
      };
    }

    case 'ENGINE_PASSWORD_NEEDED': {
      if (!canTransition(prev.state, 'PASSWORD_REQUIRED')) return prev;
      return {
        ...prev,
        state: 'PASSWORD_REQUIRED',
      };
    }

    case 'SUBMIT_PASSWORD': {
      if (!canTransition(prev.state, 'ENGINE_INITIALIZATION')) return prev;
      return {
        ...prev,
        state: 'ENGINE_INITIALIZATION',
        context: {
          ...prev.context,
          password: action.payload.password,
        },
      };
    }

    case 'RENDER_SUCCESS': {
      if (!canTransition(prev.state, 'READY')) return prev;
      return {
        ...prev,
        state: 'READY',
        context: {
          ...prev.context,
          error: undefined,
        },
      };
    }

    case 'RENDER_FAIL': {
      const nextTarget = action.payload.canRetry ? 'RETRY_AVAILABLE' : 'CORRUPTED_FILE';
      if (!canTransition(prev.state, nextTarget)) return prev;
      return {
        ...prev,
        state: nextTarget,
        context: {
          ...prev.context,
          error: action.payload.error,
        },
      };
    }

    case 'RETRY': {
      if (!canTransition(prev.state, 'ACCESS_CHECK')) return prev;
      return {
        ...prev,
        state: 'ACCESS_CHECK',
        context: {
          ...prev.context,
          retryCount: prev.context.retryCount + 1,
          error: undefined,
        },
      };
    }

    case 'CANCEL': {
      return {
        ...prev,
        state: 'CANCELLED',
      };
    }

    case 'RESET': {
      return INITIAL_STATE_MACHINE;
    }

    default:
      return prev;
  }
}


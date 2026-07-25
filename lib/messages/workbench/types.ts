import type { WorkbenchSessionStatus } from './session-client'

export type WorkbenchTab = 'files' | 'terminal' | 'browser' | 'changes'

export type WorkbenchTerminalStatus = 'running' | 'done' | 'failed' | 'info'

/** Jobs = existing allowlisted one-shot commands; Session = interactive PTY (Phase 3b). */
export type WorkbenchTerminalMode = 'jobs' | 'session'

/** `WorkbenchSessionStatus` plus client-only transient/error states not reported by the server. */
export type WorkbenchSessionViewStatus = WorkbenchSessionStatus | 'idle' | 'starting' | 'error'

/** UI-facing view of an interactive session, owned by the host (e.g. `UnifiedChat`) and passed down as a prop. */
export interface WorkbenchSessionViewState {
  sessionId: string | null
  status: WorkbenchSessionViewStatus
  /** Accumulated stdout/stderr transcript — see `appendWorkbenchSessionOutput`. */
  transcript: string
  exitCode?: number | null
  /** Set on a server-reported failure or a client-side error (e.g. the session API 404s). */
  error?: string | null
  /** True while a start/kill request is in flight. */
  busy: boolean
}

export interface WorkbenchTerminalEntry {
  id: string
  status: WorkbenchTerminalStatus
  label: string
  meta: string
  body: string
  tool?: string
  timestamp?: number
}

export type WorkbenchChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown'

export interface WorkbenchChangeFile {
  path: string
  status: WorkbenchChangeStatus
  patch?: string
  preview?: string
}

export interface WorkbenchFileNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  children?: WorkbenchFileNode[]
}

export interface WorkbenchBrowserTarget {
  id: string
  url?: string
  title?: string
  imageUrl?: string
  source: 'event' | 'rich_part' | 'attachment'
}

export interface WorkbenchRuntimeSummary {
  label?: string | null
  mappingLabel?: string | null
  folderScope?: string | null
  projectName?: string | null
  runtimeTarget?: string | null
  hasMapping: boolean
}

/** Where the Files tree currently on screen came from. */
export type WorkbenchFilesSource = 'sync' | 'events' | 'none'

/** Text preview state for a single selected file in the Files panel. */
export interface WorkbenchFilePreview {
  path: string
  content: string | null
  sha256?: string
  loading: boolean
  error: string | null
}

import type { WorkbenchSessionStatus } from './session-client'
import type { WorkbenchTunnelStatus } from './tunnel-client'
import type { WorkbenchBrowserSessionStatus } from './browser-session-client'

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

/** `WorkbenchTunnelStatus` plus client-only transient/error states not reported by the server. */
export type WorkbenchTunnelViewStatus = WorkbenchTunnelStatus | 'idle' | 'starting' | 'error'

/** UI-facing view of a tunnel session (Phase 4b), owned by the host (e.g. `UnifiedChat`) and passed down as a prop. */
export interface WorkbenchTunnelViewState {
  sessionId: string | null
  status: WorkbenchTunnelViewStatus
  port: number
  publicUrl: string | null
  localUrl: string | null
  error?: string | null
  /** Latest human-readable provider progress line (e.g. cloudflared startup output), shown while the tunnel comes up. */
  progress?: string | null
  /** True while an open/approve/kill request is in flight. */
  busy: boolean
}

/** `WorkbenchBrowserSessionStatus` plus client-only transient/error states not reported by the server. */
export type WorkbenchBrowserSessionViewStatus = WorkbenchBrowserSessionStatus | 'idle' | 'starting' | 'error'

/** UI-facing view of an agent browser session (Phase 4b), owned by the host (e.g. `UnifiedChat`) and passed down as a prop. */
export interface WorkbenchBrowserSessionViewState {
  sessionId: string | null
  status: WorkbenchBrowserSessionViewStatus
  startUrl: string | null
  currentUrl: string | null
  /** Most recently captured frame's `imageUrl` — the panel follows this when "Follow session frames" is enabled. */
  latestFrameUrl: string | null
  frameCount: number
  /** Headless Chrome viewport, used to convert a percentage point on a frame into CSS pixels for click/scroll drives. */
  viewport?: { width: number; height: number } | null
  /** True while device-side frame following is on — the panel polls faster and labels the view as live. */
  following?: boolean
  /** Who created the session — 'agent' means the agent opened it and the rail should offer the tab. */
  initiator?: 'user' | 'agent'
  /** Last actor to drive the page; 'idle' until the first driving control. Drives the arbitration badge. */
  driver?: 'user' | 'agent' | 'idle'
  /** When true the agent may navigate/interact with private hosts on this session. */
  allowPrivateNetwork?: boolean
  error?: string | null
  /** True while a start/approve/navigate/capture/kill request is in flight. */
  busy: boolean
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

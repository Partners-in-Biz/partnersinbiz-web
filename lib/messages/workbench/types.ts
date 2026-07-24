export type WorkbenchTab = 'files' | 'terminal' | 'browser' | 'changes'

export type WorkbenchTerminalStatus = 'running' | 'done' | 'failed' | 'info'

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

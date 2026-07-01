export type HermesCapability =
  | 'runs'
  | 'dashboard'
  | 'cron'
  | 'models'
  | 'tools'
  | 'files'
  | 'terminal'

export type HermesCapabilities = Record<HermesCapability, boolean>

export interface HermesProfilePermissions {
  superAdmin: boolean
  restrictedAdmin: boolean
  client: boolean
  allowedUserIds: string[]
}

export interface HermesProfileLink {
  orgId: string
  profile: string
  baseUrl: string
  apiKey?: string
  dashboardBaseUrl?: string
  dashboardSessionToken?: string
  enabled: boolean
  capabilities: HermesCapabilities
  permissions: HermesProfilePermissions
  createdAt?: unknown
  updatedAt?: unknown
  createdBy?: string
  updatedBy?: string
}

export interface HermesAccessResult {
  allowed: boolean
  status?: number
  error?: string
}

export interface HermesRunRequest {
  prompt: string
  conversation_id?: string
  model?: string
  reasoning_effort?: string
  provider?: string
  temperature?: number
  max_tokens?: number
  metadata?: Record<string, unknown>
}

export type RichMessagePartType =
  | 'markdown'
  | 'code'
  | 'table'
  | 'image'
  | 'gallery'
  | 'file'
  | 'audio'
  | 'video'
  | 'tool_output'
  | 'status'
  | 'approval'
  | 'approval_card'
  | 'clarify'
  | 'model_picker'

export type RichMessageChoice = string | {
  id?: string
  label?: string
  value?: string
  [key: string]: unknown
}

export type RichModelOption = {
  id: string
  label?: string
  provider?: string
  description?: string
  [key: string]: unknown
}

export type RichMessagePart = {
  type: RichMessagePartType | string
  id?: string
  title?: string
  content?: string
  markdown?: string
  code?: string
  language?: string
  caption?: string
  columns?: string[]
  rows?: Array<Record<string, unknown> | unknown[]>
  images?: Array<{ url: string; alt?: string; caption?: string; [key: string]: unknown }>
  url?: string
  alt?: string
  name?: string
  mimeType?: string
  sizeBytes?: number
  tool?: string
  output?: string
  stdout?: string
  stderr?: string
  status?: string
  tone?: string
  body?: string
  actionId?: string
  question?: string
  choices?: RichMessageChoice[]
  models?: RichModelOption[]
  providers?: string[]
  evidence?: string[]
  decisions?: Array<string | { label?: string; value?: string; required?: boolean; [key: string]: unknown }>
  recommendation?: string
  safetyNote?: string
  replyTemplate?: string
  dataSkill?: string
  analysisQuestion?: string
  statusLabel?: string
  [key: string]: unknown
}

export type ChatUiActionType =
  | 'approve'
  | 'deny'
  | 'choose'
  | 'retry'
  | 'stop'
  | 'open'
  | 'copy'
  | 'download'
  | 'custom'

export type ChatUiAction = {
  id: string
  type: ChatUiActionType | string
  label: string
  actionId?: string
  value?: unknown
  url?: string
  endpoint?: string
  method?: string
  payload?: Record<string, unknown>
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | string
  [key: string]: unknown
}

export type ChatEvent = {
  event?: string
  tool?: string
  preview?: string
  input?: string
  output?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  timestamp?: number
  runId?: string
  run_id?: string
  delta?: string
  text?: string
  activity?: string
  title?: string
  status?: string
  duration?: number
  durationMs?: number
  error?: boolean | string
  choices?: string[]
  todos?: unknown[]
  actionId?: string
  richParts?: RichMessagePart[]
  uiActions?: ChatUiAction[]
  raw?: Record<string, unknown>
}

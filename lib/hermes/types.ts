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
  runtimeTargetId?: string
  runtimeKind?: 'local' | 'vps' | 'remote' | 'legacy' | 'linked-computer'
  machineLabel?: string
  /** Opaque server-side binding to the concrete selected host/transport. */
  transportIdentity?: string
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
  working_directory?: string
  working_directory_root?: string
  model?: string
  reasoning_effort?: string
  provider?: string
  temperature?: number
  max_tokens?: number
  /** Hermes YOLO / approvals.mode off for this run when supported. */
  yolo?: boolean
  metadata?: Record<string, unknown>
  /** Server-resolved routing identity. This is never forwarded to Hermes. */
  dispatch?: { requestedRuntimeTargetId?: string }
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
  | 'project_task_proposal'
  | 'studio_artifact'
  | 'studio_artifact_bundle'
  | 'workspace_panel'
  | 'agent_delegation_branch'
  | 'project_command_event'
  | 'design_audit'
  | 'design_iteration'
  | 'chart'
  | 'mermaid'
  | 'math'
  | 'html_artifact'
  | 'browser_frame'
  | 'system_event'
  | 'action_card'
  | 'routine_proposal'

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
  artifactId?: string
  artifactIds?: string[]
  artifacts?: Array<{ id: string; contextId: string }>
  contextId?: string
  eyebrow?: string
  metrics?: Array<{ label?: string; value?: string | number; detail?: string }>
  sections?: Array<{ heading?: string; title?: string; body?: string; content?: string; items?: string[] }>
  [key: string]: unknown
}

export type ChatUiActionType =
  | 'approve'
  | 'deny'
  | 'choose'
  | 'retry'
  | 'stop'
  | 'open'
  | 'open_context'
  | 'open_workbench_browser'
  | 'copy'
  | 'download'
  | 'create_routine'
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
  /**
   * How the Messages client serializes the request body for custom endpoints.
   * - envelope (default): { actionId, type, value, payload } — Hermes run actions
   * - payload: send payload as the JSON body (human-session API calls such as
   *   Decision Brief confirm, which agents cannot perform)
   */
  bodyMode?: 'envelope' | 'payload' | string
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

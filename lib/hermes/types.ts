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
}

import type { CommunicationChannel, CommunicationProviderId } from '../types'

export interface ProviderReadiness {
  configured: boolean
  healthy: boolean
  missing: string[]
  checks: Array<{
    id: string
    label: string
    status: 'pass' | 'warn' | 'fail'
    detail?: string
  }>
}

export interface ProviderSendInput {
  orgId: string
  channel: CommunicationChannel
  to: string
  body: string
  subject?: string
  html?: string
  from?: string
  mediaUrls?: string[]
  statusCallbackUrl?: string
  metadata?: Record<string, unknown>
}

export interface ProviderSendResult {
  ok: boolean
  providerMessageId?: string
  status: 'sent' | 'queued' | 'dry_run' | 'failed' | 'unsupported'
  error?: string
  costUsd?: number
  raw?: Record<string, unknown>
}

export interface CommunicationProvider {
  id: CommunicationProviderId
  name: string
  supports: CommunicationChannel[]
  getReadiness: (env?: Record<string, string | undefined>) => ProviderReadiness
  send?: (input: ProviderSendInput) => Promise<ProviderSendResult>
}

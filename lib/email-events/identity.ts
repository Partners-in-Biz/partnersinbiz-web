import { createHash } from 'crypto'
import type { EmailEventIdentity, EmailEventInput } from './types'

function normalized(value: unknown): unknown {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (Array.isArray(value)) return value.map((item) => normalized(item) ?? null)
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalized(child)]),
    )
  }
  return String(value)
}

export function canonicalizeEventMetadata(value: unknown): string {
  return JSON.stringify(normalized(value))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function uniqueDiscriminator(input: EmailEventInput): string {
  if (input.event === 'clicked') return input.linkId || input.url || '*'
  if (input.event === 'converted') return String(input.metadata?.conversionId ?? '*')
  return '*'
}

/** Stable across webhook retries while remaining tenant-scoped. */
export function buildEmailEventIdentity(input: EmailEventInput): EmailEventIdentity {
  const providerEventId = input.providerEventId?.trim()
  const fallback = {
    providerMessageId: input.providerMessageId.trim(),
    event: input.event,
    providerTimestamp: input.providerTimestamp || '',
    url: input.url || '',
    linkId: input.linkId || '',
    recipient: input.recipient?.trim().toLowerCase() || '',
    metadata: input.metadata ?? {},
  }
  const deduplicationKey = providerEventId
    ? `${input.orgId}:${input.provider}:event:${providerEventId}`
    : `${input.orgId}:${input.provider}:derived:${sha256(canonicalizeEventMetadata(fallback))}`
  const uniqueEventKey = [
    input.orgId,
    input.messageId,
    input.event,
    uniqueDiscriminator(input),
  ].join(':')

  return {
    id: `evt_${sha256(deduplicationKey).slice(0, 40)}`,
    deduplicationKey,
    uniqueEventKey,
  }
}

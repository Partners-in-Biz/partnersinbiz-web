import { createHash } from 'crypto'

import type {
  ChatContextAction,
  ChatContextActionReceipt,
  ChatContextReadModel,
  ChatContextReference,
} from '@/lib/chat-context/types'

const ACTION_METHODS = new Set<NonNullable<ChatContextAction['method']>>([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
])

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function cleanJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > 20_000) return undefined
    return JSON.parse(serialized) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  )
}

export function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value))
}

export function parseSubmittedChatContextAction(value: unknown): ChatContextAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const id = cleanText(raw.id, 160)
  const label = cleanText(raw.label, 240)
  const href = cleanText(raw.href, 1000)
  const method = typeof raw.method === 'string' ? raw.method.toUpperCase() : ''
  if (!id || !label || !href || !ACTION_METHODS.has(method as NonNullable<ChatContextAction['method']>)) return null
  if (raw.body !== undefined && cleanJsonObject(raw.body) === undefined) return null
  return {
    id,
    label,
    href,
    method: method as NonNullable<ChatContextAction['method']>,
    ...(raw.destructive === true ? { destructive: true } : {}),
    ...(raw.requiresApproval === true ? { requiresApproval: true } : {}),
    ...(raw.body !== undefined ? { body: cleanJsonObject(raw.body)! } : {}),
  }
}

export function parseSubmittedChatContextReference(value: unknown): ChatContextReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const kind = cleanText(raw.kind, 80) as ChatContextReference['kind']
  const id = cleanText(raw.id, 200)
  const projectId = cleanText(raw.projectId, 200)
  if (!kind || !id) return null
  return { kind, id, ...(projectId ? { projectId } : {}) }
}

export function collectChatContextActions(model: ChatContextReadModel): ChatContextAction[] {
  return [
    ...model.groups.flatMap((group) => group.items.flatMap((item) => item.actions ?? [])),
    ...model.artifacts.flatMap((artifact) => artifact.actions),
    ...model.attention.flatMap((item) => item.actions ?? []),
  ].filter((action) => Boolean(action.href && action.method))
}

export function findAuthoritativeChatContextAction(
  model: ChatContextReadModel,
  submitted: ChatContextAction,
): ChatContextAction | null {
  const submittedSnapshot = stableJson(submitted)
  return collectChatContextActions(model).find((candidate) => {
    const parsed = parseSubmittedChatContextAction(candidate)
    return parsed && stableJson(parsed) === submittedSnapshot
  }) ?? null
}

export function validateCanonicalActionTarget(action: ChatContextAction): URL | null {
  if (!action.href || !action.href.startsWith('/api/v1/') || action.href.startsWith('//')) return null
  if (!action.method || !ACTION_METHODS.has(action.method)) return null
  let target: URL
  try {
    target = new URL(action.href, 'https://chat-action.internal')
  } catch {
    return null
  }
  if (target.origin !== 'https://chat-action.internal') return null
  if (target.pathname.includes('/context-actions')) return null
  return target
}

export function chatActionReceiptId(input: {
  orgId: string
  uid: string
  conversationId: string
  idempotencyKey: string
}): string {
  return createHash('sha256')
    .update([input.orgId, input.uid, input.conversationId, input.idempotencyKey].join('\u001f'))
    .digest('hex')
}

export function chatContextModelVersion(model: ChatContextReadModel): string {
  const explicit = model.preview?.version
    ?? model.artifacts.find((artifact) => artifact.version)?.version
  return explicit || model.asOf
}

export function canonicalResponseEvidence(input: {
  responseText: string
  responseBody: unknown
  location?: string | null
}): Pick<ChatContextActionReceipt, 'responseDigest' | 'referenceIds' | 'resultHref'> {
  const responseDigest = createHash('sha256').update(input.responseText).digest('hex')
  const body = input.responseBody && typeof input.responseBody === 'object'
    ? input.responseBody as Record<string, unknown>
    : {}
  const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data as Record<string, unknown>
    : body
  const referenceIds = Object.fromEntries(
    ['id', 'runId', 'jobId', 'exportId', 'taskId', 'artifactId']
      .flatMap((key) => typeof data[key] === 'string' && data[key]
        ? [[key, (data[key] as string).slice(0, 300)]]
        : []),
  )
  const candidateHref = [input.location, data.href, data.url]
    .find((value): value is string => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//'))
  return {
    responseDigest,
    ...(Object.keys(referenceIds).length ? { referenceIds } : {}),
    ...(candidateHref ? { resultHref: candidateHref.slice(0, 1000) } : {}),
  }
}

export function publicChatActionReceipt(value: Record<string, unknown>): ChatContextActionReceipt {
  const receipt = { ...value }
  delete receipt.idempotencyKey
  delete receipt.expiresAt
  return receipt as unknown as ChatContextActionReceipt
}

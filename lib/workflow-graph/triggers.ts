/**
 * Trigger adapters: manual (existing POST), Hermes cron, domain events.
 * Pure matching + idempotency helpers live in ops.ts; this module orchestrates starts.
 */
import {
  cronTriggerIdempotencyKey,
  cronWindowBucket,
  domainEventIdempotencyKey,
  matchCronTemplates,
  matchDomainEventTemplates,
} from './ops'
import { listGraphTemplates } from './store'
import { startWorkflowRun } from './service'
import type { GraphTemplate } from './types'
import { buildOpsInspect } from './ops'

const SUPPORTED_DOMAIN_EVENTS = [
  'task.completed',
  'document.approved',
  'deal.stage_changed',
  'social.post_failed',
] as const

export type SupportedDomainEvent = (typeof SUPPORTED_DOMAIN_EVENTS)[number]

export function isSupportedDomainEvent(eventType: string): boolean {
  return (SUPPORTED_DOMAIN_EVENTS as readonly string[]).includes(eventType)
}

export function listSupportedDomainEvents(): string[] {
  return [...SUPPORTED_DOMAIN_EVENTS]
}

export async function handleDomainEventTrigger(input: {
  orgId: string
  eventType: string
  eventId: string
  projectId?: string
  actorUid?: string
  payload?: Record<string, unknown>
  /** Optional preloaded templates (tests). */
  templates?: GraphTemplate[]
}): Promise<{
  ok: true
  eventType: string
  matched: number
  started: Array<{ templateId: string; runId?: string; deduplicated?: boolean; inspect?: ReturnType<typeof buildOpsInspect> }>
  skipped: Array<{ templateId: string; reason: string }>
} | { ok: false; error: string; status: number }> {
  const eventType = input.eventType.trim()
  const eventId = input.eventId.trim()
  if (!eventType || !eventId) return { ok: false, error: 'eventType and eventId are required', status: 400 }
  if (!isSupportedDomainEvent(eventType)) {
    return {
      ok: false,
      error: `Unsupported eventType. Supported: ${SUPPORTED_DOMAIN_EVENTS.join(', ')}`,
      status: 400,
    }
  }

  const templates = input.templates ?? await listGraphTemplates(input.orgId, 100)
  const matched = matchDomainEventTemplates(templates, eventType)
  const started: Array<{ templateId: string; runId?: string; deduplicated?: boolean; inspect?: ReturnType<typeof buildOpsInspect> }> = []
  const skipped: Array<{ templateId: string; reason: string }> = []

  for (const template of matched) {
    if (!template.id) {
      skipped.push({ templateId: 'unknown', reason: 'missing_template_id' })
      continue
    }
    if (template.status !== 'active') {
      skipped.push({ templateId: template.id, reason: `template_status_${template.status}` })
      continue
    }
    const projectId = input.projectId || template.projectId
    if (!projectId) {
      skipped.push({ templateId: template.id, reason: 'missing_projectId' })
      continue
    }
    const idempotencyKey = domainEventIdempotencyKey({
      orgId: input.orgId,
      templateId: template.id,
      eventType,
      eventId,
    })
    const result = await startWorkflowRun({
      orgId: input.orgId,
      templateId: template.id,
      projectId,
      actorUid: input.actorUid || 'domain-event',
      trigger: { type: 'domain_event', ref: `${eventType}:${eventId}` },
      idempotencyKey,
    })
    if (!result.ok) {
      skipped.push({ templateId: template.id, reason: result.error })
      continue
    }
    started.push({
      templateId: template.id,
      runId: result.run.id,
      deduplicated: result.deduplicated,
      inspect: buildOpsInspect(result.run),
    })
  }

  return {
    ok: true,
    eventType,
    matched: matched.length,
    started,
    skipped,
  }
}

export async function handleCronTriggerTick(input: {
  orgId?: string
  actorUid?: string
  now?: Date
  /** Optional preloaded templates for a single org (tests). */
  templates?: GraphTemplate[]
  listTemplates?: (orgId: string) => Promise<GraphTemplate[]>
}): Promise<{
  ok: true
  windowBucket: string
  processed: number
  started: Array<{ orgId: string; templateId: string; runId?: string; deduplicated?: boolean }>
  skipped: Array<{ orgId: string; templateId: string; reason: string }>
}> {
  const now = input.now || new Date()
  const windowBucket = cronWindowBucket(now)
  const started: Array<{ orgId: string; templateId: string; runId?: string; deduplicated?: boolean }> = []
  const skipped: Array<{ orgId: string; templateId: string; reason: string }> = []

  const orgId = input.orgId
  if (!orgId) {
    return { ok: true, windowBucket, processed: 0, started, skipped: [{ orgId: '', templateId: '', reason: 'orgId_required_for_v0_cron' }] }
  }

  const templates = input.templates
    ?? (input.listTemplates ? await input.listTemplates(orgId) : await listGraphTemplates(orgId, 100))
  const cronTemplates = matchCronTemplates(templates)

  for (const template of cronTemplates) {
    if (!template.id) {
      skipped.push({ orgId, templateId: 'unknown', reason: 'missing_template_id' })
      continue
    }
    if (template.status !== 'active') {
      skipped.push({ orgId, templateId: template.id, reason: `template_status_${template.status}` })
      continue
    }
    const projectId = template.projectId
    if (!projectId) {
      skipped.push({ orgId, templateId: template.id, reason: 'missing_projectId' })
      continue
    }
    const idempotencyKey = cronTriggerIdempotencyKey({
      orgId,
      templateId: template.id,
      windowBucket,
    })
    const result = await startWorkflowRun({
      orgId,
      templateId: template.id,
      projectId,
      actorUid: input.actorUid || 'cron',
      trigger: { type: 'cron', ref: `${template.triggers.find((t) => t.type === 'cron')?.cron || 'cron'}:${windowBucket}` },
      idempotencyKey,
    })
    if (!result.ok) {
      skipped.push({ orgId, templateId: template.id, reason: result.error })
      continue
    }
    started.push({
      orgId,
      templateId: template.id,
      runId: result.run.id,
      deduplicated: result.deduplicated,
    })
  }

  return {
    ok: true,
    windowBucket,
    processed: started.length,
    started,
    skipped,
  }
}

export type { OpsListItem } from './ops'

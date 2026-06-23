// app/api/v1/capture-sources/route.ts
//
// GET  /api/v1/capture-sources?orgId=...&active=...  — list lead-capture sources
// POST /api/v1/capture-sources                        — create a lead-capture source
//
// This is the v2 "lead capture" system. It is distinct from the legacy
// /api/v1/crm/capture-sources endpoints (which use a `publicKey` and the
// `capture_sources` collection). Data lives in `lead_capture_sources`.

import { NextRequest } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { withAuth } from '@/lib/api/auth'
import { resolveOrgScope } from '@/lib/api/orgScope'
import { apiSuccess, apiError } from '@/lib/api/response'
import { actorFrom } from '@/lib/api/actor'
import { withIdempotency } from '@/lib/api/idempotency'
import type { ApiUser } from '@/lib/api/types'
import {
  CaptureSource,
  DEFAULT_WIDGET_THEME,
  DEFAULT_RATE_LIMIT,
  DEFAULT_BLOCK_STATS,
  DEFAULT_DISPLAY_CONFIG,
  LEAD_CAPTURE_SOURCES,
  VALID_CAPTURE_TYPES,
  VALID_FIELD_TYPES,
  type CaptureField,
  type CaptureSourceRateLimit,
  type CaptureSourceType,
  type CaptureWidgetTheme,
  type DoubleOptInMode,
  type WidgetDisplayConfig,
  type WidgetDisplayMode,
  type WidgetDisplayStep,
  type WidgetPosition,
} from '@/lib/lead-capture/types'

const VALID_DISPLAY_MODES: WidgetDisplayMode[] = [
  'inline',
  'popup',
  'slide-in',
  'exit-intent',
  'multi-step',
]
const VALID_POSITIONS: WidgetPosition[] = [
  'center',
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
]

function sanitizeDisplaySteps(input: unknown): WidgetDisplayStep[] {
  if (!Array.isArray(input)) return []
  return input
    .map((raw): WidgetDisplayStep | null => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const headingText = typeof r.headingText === 'string' ? r.headingText : ''
      const subheadingText = typeof r.subheadingText === 'string' ? r.subheadingText : ''
      const buttonText = typeof r.buttonText === 'string' && r.buttonText.trim()
        ? r.buttonText.trim()
        : 'Continue'
      const fieldsArr = Array.isArray(r.fields)
        ? r.fields.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : []
      return { headingText, subheadingText, buttonText, fields: fieldsArr }
    })
    .filter((s): s is WidgetDisplayStep => s !== null)
}

function sanitizeDisplay(input: unknown): WidgetDisplayConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_DISPLAY_CONFIG }
  const r = input as Record<string, unknown>
  const mode = (typeof r.mode === 'string' ? r.mode : 'inline') as WidgetDisplayMode
  const safeMode = VALID_DISPLAY_MODES.includes(mode) ? mode : 'inline'
  const out: WidgetDisplayConfig = { mode: safeMode }
  if (typeof r.triggerDelaySeconds === 'number' && r.triggerDelaySeconds >= 0 && r.triggerDelaySeconds <= 3600) {
    out.triggerDelaySeconds = Math.floor(r.triggerDelaySeconds)
  }
  if (typeof r.triggerScrollPercent === 'number' && r.triggerScrollPercent >= 0 && r.triggerScrollPercent <= 100) {
    out.triggerScrollPercent = Math.floor(r.triggerScrollPercent)
  }
  if (typeof r.triggerPagesViewed === 'number' && r.triggerPagesViewed >= 0 && r.triggerPagesViewed <= 1000) {
    out.triggerPagesViewed = Math.floor(r.triggerPagesViewed)
  }
  if (typeof r.triggerOnExitIntent === 'boolean') out.triggerOnExitIntent = r.triggerOnExitIntent
  if (typeof r.dismissCooldownDays === 'number' && r.dismissCooldownDays >= 0 && r.dismissCooldownDays <= 3650) {
    out.dismissCooldownDays = Math.floor(r.dismissCooldownDays)
  }
  if (typeof r.suppressForSubscribedDays === 'number' && r.suppressForSubscribedDays >= 0 && r.suppressForSubscribedDays <= 3650) {
    out.suppressForSubscribedDays = Math.floor(r.suppressForSubscribedDays)
  }
  if (Array.isArray(r.showOnPaths)) {
    out.showOnPaths = r.showOnPaths.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  }
  if (Array.isArray(r.hideOnPaths)) {
    out.hideOnPaths = r.hideOnPaths.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
  }
  if (typeof r.position === 'string' && VALID_POSITIONS.includes(r.position as WidgetPosition)) {
    out.position = r.position as WidgetPosition
  }
  if (r.steps !== undefined) out.steps = sanitizeDisplaySteps(r.steps)
  return out
}

function sanitizeRateLimit(input: unknown): CaptureSourceRateLimit {
  if (!input || typeof input !== 'object') return { ...DEFAULT_RATE_LIMIT }
  const r = input as Record<string, unknown>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_RATE_LIMIT.enabled,
    maxPerHourPerIp:
      typeof r.maxPerHourPerIp === 'number' && r.maxPerHourPerIp > 0
        ? Math.floor(r.maxPerHourPerIp)
        : DEFAULT_RATE_LIMIT.maxPerHourPerIp,
    maxPerDayPerEmail:
      typeof r.maxPerDayPerEmail === 'number' && r.maxPerDayPerEmail > 0
        ? Math.floor(r.maxPerDayPerEmail)
        : DEFAULT_RATE_LIMIT.maxPerDayPerEmail,
  }
}

export const dynamic = 'force-dynamic'

function sanitizeFields(input: unknown): CaptureField[] {
  if (!Array.isArray(input)) return []
  return input
    .map((raw): CaptureField | null => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const key = typeof r.key === 'string' ? r.key.trim() : ''
      const label = typeof r.label === 'string' ? r.label.trim() : ''
      const type = (typeof r.type === 'string' ? r.type : 'text') as CaptureField['type']
      if (!key || !label) return null
      if (!VALID_FIELD_TYPES.includes(type)) return null
      const field: CaptureField = {
        key,
        label,
        type,
        required: r.required === true,
      }
      if (typeof r.placeholder === 'string') field.placeholder = r.placeholder
      if (Array.isArray(r.options)) {
        field.options = r.options.filter((o): o is string => typeof o === 'string')
      }
      return field
    })
    .filter((f): f is CaptureField => f !== null)
}

function sanitizeTheme(input: unknown): CaptureWidgetTheme {
  if (!input || typeof input !== 'object') return { ...DEFAULT_WIDGET_THEME }
  const r = input as Record<string, unknown>
  return {
    primaryColor: typeof r.primaryColor === 'string' ? r.primaryColor : DEFAULT_WIDGET_THEME.primaryColor,
    textColor: typeof r.textColor === 'string' ? r.textColor : DEFAULT_WIDGET_THEME.textColor,
    backgroundColor: typeof r.backgroundColor === 'string' ? r.backgroundColor : DEFAULT_WIDGET_THEME.backgroundColor,
    borderRadius: typeof r.borderRadius === 'number' ? r.borderRadius : DEFAULT_WIDGET_THEME.borderRadius,
    buttonText: typeof r.buttonText === 'string' && r.buttonText.trim() ? r.buttonText : DEFAULT_WIDGET_THEME.buttonText,
    headingText: typeof r.headingText === 'string' && r.headingText.trim() ? r.headingText : DEFAULT_WIDGET_THEME.headingText,
    subheadingText: typeof r.subheadingText === 'string' ? r.subheadingText : DEFAULT_WIDGET_THEME.subheadingText,
  }
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
}

// US-091: only accept http(s) webhook URLs; everything else → '' (disabled).
function sanitizeWebhookUrl(v: unknown): string {
  if (typeof v !== 'string') return ''
  const trimmed = v.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
    return trimmed
  } catch {
    return ''
  }
}

export const GET = withAuth('client', async (req: NextRequest, user: ApiUser) => {
  const { searchParams } = new URL(req.url)
  const scope = resolveOrgScope(user, searchParams.get('orgId'))
  if (!scope.ok) return apiError(scope.error, scope.status)
  const orgId = scope.orgId
  const activeParam = searchParams.get('active')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 200)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1'), 1)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = await (adminDb.collection(LEAD_CAPTURE_SOURCES) as any)
    .where('orgId', '==', orgId)
    .get()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: CaptureSource[] = snap.docs
    .map((d: any) => ({ id: d.id, ...d.data() }) as CaptureSource)
    .filter((s: CaptureSource) => s.deleted !== true)

  if (activeParam === 'true') data = data.filter((s) => s.active === true)
  else if (activeParam === 'false') data = data.filter((s) => s.active === false)

  data.sort((a, b) => {
    const ams = (a.createdAt as { _seconds?: number; seconds?: number } | null)?._seconds
      ?? (a.createdAt as { seconds?: number } | null)?.seconds ?? 0
    const bms = (b.createdAt as { _seconds?: number; seconds?: number } | null)?._seconds
      ?? (b.createdAt as { seconds?: number } | null)?.seconds ?? 0
    return bms - ams
  })

  const total = data.length
  data = data.slice((page - 1) * limit, page * limit)

  return apiSuccess(data, 200, { total, page, limit })
})

export const POST = withAuth(
  'client',
  withIdempotency(async (req: NextRequest, user: ApiUser) => {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return apiError('Invalid JSON body', 400)

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const type = body.type as CaptureSourceType | undefined
    if (!name) return apiError('name is required', 400)
    if (!type || !VALID_CAPTURE_TYPES.includes(type)) {
      return apiError(`type must be one of: ${VALID_CAPTURE_TYPES.join(', ')}`, 400)
    }

    const requestedOrgId = typeof body.orgId === 'string' ? body.orgId.trim() : null
    const scope = resolveOrgScope(user, requestedOrgId)
    if (!scope.ok) return apiError(scope.error, scope.status)
    const orgId = scope.orgId

    const doubleOptIn: DoubleOptInMode = body.doubleOptIn === 'on' ? 'on' : 'off'

    const docData = {
      orgId,
      name,
      type,
      doubleOptIn,
      confirmationSubject: typeof body.confirmationSubject === 'string' ? body.confirmationSubject : '',
      confirmationBodyHtml: typeof body.confirmationBodyHtml === 'string' ? body.confirmationBodyHtml : '',
      successMessage:
        typeof body.successMessage === 'string' && body.successMessage.trim()
          ? body.successMessage
          : 'Thanks — you are subscribed!',
      successRedirectUrl: typeof body.successRedirectUrl === 'string' ? body.successRedirectUrl : '',
      fields: sanitizeFields(body.fields),
      tagsToApply: strArray(body.tagsToApply),
      campaignIdsToEnroll: strArray(body.campaignIdsToEnroll),
      sequenceIdsToEnroll: strArray(body.sequenceIdsToEnroll),
      notifyEmails: strArray(body.notifyEmails),
      widgetTheme: sanitizeTheme(body.widgetTheme),
      active: body.active === false ? false : true,
      // Spam protection defaults — secure-by-default, requires explicit opt-in
      // for Turnstile only (which needs a site key).
      turnstileEnabled: body.turnstileEnabled === true,
      turnstileSiteKey:
        typeof body.turnstileSiteKey === 'string' ? body.turnstileSiteKey.trim() : '',
      honeypotEnabled: body.honeypotEnabled === false ? false : true,
      blockDisposableEmails: body.blockDisposableEmails === false ? false : true,
      rateLimit: sanitizeRateLimit(body.rateLimit),
      stats: { blocked: { ...DEFAULT_BLOCK_STATS } },
      display: sanitizeDisplay(body.display),
      // Outbound webhook (US-091)
      webhookUrl: sanitizeWebhookUrl(body.webhookUrl),
      webhookSecret: typeof body.webhookSecret === 'string' ? body.webhookSecret.trim() : '',
      ...actorFrom(user),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
    }

    const ref = await adminDb.collection(LEAD_CAPTURE_SOURCES).add(docData)
    const created = await ref.get()
    return apiSuccess({ id: ref.id, ...created.data() }, 201)
  }),
)

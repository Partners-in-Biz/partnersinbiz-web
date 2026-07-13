import { createHash } from 'node:crypto'
import type {
  CaptureAttributionKey,
  CaptureField,
  CaptureFieldCondition,
  CaptureFieldConditionOperator,
} from '@/lib/lead-capture/types'
import { VALID_FIELD_TYPES } from '@/lib/lead-capture/types'

const ATTRIBUTION_KEYS: CaptureAttributionKey[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'landingPage',
  'campaignId',
  'programId',
  'gclid',
  'fbclid',
  'msclkid',
  'ttclid',
]

const CONDITION_OPERATORS: CaptureFieldConditionOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'is_set',
]

function cleanCondition(input: unknown): CaptureFieldCondition | undefined {
  if (!input || typeof input !== 'object') return undefined
  const raw = input as Record<string, unknown>
  const fieldKey = typeof raw.fieldKey === 'string' ? raw.fieldKey.trim() : ''
  const operator = typeof raw.operator === 'string'
    ? raw.operator as CaptureFieldConditionOperator
    : null
  if (!fieldKey || !operator || !CONDITION_OPERATORS.includes(operator)) return undefined
  const condition: CaptureFieldCondition = { fieldKey, operator }
  if (operator !== 'is_set' && typeof raw.value === 'string') condition.value = raw.value.slice(0, 500)
  return condition
}

export function sanitizeCaptureFields(input: unknown): CaptureField[] {
  if (!Array.isArray(input)) return []
  const keys = new Set<string>()
  const fields: CaptureField[] = []

  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const type = typeof raw.type === 'string' ? raw.type as CaptureField['type'] : 'text'
    if (!key || !label || keys.has(key) || !VALID_FIELD_TYPES.includes(type)) continue

    const field: CaptureField = { key, label, type, required: raw.required === true }
    if (typeof raw.placeholder === 'string') field.placeholder = raw.placeholder.slice(0, 500)
    if (Array.isArray(raw.options)) {
      field.options = raw.options
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 100)
    }
    if (
      type === 'hidden' &&
      typeof raw.attributionKey === 'string' &&
      ATTRIBUTION_KEYS.includes(raw.attributionKey as CaptureAttributionKey)
    ) {
      field.attributionKey = raw.attributionKey as CaptureAttributionKey
    }
    if (
      typeof raw.progressiveStep === 'number' &&
      Number.isInteger(raw.progressiveStep) &&
      raw.progressiveStep >= 1 &&
      raw.progressiveStep <= 20
    ) {
      field.progressiveStep = raw.progressiveStep
    }
    const showWhen = cleanCondition(raw.showWhen)
    if (showWhen && showWhen.fieldKey !== key) field.showWhen = showWhen
    keys.add(key)
    fields.push(field)
  }
  return fields
}

function conditionMatches(condition: CaptureFieldCondition, data: Record<string, unknown>): boolean {
  const actual = data[condition.fieldKey]
  const value = actual == null ? '' : String(actual)
  if (condition.operator === 'is_set') return value.trim().length > 0
  if (condition.operator === 'equals') return value === (condition.value ?? '')
  if (condition.operator === 'not_equals') return value !== (condition.value ?? '')
  return value.includes(condition.value ?? '')
}

export function resolveCaptureFields(
  fields: CaptureField[],
  submitted: Record<string, unknown>,
  attribution: Partial<Record<CaptureAttributionKey, unknown>>,
  options: { progressiveStep?: number } = {},
):
  | { ok: true; data: Record<string, string>; visibleFieldKeys: string[] }
  | { ok: false; data: Record<string, string>; errors: string[]; visibleFieldKeys: string[] } {
  const data: Record<string, string> = {}
  const errors: string[] = []
  const visibleFieldKeys: string[] = []

  for (const field of fields) {
    if (options.progressiveStep && field.progressiveStep && field.progressiveStep !== options.progressiveStep) {
      continue
    }
    if (field.type === 'hidden') {
      const trusted = field.attributionKey ? attribution[field.attributionKey] : undefined
      if (typeof trusted === 'string' && trusted.trim()) data[field.key] = trusted.trim().slice(0, 1000)
      continue
    }
    if (field.showWhen && !conditionMatches(field.showWhen, { ...submitted, ...data })) continue
    visibleFieldKeys.push(field.key)
    const raw = submitted[field.key]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (field.required && !value) errors.push(`Field "${field.label}" is required`)
    if (value) data[field.key] = value.slice(0, 5000)
  }

  return errors.length > 0
    ? { ok: false, data, errors, visibleFieldKeys }
    : { ok: true, data, visibleFieldKeys }
}

export function captureSchemaFingerprint(fields: CaptureField[]): string {
  const canonical = fields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    ...(field.options ? { options: field.options } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.attributionKey ? { attributionKey: field.attributionKey } : {}),
    ...(field.progressiveStep ? { progressiveStep: field.progressiveStep } : {}),
    ...(field.showWhen ? { showWhen: field.showWhen } : {}),
  }))
  return `schema_${createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24)}`
}

export function buildCaptureSchemaVersion(input: {
  orgId: string
  sourceId: string
  fields: CaptureField[]
}): { id: string; orgId: string; captureSourceId: string; fields: CaptureField[] } {
  return {
    id: captureSchemaFingerprint(input.fields),
    orgId: input.orgId,
    captureSourceId: input.sourceId,
    fields: input.fields,
  }
}

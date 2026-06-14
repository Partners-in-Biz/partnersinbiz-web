import type { ChatEvent, ChatUiAction, RichMessagePart, RichModelOption } from './types'

type PlainRecord = Record<string, unknown>

function asRecord(value: unknown): PlainRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PlainRecord
    : null
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function rawString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringArray(value: unknown): string[] | undefined {
  const items = arrayValue(value)
    .map((item) => cleanString(item))
    .filter((item): item is string => Boolean(item))
  return items.length > 0 ? items : undefined
}

function stripUndefinedDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item, depth + 1))
      .filter((item) => item !== undefined)
  }
  const entries = Object.entries(value as PlainRecord)
    .map(([key, item]) => [key, stripUndefinedDeep(item, depth + 1)] as const)
    .filter(([, item]) => item !== undefined)
  return Object.fromEntries(entries)
}

export function sanitizeStructuredPayload(value: unknown): PlainRecord | undefined {
  const sanitized = stripUndefinedDeep(value)
  return asRecord(sanitized) ?? undefined
}

function withRest(record: PlainRecord, knownKeys: string[], base: PlainRecord): PlainRecord {
  for (const [key, value] of Object.entries(record)) {
    if (knownKeys.includes(key) || value === undefined) continue
    base[key] = value
  }
  return sanitizeStructuredPayload(base) ?? {}
}

function normalizeImage(value: unknown): { url: string; alt?: string; caption?: string; [key: string]: unknown } | null {
  const record = asRecord(value)
  if (!record) return null
  const url = cleanString(record.url) ?? cleanString(record.src) ?? cleanString(record.imageUrl) ?? cleanString(record.image_url)
  if (!url) return null
  const base: PlainRecord = {
    url,
    alt: cleanString(record.alt) ?? cleanString(record.name),
    caption: cleanString(record.caption),
  }
  return withRest(record, ['url', 'src', 'imageUrl', 'image_url', 'alt', 'name', 'caption'], base) as { url: string; alt?: string; caption?: string; [key: string]: unknown }
}

function normalizeModel(value: unknown): RichModelOption | null {
  const record = asRecord(value)
  if (!record) return null
  const id = cleanString(record.id) ?? cleanString(record.model) ?? cleanString(record.value)
  if (!id) return null
  const base: PlainRecord = {
    id,
    label: cleanString(record.label) ?? cleanString(record.name) ?? id,
    provider: cleanString(record.provider),
    description: cleanString(record.description),
  }
  return withRest(record, ['id', 'model', 'value', 'label', 'name', 'provider', 'description'], base) as RichModelOption
}

function normalizeChoices(value: unknown): RichMessagePart['choices'] | undefined {
  const choices = arrayValue(value)
    .map((choice) => {
      if (typeof choice === 'string') return choice
      const record = asRecord(choice)
      if (!record) return null
      const label = cleanString(record.label) ?? cleanString(record.text) ?? cleanString(record.name) ?? cleanString(record.value)
      if (!label) return null
      const base: PlainRecord = {
        id: cleanString(record.id),
        label,
        value: cleanString(record.value) ?? label,
      }
      return withRest(record, ['id', 'label', 'text', 'name', 'value'], base)
    })
    .filter((choice): choice is NonNullable<RichMessagePart['choices']>[number] => Boolean(choice))
  return choices.length > 0 ? choices : undefined
}

function normalizeRows(value: unknown): unknown[][] | undefined {
  const rows = arrayValue(value)
    .map((row) => Array.isArray(row) ? row : asRecord(row) ? Object.values(row as PlainRecord) : null)
    .filter((row): row is unknown[] => Array.isArray(row))
  return rows.length > 0 ? rows : undefined
}

function normalizeRichPart(value: unknown): RichMessagePart | null {
  const record = asRecord(value)
  if (!record) return null
  const type = cleanString(record.type) ?? cleanString(record.kind)
  if (!type) return null
  const normalizedType = type.toLowerCase()
  const actionId = cleanString(record.actionId) ?? cleanString(record.action_id)
  const known = [
    'type',
    'kind',
    'id',
    'title',
    'content',
    'markdown',
    'text',
    'body',
    'code',
    'language',
    'lang',
    'caption',
    'columns',
    'headers',
    'rows',
    'images',
    'url',
    'src',
    'imageUrl',
    'image_url',
    'alt',
    'name',
    'mimeType',
    'mime_type',
    'sizeBytes',
    'size_bytes',
    'tool',
    'tool_name',
    'output',
    'stdout',
    'stderr',
    'status',
    'tone',
    'actionId',
    'action_id',
    'question',
    'choices',
    'models',
    'providers',
  ]

  const base: PlainRecord = {
    type: normalizedType,
    id: cleanString(record.id),
    title: cleanString(record.title),
    actionId,
  }

  if (normalizedType === 'markdown') {
    base.content = rawString(record.content) ?? rawString(record.markdown) ?? rawString(record.text) ?? rawString(record.body)
  } else if (normalizedType === 'code') {
    base.code = rawString(record.code) ?? rawString(record.content) ?? rawString(record.text)
    base.language = cleanString(record.language) ?? cleanString(record.lang)
  } else if (normalizedType === 'table') {
    base.caption = cleanString(record.caption) ?? cleanString(record.title)
    base.columns = stringArray(record.columns) ?? stringArray(record.headers)
    base.rows = normalizeRows(record.rows)
  } else if (normalizedType === 'image') {
    base.url = cleanString(record.url) ?? cleanString(record.src) ?? cleanString(record.imageUrl) ?? cleanString(record.image_url)
    base.alt = cleanString(record.alt) ?? cleanString(record.name)
    base.caption = cleanString(record.caption)
  } else if (normalizedType === 'gallery') {
    const images = arrayValue(record.images)
      .map(normalizeImage)
      .filter((image): image is NonNullable<ReturnType<typeof normalizeImage>> => Boolean(image))
    base.images = images.length > 0 ? images : undefined
    base.caption = cleanString(record.caption) ?? cleanString(record.title)
  } else if (normalizedType === 'file' || normalizedType === 'audio' || normalizedType === 'video') {
    base.url = cleanString(record.url) ?? cleanString(record.src)
    base.name = cleanString(record.name) ?? cleanString(record.title)
    base.caption = cleanString(record.caption)
    base.mimeType = cleanString(record.mimeType) ?? cleanString(record.mime_type)
    base.sizeBytes = numberValue(record.sizeBytes) ?? numberValue(record.size_bytes)
  } else if (normalizedType === 'tool_output') {
    base.tool = cleanString(record.tool) ?? cleanString(record.tool_name)
    base.output = rawString(record.output) ?? rawString(record.content) ?? rawString(record.text)
    base.stdout = rawString(record.stdout)
    base.stderr = rawString(record.stderr)
    base.status = cleanString(record.status)
  } else if (normalizedType === 'status') {
    base.status = cleanString(record.status)
    base.tone = cleanString(record.tone)
    base.body = rawString(record.body) ?? rawString(record.content) ?? rawString(record.text)
  } else if (normalizedType === 'approval') {
    base.body = rawString(record.body) ?? rawString(record.content) ?? rawString(record.text)
    base.choices = normalizeChoices(record.choices)
  } else if (normalizedType === 'clarify') {
    base.question = rawString(record.question) ?? rawString(record.content) ?? rawString(record.text) ?? rawString(record.title)
    base.choices = normalizeChoices(record.choices)
  } else if (normalizedType === 'model_picker') {
    base.models = arrayValue(record.models)
      .map(normalizeModel)
      .filter((model): model is RichModelOption => Boolean(model))
    base.providers = stringArray(record.providers)
  } else {
    base.content = rawString(record.content) ?? rawString(record.text) ?? rawString(record.body)
  }

  const part = withRest(record, known, base) as RichMessagePart
  if (part.type === 'image' && !part.url) return null
  if ((part.type === 'file' || part.type === 'audio' || part.type === 'video') && !part.url) return null
  if (part.type === 'gallery' && (!part.images || part.images.length === 0)) return null
  return part
}

export function normalizeRichParts(value: unknown): RichMessagePart[] {
  const values = Array.isArray(value) ? value : asRecord(value) ? [value] : []
  return values.map(normalizeRichPart).filter((part): part is RichMessagePart => Boolean(part))
}

function actionLabel(record: PlainRecord, type: string, id: string): string {
  return cleanString(record.label)
    ?? cleanString(record.text)
    ?? cleanString(record.title)
    ?? cleanString(record.name)
    ?? (type === 'approve' ? 'Approve' : type === 'deny' ? 'Deny' : id)
}

function normalizeUiAction(value: unknown, index: number): ChatUiAction | null {
  const record = asRecord(value)
  if (!record) return null
  const callbackData = cleanString(record.callback_data) ?? cleanString(record.callbackData)
  const url = cleanString(record.url)
  const type = (cleanString(record.type) ?? cleanString(record.kind) ?? (url ? 'open' : 'choose')).toLowerCase()
  const actionId = cleanString(record.actionId) ?? cleanString(record.action_id)
  const id = cleanString(record.id) ?? callbackData ?? actionId ?? url ?? `${type}:${index}`
  const base: PlainRecord = {
    id,
    type,
    label: actionLabel(record, type, id),
    actionId,
    value: record.value ?? callbackData,
    url,
    endpoint: cleanString(record.endpoint),
    method: cleanString(record.method)?.toUpperCase(),
    payload: sanitizeStructuredPayload(record.payload),
    disabled: typeof record.disabled === 'boolean' ? record.disabled : undefined,
    variant: cleanString(record.variant),
  }
  return withRest(record, [
    'id',
    'type',
    'kind',
    'label',
    'text',
    'title',
    'name',
    'actionId',
    'action_id',
    'value',
    'callback_data',
    'callbackData',
    'url',
    'endpoint',
    'method',
    'payload',
    'disabled',
    'variant',
  ], base) as ChatUiAction
}

function telegramActions(value: unknown): ChatUiAction[] {
  const record = asRecord(value)
  if (!record) return []
  const replyMarkup = asRecord(record.reply_markup) ?? asRecord(record.replyMarkup)
  const keyboard = arrayValue(replyMarkup?.inline_keyboard ?? replyMarkup?.inlineKeyboard)
  return keyboard
    .flatMap((row) => arrayValue(row))
    .map(normalizeUiAction)
    .filter((action): action is ChatUiAction => Boolean(action))
}

export function normalizeUiActions(value: unknown): ChatUiAction[] {
  const values = Array.isArray(value) ? value : asRecord(value) ? [value] : []
  return values.map(normalizeUiAction).filter((action): action is ChatUiAction => Boolean(action))
}

export function richPartsFromPayload(value: unknown, depth = 0): RichMessagePart[] {
  if (depth > 5 || value == null) return []
  const record = asRecord(value)
  if (!record) {
    return Array.isArray(value) ? value.flatMap((item) => richPartsFromPayload(item, depth + 1)) : []
  }

  const direct = [
    ...normalizeRichParts(record.richParts),
    ...normalizeRichParts(record.rich_parts),
  ]
  const nested = ['output', 'result', 'response', 'message', 'content', 'data']
    .flatMap((key) => key in record ? richPartsFromPayload(record[key], depth + 1) : [])
  return dedupeStructured([...direct, ...nested])
}

export function uiActionsFromPayload(value: unknown, depth = 0): ChatUiAction[] {
  if (depth > 5 || value == null) return []
  const record = asRecord(value)
  if (!record) {
    return Array.isArray(value) ? value.flatMap((item) => uiActionsFromPayload(item, depth + 1)) : []
  }

  const direct = [
    ...normalizeUiActions(record.uiActions),
    ...normalizeUiActions(record.ui_actions),
    ...normalizeUiActions(record.actions),
    ...telegramActions(record.telegram),
  ]
  const nested = ['output', 'result', 'response', 'message', 'content', 'data']
    .flatMap((key) => key in record ? uiActionsFromPayload(record[key], depth + 1) : [])
  return dedupeStructured([...direct, ...nested])
}

export function richPartsFromEvents(events: ChatEvent[] = []): RichMessagePart[] {
  return dedupeStructured(events.flatMap((event) => normalizeRichParts(event.richParts)))
}

export function uiActionsFromEvents(events: ChatEvent[] = []): ChatUiAction[] {
  return dedupeStructured(events.flatMap((event) => normalizeUiActions(event.uiActions)))
}

export function dedupeStructured<T>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const key = JSON.stringify(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function richPayloadFromRecord(record: PlainRecord): Pick<ChatEvent, 'richParts' | 'uiActions'> {
  const richParts = normalizeRichParts(record.richParts ?? record.rich_parts)
  const directActions = normalizeUiActions(record.uiActions ?? record.ui_actions ?? record.actions)
  const uiActions = directActions.length > 0
    ? directActions
    : telegramActions(record.telegram)
  return {
    ...(richParts.length > 0 ? { richParts } : {}),
    ...(uiActions.length > 0 ? { uiActions } : {}),
  }
}

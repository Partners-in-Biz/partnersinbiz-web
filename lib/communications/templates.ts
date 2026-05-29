import { countSmsSegments } from '@/lib/sms/segments'
import {
  COMMUNICATION_CHANNELS,
  type CommunicationChannel,
  type MessageTemplate,
  type MessageTemplateContent,
  type WhatsAppTemplateCategory,
} from './types'

const VARIABLE_PATTERN = /{{\s*([a-zA-Z0-9_.-]+)\s*}}/g
const WHATSAPP_CATEGORIES: WhatsAppTemplateCategory[] = ['utility', 'marketing', 'authentication']

export interface TemplatePreviewContext {
  contact?: Record<string, unknown> | null
  profile?: Record<string, unknown> | null
  variables?: Record<string, unknown> | null
}

export interface TemplateValidationIssue {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  description?: string
}

export interface TemplatePreview {
  channel: CommunicationChannel
  subject?: string
  preheader?: string
  header?: string
  body: string
  html?: string
  footer?: string
  buttons?: MessageTemplateContent['buttons']
  missingVariables: string[]
  sms?: {
    encoding: 'gsm7' | 'ucs2'
    segments: number
    characters: number
    estimatedCostUsd: number
  }
}

export function extractCommunicationVariables(input: string): string[] {
  const seen = new Set<string>()
  const variables: string[] = []
  for (const match of input.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]?.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    variables.push(name)
  }
  return variables
}

export function validateMessageTemplate(template: MessageTemplate): {
  pass: boolean
  issues: TemplateValidationIssue[]
} {
  const issues: TemplateValidationIssue[] = []

  if (!COMMUNICATION_CHANNELS.includes(template.channel)) {
    issues.push({
      id: 'channel-invalid',
      severity: 'error',
      title: 'Unsupported communication channel',
    })
  }

  if (!template.content?.body?.trim()) {
    issues.push({
      id: 'body-required',
      severity: 'error',
      title: 'Template body is required',
    })
  }

  if (template.channel === 'whatsapp') {
    if (!template.category || !WHATSAPP_CATEGORIES.includes(template.category)) {
      issues.push({
        id: 'whatsapp-category-invalid',
        severity: 'error',
        title: 'WhatsApp category must be utility, marketing, or authentication',
      })
    }

    if (template.status !== 'approved' || !template.provider?.externalTemplateId) {
      issues.push({
        id: 'whatsapp-template-not-approved',
        severity: template.status === 'rejected' ? 'error' : 'warning',
        title: 'WhatsApp template is not ready to send',
        description: 'WhatsApp outbound messages need an approved provider template outside the session window.',
      })
    }
  }

  if (template.channel === 'email' && !template.content.subject?.trim()) {
    issues.push({
      id: 'email-subject-required',
      severity: 'error',
      title: 'Email subject is required',
    })
  }

  if (template.channel === 'sms') {
    const preview = countSmsSegments(template.content.body)
    if (preview.segments > 6) {
      issues.push({
        id: 'sms-too-long',
        severity: 'warning',
        title: 'SMS template will be billed as more than six segments',
      })
    }
  }

  return {
    pass: !issues.some((issue) => issue.severity === 'error'),
    issues,
  }
}

export function buildTemplatePreview(
  template: MessageTemplate,
  context: TemplatePreviewContext = {},
): TemplatePreview {
  const values = buildVariableValues(context)
  const missing = new Set<string>()
  const requiredVariables = collectTemplateVariables(template)

  const render = (input?: string): string | undefined => {
    if (typeof input !== 'string') return input
    return input.replace(VARIABLE_PATTERN, (_, rawName: string) => {
      const name = rawName.trim()
      const value = values[name]
      if (value === undefined || value === null || value === '') {
        missing.add(name)
        return ''
      }
      return String(value)
    })
  }

  requiredVariables.forEach((name) => {
    const value = values[name]
    if (value === undefined || value === null || value === '') missing.add(name)
  })

  const body = render(template.content.body) ?? ''
  const preview: TemplatePreview = {
    channel: template.channel,
    subject: render(template.content.subject),
    preheader: render(template.content.preheader),
    header: render(template.content.header),
    body,
    html: render(template.content.html),
    footer: render(template.content.footer),
    buttons: template.content.buttons?.map((button) => ({
      ...button,
      label: render(button.label) ?? button.label,
      value: render(button.value) ?? button.value,
    })),
    missingVariables: Array.from(missing).filter((name) => requiredVariables.includes(name)),
  }

  if (template.channel === 'sms') {
    const sms = countSmsSegments(body)
    preview.sms = {
      ...sms,
      estimatedCostUsd: estimateSmsCostUsd(body, sms.segments, context.contact?.phone),
    }
  }

  return preview
}

function collectTemplateVariables(template: MessageTemplate): string[] {
  const variables: string[] = []
  const seen = new Set<string>()
  const add = (name: string) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    variables.push(name)
  }

  ;(template.variables ?? []).forEach(add)
  ;[
    template.content.subject,
    template.content.preheader,
    template.content.header,
    template.content.body,
    template.content.html,
    template.content.footer,
    ...(template.content.buttons ?? []).flatMap((button) => [button.label, button.value]),
  ].forEach((part) => {
    if (typeof part === 'string') extractCommunicationVariables(part).forEach(add)
  })

  return variables
}

function buildVariableValues(context: TemplatePreviewContext): Record<string, unknown> {
  const contact = context.contact ?? {}
  const profile = context.profile ?? {}
  const variables = context.variables ?? {}
  const firstName = pickString(contact.firstName) ?? pickString(contact.givenName)
  const lastName = pickString(contact.lastName) ?? pickString(contact.surname)
  const name =
    pickString(contact.name) ??
    pickString(contact.fullName) ??
    [firstName, lastName].filter(Boolean).join(' ')

  return {
    name,
    fullName: name,
    firstName,
    lastName,
    email: contact.email,
    phone: contact.phone,
    company: contact.company ?? contact.companyName,
    ...flattenObject(profile),
    ...flattenObject(contact.customFields as Record<string, unknown> | undefined),
    ...contact,
    ...profile,
    ...variables,
  }
}

function flattenObject(input?: Record<string, unknown> | null): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  const output: Record<string, unknown> = {}
  Object.entries(input).forEach(([key, value]) => {
    if (!key) return
    output[key] = value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, childValue]) => {
        output[`${key}.${childKey}`] = childValue
      })
    }
  })
  return output
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function estimateSmsCostUsd(body: string, segments: number, rawPhone: unknown): number {
  if (!body || segments <= 0) return 0
  const phone = typeof rawPhone === 'string' ? rawPhone.trim() : ''
  const rate =
    phone.startsWith('+1') ? 0.0075 :
    phone.startsWith('+27') ? 0.04 :
    phone.startsWith('+44') ? 0.04 :
    phone.startsWith('+61') ? 0.05 :
    0.05
  return Number((rate * segments).toFixed(4))
}

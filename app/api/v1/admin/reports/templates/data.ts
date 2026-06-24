// app/api/v1/admin/reports/templates/data.ts
//
// Firestore-backed report template registry (US-289).
//
// Collection: report_templates/{id}
//   { name, eyebrow, subject, description, assignedOrgIds[], version,
//     builtin?, source: 'builtin'|'custom', createdAt, updatedAt, ... }
// Subcollection: report_templates/{id}/versions/{autoId}
//   immutable snapshot written on every create/update.
//
// The four built-in REPORT_EMAIL_TEMPLATES remain available as read-only
// defaults and are merged into the listing so existing share/schedule flows
// keep working even before any custom template is created.

import { adminDb } from '@/lib/firebase/admin'
import { REPORT_EMAIL_TEMPLATES, DEFAULT_REPORT_TEMPLATE } from '@/lib/reports/templates'

export const TEMPLATES_COLLECTION = 'report_templates'
export const VERSIONS_SUBCOLLECTION = 'versions'

export interface ReportTemplateRecord {
  id: string
  name: string
  eyebrow: string
  subject: string
  description: string
  body: string
  assignedOrgIds: string[]
  version: number
  source: 'builtin' | 'custom'
  isDefault: boolean
  createdAt: string | null
  updatedAt: string | null
}

export interface TemplateVersion {
  id: string
  version: number
  name: string
  eyebrow: string
  subject: string
  description: string
  body: string
  assignedOrgIds: string[]
  changedBy: string
  changeNote: string
  createdAt: string | null
}

function tsToIso(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const seconds =
    (value as { _seconds?: number; seconds?: number })._seconds ??
    (value as { seconds?: number }).seconds
  if (typeof seconds === 'number') return new Date(seconds * 1000).toISOString()
  const toDate = (value as { toDate?: () => Date }).toDate
  if (typeof toDate === 'function') {
    try {
      return toDate.call(value).toISOString()
    } catch {
      return null
    }
  }
  return null
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

export function builtinTemplates(): ReportTemplateRecord[] {
  return REPORT_EMAIL_TEMPLATES.map((t) => ({
    id: `builtin:${t.id}`,
    name: t.name,
    eyebrow: t.eyebrow,
    subject: t.subject,
    description: t.description,
    body: '',
    assignedOrgIds: [],
    version: 1,
    source: 'builtin' as const,
    isDefault: t.id === DEFAULT_REPORT_TEMPLATE,
    createdAt: null,
    updatedAt: null,
  }))
}

export function docToRecord(id: string, data: Record<string, unknown>): ReportTemplateRecord {
  return {
    id,
    name: str(data.name, 'Untitled template'),
    eyebrow: str(data.eyebrow),
    subject: str(data.subject),
    description: str(data.description),
    body: str(data.body),
    assignedOrgIds: strArray(data.assignedOrgIds),
    version: typeof data.version === 'number' ? data.version : 1,
    source: 'custom',
    isDefault: data.isDefault === true,
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  }
}

export async function listTemplates(): Promise<ReportTemplateRecord[]> {
  const snap = await adminDb.collection(TEMPLATES_COLLECTION).get().catch(() => null)
  const custom = (snap?.docs ?? []).map((d) => docToRecord(d.id, (d.data() ?? {}) as Record<string, unknown>))
  custom.sort((a, b) => {
    const at = a.updatedAt ? Date.parse(a.updatedAt) : 0
    const bt = b.updatedAt ? Date.parse(b.updatedAt) : 0
    return bt - at
  })
  // Custom first, then the built-in read-only defaults.
  return [...custom, ...builtinTemplates()]
}

export async function listVersions(templateId: string, limit = 50): Promise<TemplateVersion[]> {
  const snap = await adminDb
    .collection(TEMPLATES_COLLECTION)
    .doc(templateId)
    .collection(VERSIONS_SUBCOLLECTION)
    .get()
    .catch(() => null)

  const versions = (snap?.docs ?? []).map((d) => {
    const data = (d.data() ?? {}) as Record<string, unknown>
    return {
      id: d.id,
      version: typeof data.version === 'number' ? data.version : 1,
      name: str(data.name),
      eyebrow: str(data.eyebrow),
      subject: str(data.subject),
      description: str(data.description),
      body: str(data.body),
      assignedOrgIds: strArray(data.assignedOrgIds),
      changedBy: str(data.changedBy),
      changeNote: str(data.changeNote),
      createdAt: tsToIso(data.createdAt),
    } satisfies TemplateVersion
  })

  return versions.sort((a, b) => b.version - a.version).slice(0, limit)
}

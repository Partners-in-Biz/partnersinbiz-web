// lib/reports/spec-validate.ts
//
// Runtime validation + normalisation for a CustomReportSpec coming off the wire
// (US-176). Keeps the builder API defensive without pulling in a schema lib.

import crypto from 'crypto'
import {
  REPORT_CATEGORIES,
  type CustomReportSpec,
  type ReportCategory,
  type ReportSection,
  type ReportSectionType,
} from './types'

const SECTION_TYPES: ReportSectionType[] = ['text', 'metric', 'chart', 'table', 'page_break']

function asString(v: unknown, max = 4000): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function isISODate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

export function normalizeSpec(raw: unknown, tz: string): { ok: true; spec: CustomReportSpec } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'spec required' }
  const r = raw as Record<string, unknown>

  const title = asString(r.title, 200).trim() || 'Custom report'
  const category: ReportCategory = REPORT_CATEGORIES.includes(r.category as ReportCategory)
    ? (r.category as ReportCategory)
    : 'custom'

  const periodRaw = (r.period ?? {}) as Record<string, unknown>
  if (!isISODate(periodRaw.start) || !isISODate(periodRaw.end)) {
    return { ok: false, error: 'period.start and period.end (YYYY-MM-DD) required' }
  }
  if (periodRaw.start > periodRaw.end) {
    return { ok: false, error: 'period.start must be on or before period.end' }
  }

  const sectionsRaw = Array.isArray(r.sections) ? r.sections : []
  if (sectionsRaw.length === 0) return { ok: false, error: 'at least one section is required' }
  if (sectionsRaw.length > 100) return { ok: false, error: 'too many sections (max 100)' }

  const sections: ReportSection[] = sectionsRaw.map((s) => {
    const sec = (s ?? {}) as Record<string, unknown>
    const type: ReportSectionType = SECTION_TYPES.includes(sec.type as ReportSectionType)
      ? (sec.type as ReportSectionType)
      : 'text'
    const ds = (sec.dataSource ?? null) as Record<string, unknown> | null
    return {
      id: asString(sec.id, 60) || `sec_${crypto.randomBytes(4).toString('hex')}`,
      type,
      title: asString(sec.title, 200) || undefined,
      body: asString(sec.body, 8000) || undefined,
      dataSource: ds
        ? {
            kind: ds.kind === 'manual' ? 'manual' : 'snapshot',
            metric: typeof ds.metric === 'string' ? (ds.metric as never) : undefined,
            series: typeof ds.series === 'string' ? ds.series : undefined,
            metrics: Array.isArray(ds.metrics) ? (ds.metrics.map(String) as never) : undefined,
            value: typeof ds.value === 'number' ? ds.value : undefined,
            rows: Array.isArray(ds.rows)
              ? ds.rows.slice(0, 50).map((row) => {
                  const rr = (row ?? {}) as Record<string, unknown>
                  return { label: asString(rr.label, 120), value: asString(rr.value, 120) }
                })
              : undefined,
          }
        : undefined,
    }
  })

  const propertyId = typeof r.propertyId === 'string' && r.propertyId.trim() ? r.propertyId.trim() : undefined

  return {
    ok: true,
    spec: {
      title,
      category,
      period: { start: periodRaw.start, end: periodRaw.end, tz },
      sections,
      ...(propertyId ? { propertyId } : {}),
    },
  }
}

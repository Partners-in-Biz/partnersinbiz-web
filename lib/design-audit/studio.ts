/**
 * Studio artifact gate — Design Audit for creative-canvas artifacts.
 *
 * Studio (creative-canvas) nodes carry free-form `data` payloads. When a node
 * carries HTML-like markup (e.g. a prompt-generated email block, SEO content,
 * blog/document block, or workspace artifact), the T1 detector runs over that
 * payload and stamps blocking P0/P1 findings into `data.designAudit` so the
 * agent sees them in the artifact and fixes them before marking the task
 * complete. This is the "auto-comment findings back into the task/PR" arm of
 * the slop-blocking hooks recommendation (research ZTTo7g6CU80u1uUSZvoC P1).
 *
 * Light by design: Studio saves are iterative, so we never hard-block a graph
 * save mid-iteration (that is the light per-edit pass — advisory). The deep
 * pass at completion is the repo gate (scripts/design-audit-gate.ts --deep)
 * and the review surface surfaces designAudit findings for the finish gate.
 */

import { runAudit } from './index'
import type { AuditOptions, Finding, Severity } from './types'

const HTML_FIELDS = new Set(['html', 'markup', 'bodyHtml', 'contentHtml', 'code', 'textPreview'])

export interface StudioAuditFinding extends Finding {
  /** Field inside node.data that carried the HTML payload. */
  field: string
}

export interface StudioAuditStamp {
  at: string
  mode: 'studio'
  summary: {
    findings: number
    blocked: number
    bySeverity: Record<Severity, number>
  }
  findings: StudioAuditFinding[]
}

/** True when a string looks like markup worth running the detector on. */
export function looksLikeHtml(value: string): boolean {
  if (!value || value.length < 8 || value.length > 200_000) return false
  return value.includes('<') && value.includes('>')
}

/** Extract HTML-like payloads from a node's data bag (recursive, bounded). */
export function extractHtmlPayloads(
  data: Record<string, unknown>,
  maxDepth = 4,
  depth = 0,
): Array<{ field: string; html: string }> {
  const out: Array<{ field: string; html: string }> = []
  if (!data || depth > maxDepth) return out
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      if (looksLikeHtml(value) && (HTML_FIELDS.has(key) || value.includes('<div') || value.includes('<p') || value.includes('<section') || value.includes('<html'))) {
        out.push({ field: key, html: value })
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const nested = extractHtmlPayloads(item as Record<string, unknown>, maxDepth, depth + 1)
          for (const n of nested) out.push({ field: `${key}.${n.field}`, html: n.html })
        } else if (typeof item === 'string' && looksLikeHtml(item) && item.includes('<')) {
          out.push({ field: `${key}[]`, html: item })
        }
      }
    } else if (value && typeof value === 'object') {
      const nested = extractHtmlPayloads(value as Record<string, unknown>, maxDepth, depth + 1)
      for (const n of nested) out.push({ field: `${key}.${n.field}`, html: n.html })
    }
  }
  return out
}

/** Run the detector over a node's HTML payloads and return findings. */
export function auditStudioNode(
  nodeId: string,
  data: Record<string, unknown>,
  options: AuditOptions = {},
): { findings: StudioAuditFinding[]; summary: StudioAuditStamp['summary'] } {
  const findings: StudioAuditFinding[] = []
  const payloads = extractHtmlPayloads(data)
  for (const { field, html } of payloads) {
    const result = runAudit(html, {
      ...options,
      fileName: `studio:${nodeId}:${field}`,
      maxFindingsPerRule: options.maxFindingsPerRule ?? 10,
    })
    for (const f of result.findings) {
      findings.push({ ...f, field })
    }
  }
  const bySeverity: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 }
  for (const f of findings) bySeverity[f.severity]++
  const blocked = bySeverity.P0 + bySeverity.P1
  return {
    findings,
    summary: { findings: findings.length, blocked, bySeverity },
  }
}

/** Build the stamp persisted into node.data.designAudit (null when clean). */
export function buildStudioStamp(
  nodeId: string,
  data: Record<string, unknown>,
  options: AuditOptions = {},
): { stamp: StudioAuditStamp | null; findings: StudioAuditFinding[] } {
  const { findings, summary } = auditStudioNode(nodeId, data, options)
  if (!findings.length) return { stamp: null, findings }
  return {
    stamp: {
      at: new Date().toISOString(),
      mode: 'studio',
      summary,
      findings: findings.slice(0, 50),
    },
    findings,
  }
}

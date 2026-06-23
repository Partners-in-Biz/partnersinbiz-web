// lib/reports/email.ts
//
// Shared email-builder for report sends (US-177 schedules, US-189 share-email,
// and the existing /send route). Renders a branded HTML email around the public
// report link, varying the eyebrow + copy by template.

import type { Report } from './types'
import { getReportTemplate } from './templates'

const fmtZar = (n: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)

const fmtPct = (p: number | null) => {
  if (p === null) return '—'
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(1)}%`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

interface BuildArgs {
  report: Report
  link: string
  templateId?: string | null
  /** Optional personal message prepended to the body (US-189 share). */
  personalMessage?: string
}

export function buildReportEmailHtml({ report, link, templateId, personalMessage }: BuildArgs): string {
  const tpl = getReportTemplate(templateId)
  const k = report.kpis
  const accent = report.brand.accent
  const showMetricTile = tpl.id !== 'minimal'
  const intro = personalMessage
    ? `<p style="font-size:14px;line-height:1.6;color:#cccccc;margin:0 0 24px;white-space:pre-line">${escapeHtml(personalMessage)}</p>`
    : ''
  const summary = report.exec_summary?.split('\n\n')[0] || ''

  return `<!doctype html>
<html><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;background:#0A0A0B;color:#EDEDED;font-family:Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:48px 24px">
    <p style="margin:0 0 24px;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#9a9a9a">${escapeHtml(tpl.eyebrow)}</p>
    <h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:34px;line-height:1.1;font-weight:400">${escapeHtml(report.brand.orgName)}</h1>
    <p style="margin:0 0 32px;font-size:14px;color:#9a9a9a">${report.period.start} → ${report.period.end}</p>

    ${intro}

    ${
      showMetricTile
        ? `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 32px">
      <tr>
        <td style="background:rgba(255,255,255,0.04);padding:14px 16px;border-radius:10px">
          <div style="font-size:10px;letter-spacing:0.25em;text-transform:uppercase;color:#9a9a9a;margin-bottom:4px">Total revenue</div>
          <div style="font-size:22px;font-family:Georgia,serif">${fmtZar(k.total_revenue)}</div>
          <div style="font-size:11px;color:${(k.deltas.total_revenue ?? 0) >= 0 ? '#86efac' : '#fda4af'};margin-top:4px;font-family:monospace">${fmtPct(k.deltas.total_revenue)} vs prior</div>
        </td>
      </tr>
    </table>`
        : ''
    }

    ${summary ? `<p style="font-size:14px;line-height:1.6;color:#cccccc;margin:0 0 32px">${escapeHtml(summary)}</p>` : ''}

    <p>
      <a href="${link}" style="display:inline-block;background:${accent};color:#000;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px">View the full report →</a>
    </p>

    <p style="margin:48px 0 0;padding-top:24px;border-top:1px solid rgba(255,255,255,0.1);font-size:11px;color:#666;font-family:monospace">
      Partners in Biz · partnersinbiz.online · No tracking, no fluff.
    </p>
  </div>
</body></html>`
}

export function buildReportEmailText({ report, link, personalMessage }: BuildArgs): string {
  const parts = [
    personalMessage ? `${personalMessage}\n` : '',
    `${report.brand.orgName} — performance report for ${report.period.start} to ${report.period.end}.`,
    report.exec_summary || '',
    `Full report: ${link}`,
    '— Partners in Biz',
  ]
  return parts.filter(Boolean).join('\n\n')
}

/**
 * Finish gate report rendering — human-readable evidence for the task/chat
 * and machine JSON for the evidence ledger.
 */

import type { FinishGateReport } from './types'

const VERDICT_ICON: Record<FinishGateReport['verdict'], string> = {
  ship: '✅ SHIP',
  fix: '🔧 FIX',
  rebuild: '🔁 REBUILD',
}

/** Render a compact markdown verdict block for Messages / task evidence. */
export function renderVerdictMarkdown(report: FinishGateReport): string {
  const lines: string[] = []
  lines.push(`### Design finish gate — ${VERDICT_ICON[report.verdict]} (exit ${report.exitCode})`)
  lines.push(`- Round ${report.round} of max ${report.maxFixRounds} · ${report.roundsRemaining} fix round(s) remaining`)
  lines.push(`- Reviewer: ${report.reviewerAgentId} (fresh context, never the builder)`)
  lines.push(`- Summary: ${report.summary.resolved} resolved · ${report.summary.partial} partial · ${report.summary.unresolved} unresolved (${report.summary.total} promises)`)
  if (report.promises.length) {
    lines.push('')
    lines.push('| Promise | Score | Note |')
    lines.push('| --- | --- | --- |')
    for (const p of report.promises) {
      lines.push(`| ${p.id} ${p.label.replace(/\|/g, '\\|')} | ${p.score} | ${(p.note ?? '').replace(/\|/g, '\\|')} |`)
    }
  }
  if (report.strengths.length) {
    lines.push('', '**Strengths**')
    for (const s of report.strengths) lines.push(`- ${s}`)
  }
  if (report.concerns.length) {
    lines.push('', '**Concerns**')
    for (const c of report.concerns) lines.push(`- ${c}`)
  }
  if (report.fixRequests.length) {
    lines.push('', '**Fix requests**')
    for (const f of report.fixRequests) lines.push(`- ${f}`)
  }
  if (report.selfGradedRejected) {
    lines.push('', '> ⛔ Self-grade rejected: the reviewer was the builder. Re-run with a fresh context.')
  }
  return lines.join('\n')
}

/** One-line verdict for CI / watchers. */
export function renderVerdictLine(report: FinishGateReport): string {
  return `finish-gate: ${report.verdict} (exit ${report.exitCode}) round ${report.round}/${report.maxFixRounds} — ${report.summary.resolved}/${report.summary.partial}/${report.summary.unresolved} resolved/partial/unresolved`
}

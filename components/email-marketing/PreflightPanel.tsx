'use client'

import type { EmailPreflightResult } from '@/lib/email-marketing/preflight'

export function PreflightPanel({ result }: { result: EmailPreflightResult }) {
  const errors = result.issues.filter((issue) => issue.severity === 'error').length
  const warnings = result.issues.filter((issue) => issue.severity === 'warning').length
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="sc-tiny !text-[10px]">Preflight</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            {errors ? `${errors} blocking` : 'Ready to review'}{warnings ? ` · ${warnings} warnings` : ''}
          </p>
        </div>
        <span aria-label={`Preflight score ${result.score} out of 100`} className={[
          'text-sm  tabular-nums',
          errors ? 'text-rose-300' : warnings ? 'text-[var(--sc-ink-soft)]' : 'text-emerald-300',
        ].join(' ')}>{result.score}<span className="sr-only"> out of 100</span></span>
      </div>
      {result.issues.length > 0 && (
        <ul className="max-h-56 space-y-2 overflow-y-auto">
          {result.issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.blockId ?? index}`} className="flex items-start gap-2 text-xs text-[var(--color-pib-text-muted)]">
              <span aria-hidden="true" className={[
                'mt-1 h-1.5 w-1.5 shrink-0 rounded',
                issue.severity === 'error' ? 'bg-rose-400' : issue.severity === 'warning' ? 'bg-[var(--sc-surface)]' : 'bg-sky-400',
              ].join(' ')} />
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] leading-4 text-[var(--color-pib-text-muted)]">
        Preflight checks campaign content and configured delivery records. It does not predict inbox placement.
      </p>
    </div>
  )
}

'use client'

export interface DiffWarning {
  field?: string  // optional field name (e.g. "objective", "daily_budget")
  message: string
  severity?: 'info' | 'warning' | 'error'
}

interface Props {
  open: boolean
  warnings: DiffWarning[]
  title?: string
  proceedLabel?: string
  cancelLabel?: string
  onProceed: () => void
  onCancel: () => void
}

export function DiffWarningDialog({
  open,
  warnings,
  title = 'Review changes',
  proceedLabel = 'Proceed anyway',
  cancelLabel = 'Cancel',
  onProceed,
  onCancel,
}: Props) {
  if (!open) return null

  const hasErrors = warnings.some((w) => w.severity === 'error')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diff-warning-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/70 p-4"
    >
      <div data-testid="diff-warning-panel" className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-white/10 bg-[var(--sc-ink)]">
        <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-6">
          <h2 id="diff-warning-title" className="text-lg font-medium">
            {title}
          </h2>
          <p className="mt-1 text-sm text-white/60">
            {warnings.length} {warnings.length === 1 ? 'issue' : 'issues'} found
            {hasErrors ? ' - errors must be resolved before launching' : ''}.
          </p>
        </div>

        <ul data-testid="diff-warning-list" className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 sm:px-6">
          {warnings.map((w, i) => (
            <li
              key={i}
              className={`rounded border px-3 py-2 text-sm ${
                w.severity === 'error'
                  ? 'border-red-500/40 bg-red-500/5'
                  : w.severity === 'warning'
                    ? 'border-[color-mix(in_srgb,var(--sc-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--sc-accent)_5%,transparent)]'
                    : 'border-white/10 bg-white/5'
              }`}
            >
              {w.field && (
                <div className="text-xs uppercase tracking-wide text-white/40">{w.field}</div>
              )}
              <div className="mt-0.5 text-white/90">{w.message}</div>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-white/10 p-4 sm:px-6">
          <button type="button" className="btn-pib-ghost text-sm" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn-pib-accent text-sm"
            onClick={onProceed}
            disabled={hasErrors}
            aria-disabled={hasErrors}
          >
            {proceedLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

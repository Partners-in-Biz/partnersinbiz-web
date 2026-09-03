'use client'

import { StatusPill, Surface } from '@/components/ui/AppFoundation'
import { formatBytes, humanizeToken, type BookProjectManifest } from './types'
import { bookOutputAnchor } from '@/lib/book-studio/output-anchor'

type BookProjectAssemblyPanelProps = {
  manifest?: BookProjectManifest
  assembling: boolean
  error?: string
  missingOrders?: number[]
}

function qaTone(qaStatus?: string): 'neutral' | 'success' | 'warn' {
  if (qaStatus === 'pending_review') return 'warn'
  if (qaStatus === 'pass') return 'success'
  return 'neutral'
}

export function BookProjectAssemblyPanel({ manifest, assembling, error, missingOrders }: BookProjectAssemblyPanelProps) {
  return (
    <Surface id="assembly" header={<h2 className="text-lg">Assembly</h2>}>
      <div className="space-y-4">
        {assembling ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]" role="status">Assembling book package…</p>
        ) : null}

        {error ? (
          <div className="space-y-2 rounded-[6px] border border-red-200 bg-red-50 p-4 text-sm text-red-900" role="alert">
            <p>{error}</p>
            {missingOrders && missingOrders.length > 0 ? (
              <p>Missing page orders: {missingOrders.join(', ')}</p>
            ) : null}
          </div>
        ) : null}

        {manifest ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="rose">Version {manifest.version ?? ' - '}</StatusPill>
              <StatusPill tone={qaTone(manifest.qaStatus)}>{humanizeToken(manifest.qaStatus)}</StatusPill>
              {manifest.generatedAt ? (
                <span className="text-xs text-[var(--color-pib-text-muted)]">Generated {manifest.generatedAt}</span>
              ) : null}
            </div>

            <ul className="space-y-2" aria-label="Manifest files">
              {(manifest.files ?? []).map((file, index) => (
                <li id={bookOutputAnchor(file, index)}
                  key={file.href ?? index}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[var(--color-pib-border)] p-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-[var(--color-pib-text)]">{file.label ?? humanizeToken(file.role)}</p>
                    <p className="text-xs text-[var(--color-pib-text-muted)]">
                      {typeof file.pageCount === 'number' ? `${file.pageCount} pages · ` : ''}
                      {formatBytes(file.bytes)}
                      {file.checksum ? ` · ${file.checksum.slice(0, 12)}` : ''}
                    </p>
                  </div>
                  {file.href ? (
                    <a href={file.href} target="_blank" rel="noreferrer" className="btn-secondary">
                      Download
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : !error && !assembling ? (
          <p className="text-sm text-[var(--color-pib-text-muted)]">No package has been assembled yet.</p>
        ) : null}
      </div>
    </Surface>
  )
}

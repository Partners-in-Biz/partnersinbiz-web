'use client'

// components/email/InboxPreview.tsx
//
// Multi-client inbox preview (US-138). Renders a given email HTML across a set
// of common email clients / devices with per-client tabs. Since no external
// render service (Litmus / Email-on-Acid) is configured, each tab renders the
// email in an isolated <iframe srcDoc> wrapped in a DETERMINISTIC,
// client-specific CSS normalize variant that approximates that client's quirks
// (see lib/email/inbox-compat.wrapHtmlForClient). It is a heuristic aid — NOT a
// faithful render, and it never fabricates screenshots.
//
// Alongside the rendered email, each tab shows an "issues" panel driven by the
// rule-based analyzer in lib/email/inbox-compat.analyzeInboxCompat — Outlook
// flex/grid/position, Gmail 102KB clipping + <style> stripping, missing alt
// text, etc.
//
// Importable as:
//   import { InboxPreview } from '@/components/email/InboxPreview'
//   <InboxPreview html={renderedHtml} />            // takes html string
//   <InboxPreview document={emailDocument} />        // or a block document
//
// US-103's editor can drop <InboxPreview html={previewHtml} /> straight in.

import { useMemo, useState } from 'react'
import {
  INBOX_CLIENTS,
  analyzeInboxCompat,
  wrapHtmlForClient,
  getInboxClient,
  type InboxClientId,
  type InboxSeverity,
  type InboxWarning,
} from '@/lib/email/inbox-compat'
import { renderEmail } from '@/lib/email-builder/render'
import type { EmailDocument } from '@/lib/email-builder/types'

export interface InboxPreviewProps {
  /** Finished email HTML. Provide this OR `document`. */
  html?: string
  /** Block document — rendered to HTML internally. Ignored if `html` is set. */
  document?: EmailDocument | null
  /** Initially-selected client tab. Defaults to Apple Mail. */
  initialClient?: InboxClientId
  /** Optional wrapper className. */
  className?: string
}

const SEVERITY_STYLES: Record<InboxSeverity, { dot: string; label: string }> = {
  error: { dot: 'bg-red-500', label: 'text-red-500' },
  warning: { dot: 'bg-amber-500', label: 'text-amber-500' },
  info: { dot: 'bg-sky-500', label: 'text-sky-400' },
}

function severityRank(s: InboxSeverity): number {
  return s === 'error' ? 0 : s === 'warning' ? 1 : 2
}

function IssueRow({ warning }: { warning: InboxWarning }) {
  const s = SEVERITY_STYLES[warning.severity]
  return (
    <li className="flex gap-2.5 py-2">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-on-surface">{warning.title}</span>
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${s.label}`}>
            {warning.severity}
          </span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">{warning.detail}</p>
        <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
          <span className="font-medium text-on-surface">Fix:</span> {warning.recommendation}
        </p>
      </div>
    </li>
  )
}

export function InboxPreview({
  html,
  document,
  initialClient = 'apple-mail',
  className = '',
}: InboxPreviewProps) {
  const [activeClient, setActiveClient] = useState<InboxClientId>(initialClient)

  // Resolve the email HTML once. Prefer an explicit `html`; otherwise render
  // the supplied block document.
  const resolvedHtml = useMemo(() => {
    if (typeof html === 'string' && html.length > 0) return html
    if (document) return renderEmail(document).html
    return ''
  }, [html, document])

  // Rule-based per-client report — deterministic, recomputed only when the
  // HTML changes.
  const report = useMemo(() => analyzeInboxCompat(resolvedHtml), [resolvedHtml])

  const client = getInboxClient(activeClient)
  const srcDoc = useMemo(
    () => wrapHtmlForClient(resolvedHtml, activeClient),
    [resolvedHtml, activeClient],
  )
  const clientReport = report.clients.find((c) => c.clientId === activeClient)
  const warnings = (clientReport?.warnings ?? [])
    .slice()
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))

  const errorCount = warnings.filter((w) => w.severity === 'error').length
  const warningCount = warnings.filter((w) => w.severity === 'warning').length

  const kb = (report.htmlBytes / 1024).toFixed(1)

  return (
    <div className={`pib-card !p-0 overflow-hidden ${className}`}>
      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-outline-variant bg-surface-container px-2 py-2">
        {INBOX_CLIENTS.map((c) => {
          const r = report.clients.find((x) => x.clientId === c.id)
          const active = c.id === activeClient
          const blocking = r?.hasBlocking
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveClient(c.id)}
              className={`relative rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
              title={c.engine}
            >
              {c.label}
              {blocking && (
                <span
                  className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                    active ? 'bg-on-primary/80' : 'bg-red-500'
                  }`}
                  aria-label="has blocking issues"
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Body: preview iframe + issues panel */}
      <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
        {/* Rendered email */}
        <div className="flex flex-col bg-zinc-950">
          <div className="flex items-center justify-between border-b border-outline-variant px-4 py-2">
            <span className="text-xs text-on-surface-variant">
              {client.label} · {client.engine}
            </span>
            <span className="text-[11px] text-on-surface-variant">
              {client.device === 'mobile' ? `${client.viewportWidth}px` : 'Desktop'} · {kb} KB
            </span>
          </div>
          <div className="flex justify-center overflow-auto p-4" style={{ minHeight: 420 }}>
            <iframe
              title={`${client.label} preview`}
              srcDoc={srcDoc}
              sandbox="allow-same-origin"
              style={{
                width: client.viewportWidth,
                maxWidth: '100%',
                height: 560,
                border: '1px solid #27272a',
                borderRadius: client.device === 'mobile' ? 24 : 8,
                background: '#fff',
              }}
            />
          </div>
        </div>

        {/* Issues panel */}
        <div className="border-t border-outline-variant lg:border-l lg:border-t-0 bg-surface">
          <div className="flex items-center justify-between border-b border-outline-variant px-4 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              Rendering issues
            </span>
            <span className="flex items-center gap-2 text-[11px]">
              {errorCount > 0 && <span className="text-red-500">{errorCount} blocking</span>}
              {warningCount > 0 && <span className="text-amber-500">{warningCount} warning</span>}
              {errorCount === 0 && warningCount === 0 && (
                <span className="text-emerald-500">No issues</span>
              )}
            </span>
          </div>

          {warnings.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-on-surface-variant">
              No rendering quirks detected for {client.label}.
            </div>
          ) : (
            <ul className="max-h-[520px] divide-y divide-outline-variant overflow-y-auto px-4">
              {warnings.map((w) => (
                <IssueRow key={w.id} warning={w} />
              ))}
            </ul>
          )}

          <p className="border-t border-outline-variant px-4 py-3 text-[11px] leading-relaxed text-on-surface-variant">
            Heuristic preview: each tab approximates the client&apos;s engine quirks via a
            deterministic CSS normalize. It is an aid, not a pixel-accurate render, and uses no
            screenshots.
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Embeddable switcher wrapper ─────────────────────────────────────────────
//
// A thin wrapper that exposes a device/client switcher header above the
// preview, for contexts that want a compact, self-contained widget (e.g. a
// review step or a modal). Re-exports the same props.

export interface InboxPreviewSwitcherProps extends InboxPreviewProps {
  /** Optional heading shown above the preview. */
  heading?: string
}

export function InboxPreviewSwitcher({
  heading = 'Inbox preview',
  ...props
}: InboxPreviewSwitcherProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-on-surface">{heading}</h3>
        <span className="text-[11px] text-on-surface-variant">
          {INBOX_CLIENTS.length} clients
        </span>
      </div>
      <InboxPreview {...props} />
    </section>
  )
}

export default InboxPreview

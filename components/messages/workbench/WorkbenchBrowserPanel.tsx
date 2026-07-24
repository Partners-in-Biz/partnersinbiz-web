'use client'

/* eslint-disable @next/next/no-img-element -- Confirmed browser screenshot artifacts are intentionally rendered without Next image optimization. */

import { type FormEvent, useEffect, useState } from 'react'
import type { WorkbenchBrowserTarget } from '@/lib/messages/workbench/types'

function privateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::' || host === '::1' || host === '0.0.0.0') return true

  // Literal IPv6 addresses are conservatively blocked in observer mode. A
  // public tunnel hostname remains available for legitimate remote previews,
  // while this avoids an incomplete special-purpose IPv6 range allowlist.
  if (host.includes(':')) return true

  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
  if (!ipv4) return false
  const [a, b, c] = ipv4
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

function safeObservedUrl(value: string): { url: string | null; error: string | null } {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { url: null, error: 'Only HTTP and HTTPS targets are supported.' }
    if (parsed.username || parsed.password) return { url: null, error: 'Credentialed URLs are blocked.' }
    if (privateHostname(parsed.hostname)) return { url: null, error: 'Local and private-network targets are blocked. Use a public tunnel URL.' }
    if (typeof window !== 'undefined' && parsed.origin === window.location.origin) return { url: null, error: 'Same-origin application URLs are blocked in the observer panel.' }
    return { url: parsed.toString(), error: null }
  } catch {
    return { url: null, error: 'Enter a valid HTTP or HTTPS URL.' }
  }
}

export function WorkbenchBrowserPanel({ targets }: { targets: WorkbenchBrowserTarget[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(targets[0]?.id ?? null)
  const [draftUrl, setDraftUrl] = useState('')
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null)
  const [preparedImageUrl, setPreparedImageUrl] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!targets.some((target) => target.id === selectedId)) setSelectedId(targets[0]?.id ?? null)
  }, [selectedId, targets])

  const selected = targets.find((target) => target.id === selectedId) ?? targets[0]
  const prepareTarget = (event: FormEvent) => {
    event.preventDefault()
    const result = safeObservedUrl(draftUrl)
    setValidationError(result.error)
    setPreparedUrl(result.url)
    setPreparedImageUrl(result.url && selected?.imageUrl === draftUrl ? result.url : null)
  }

  return (
    <div data-testid="workbench-browser-panel" className="flex h-full min-h-0 flex-col">
      <form onSubmit={prepareTarget} className="flex shrink-0 gap-1 border-b border-[var(--color-card-border)] p-2">
        <input
          aria-label="Browser target URL"
          value={draftUrl}
          onChange={(event) => { setDraftUrl(event.target.value); setValidationError(null); setPreparedUrl(null); setPreparedImageUrl(null) }}
          placeholder="https://public-preview.example"
          className="min-h-9 min-w-0 flex-1 rounded-md border border-[var(--color-card-border)] bg-black/20 px-2 font-mono text-[11px] text-[var(--color-pib-text)] outline-none focus:border-primary/60"
        />
        <button type="submit" className="min-h-9 rounded-md border border-[var(--color-card-border)] px-2 text-[11px] text-[var(--color-pib-text-muted)] hover:bg-white/[0.05]">Prepare</button>
      </form>
      {validationError && <p role="alert" className="shrink-0 border-b border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200">{validationError}</p>}
      {targets.length > 0 && (
        <div className="max-h-[28%] shrink-0 overflow-y-auto border-b border-[var(--color-card-border)]">
          {targets.map((target) => {
            const active = target.id === selected?.id
            return (
              <button
                key={target.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSelectedId(target.id)
                  setDraftUrl(target.url ?? target.imageUrl ?? '')
                  setPreparedUrl(null)
                  setPreparedImageUrl(null)
                  setValidationError(null)
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] ${active ? 'bg-primary/10 text-[var(--color-pib-text)]' : 'text-[var(--color-pib-text-muted)] hover:bg-white/[0.04]'}`}
              >
                <span aria-hidden="true" className="material-symbols-outlined shrink-0 text-[14px] text-primary">{target.imageUrl && !target.url ? 'image' : 'public'}</span>
                <span className="min-w-0 flex-1 truncate">{target.title || target.url || 'Screenshot'}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-black/20 p-2">
        {preparedImageUrl ? (
          <img src={preparedImageUrl} alt={selected?.title ?? 'Browser preview'} referrerPolicy="no-referrer" className="max-h-full w-full rounded-lg border border-[var(--color-card-border)] object-contain" />
        ) : preparedUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[11px] text-[var(--color-pib-text-muted)]">
            <span aria-hidden="true" className="material-symbols-outlined text-[26px] text-primary">open_in_new</span>
            <p>Target validated. Phase 1 opens live pages externally instead of embedding untrusted content in PiB.</p>
            <a href={preparedUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="rounded-md border border-primary/35 bg-primary/10 px-3 py-2 font-medium text-primary hover:bg-primary/15">Open observed URL</a>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[11px] text-[var(--color-pib-text-muted)]">
            <span aria-hidden="true" className="material-symbols-outlined text-[24px]">visibility_off</span>
            <p>Select an observed target, then choose Prepare. Targets and screenshots never load automatically.</p>
            <p className="text-[10px] opacity-80">A live agent browser stream is coming in Phase 4.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkbenchBrowserPanel

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/studio'

/**
 * Mac desktop watch / take-control panel (Phase 2).
 * Polls a desktop session for frames; take control enables click/type.
 */
export function WorkbenchDesktopPanel({
  conversationId,
  sessionId,
  latestFrameUrl: initialFrameUrl,
  status: initialStatus,
  driver: initialDriver = 'agent',
  screenWidth = 1440,
  screenHeight = 900,
  hasDesktopWatch,
  hasDesktopControl,
  onClose,
}: {
  conversationId: string
  sessionId: string | null
  latestFrameUrl?: string | null
  status?: string | null
  driver?: 'agent' | 'user'
  screenWidth?: number
  screenHeight?: number
  hasDesktopWatch?: boolean
  hasDesktopControl?: boolean
  onClose?: () => void
}) {
  const [frameUrl, setFrameUrl] = useState(initialFrameUrl ?? null)
  const [status, setStatus] = useState(initialStatus ?? 'idle')
  const [driver, setDriver] = useState(initialDriver)
  const [busy, setBusy] = useState(false)
  const [sensitiveMode, setSensitiveMode] = useState(false)
  const [typeBuffer, setTypeBuffer] = useState('')
  const imgRef = useRef<HTMLButtonElement>(null)

  const base = sessionId
    ? `/api/v1/conversations/${encodeURIComponent(conversationId)}/workbench/desktop/sessions/${encodeURIComponent(sessionId)}`
    : null

  useEffect(() => {
    if (!base) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(base, { cache: 'no-store' })
        if (!res.ok || cancelled) return
        const body = await res.json()
        const data = body?.data ?? body
        if (typeof data.latestFrameUrl === 'string') setFrameUrl(data.latestFrameUrl)
        if (typeof data.status === 'string') setStatus(data.status)
        if (data.driver === 'user' || data.driver === 'agent') setDriver(data.driver)
      } catch {
        // ignore
      }
    }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [base])

  const takeControl = useCallback(async () => {
    if (!base) return
    setBusy(true)
    try {
      await fetch(`${base}/driver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: 'user' }),
      })
      setDriver('user')
      await fetch(`${base}/follow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', intervalMs: 750 }),
      })
    } finally {
      setBusy(false)
    }
  }, [base])

  const handBack = useCallback(async () => {
    if (!base) return
    setBusy(true)
    try {
      await fetch(`${base}/driver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver: 'agent' }),
      })
      setDriver('agent')
    } finally {
      setBusy(false)
    }
  }, [base])

  const clickAt = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!base || driver !== 'user') return
    const rect = event.currentTarget.getBoundingClientRect()
    const xPct = (event.clientX - rect.left) / Math.max(rect.width, 1)
    const yPct = (event.clientY - rect.top) / Math.max(rect.height, 1)
    const x = Math.round(xPct * screenWidth)
    const y = Math.round(yPct * screenHeight)
    setBusy(true)
    try {
      await fetch(`${base}/click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x, y }),
      })
    } finally {
      setBusy(false)
    }
  }, [base, driver, screenHeight, screenWidth])

  const sendType = useCallback(async () => {
    if (!base || driver !== 'user' || !typeBuffer) return
    setBusy(true)
    try {
      await fetch(`${base}/type`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: typeBuffer, sensitive: sensitiveMode }),
      })
      setTypeBuffer('')
    } finally {
      setBusy(false)
    }
  }, [base, driver, sensitiveMode, typeBuffer])

  if (!hasDesktopWatch) {
    return (
      <div data-testid="workbench-desktop-panel" className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <Icon name="screenshot_monitor" className="text-[32px] text-primary" />
        <p className="text-sm font-medium text-[var(--color-pib-text)]">Grant Screen Recording</p>
        <p className="max-w-sm text-[12px] leading-5 text-[var(--color-pib-text-muted)]">
          Open System Settings → Privacy &amp; Security → Screen Recording and enable Partners Runtime,
          then wait for the next heartbeat so this Mac advertises <code>desktop.watch</code>.
        </p>
        {onClose && (
          <button type="button" onClick={onClose} className="text-[12px] text-primary hover:underline">Close</button>
        )}
      </div>
    )
  }

  return (
    <div data-testid="workbench-desktop-panel" className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-pib-line)] px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon name="desktop_windows" className="text-[16px] text-primary" />
          <span className="text-[12px] font-medium text-[var(--color-pib-text)]">Desktop</span>
          <span className="rounded border border-[var(--color-pib-line)] px-1.5 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">{status}</span>
        </div>
        <div className="flex items-center gap-1">
          {hasDesktopControl && driver === 'user' && (
            <button
              type="button"
              data-testid="workbench-desktop-hand-back"
              disabled={busy || !sessionId}
              onClick={() => { void handBack() }}
              className="inline-flex h-7 items-center gap-1 rounded border border-emerald-400/35 bg-emerald-400/10 px-2 text-[11px] font-medium text-emerald-200 hover:bg-emerald-400/15 disabled:opacity-40"
            >
              Hand back
            </button>
          )}
          {hasDesktopControl && driver !== 'user' && (
            <button
              type="button"
              data-testid="workbench-desktop-take-control"
              disabled={busy || !sessionId}
              onClick={() => { void takeControl() }}
              className="inline-flex h-7 items-center gap-1 rounded border border-[var(--color-pib-line)] px-2 text-[11px] font-medium text-[var(--color-pib-text)] hover:bg-[var(--color-row-hover)] disabled:opacity-40"
            >
              Take control
            </button>
          )}
          {!hasDesktopControl && (
            <span className="text-[10px] text-[var(--color-pib-text-muted)]">Watch only — grant Accessibility for control</span>
          )}
          {onClose && (
            <button type="button" aria-label="Close desktop" onClick={onClose} className="grid h-7 w-7 place-items-center rounded text-[var(--color-pib-text-muted)] hover:bg-[var(--color-row-hover)]">
              <Icon name="close" className="text-[16px]" />
            </button>
          )}
        </div>
      </header>
      <button
        type="button"
        ref={imgRef}
        data-testid="workbench-desktop-frame"
        onClick={(event) => { void clickAt(event) }}
        className="relative min-h-0 flex-1 overflow-hidden bg-black"
        disabled={driver !== 'user'}
      >
        {frameUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frameUrl} alt="Desktop" className="h-full w-full object-contain" />
        ) : (
          <span className="grid h-full place-items-center text-[12px] text-[var(--color-pib-text-muted)]">Waiting for frames…</span>
        )}
      </button>
      {driver === 'user' && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-pib-line)] px-3 py-2">
          <label className="inline-flex items-center gap-1 text-[10px] text-[var(--color-pib-text-muted)]">
            <input
              type="checkbox"
              checked={sensitiveMode}
              onChange={(e) => setSensitiveMode(e.target.checked)}
              data-testid="workbench-desktop-sensitive"
            />
            Sensitive
          </label>
          <input
            type={sensitiveMode ? 'password' : 'text'}
            value={typeBuffer}
            onChange={(e) => setTypeBuffer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void sendType()
              }
            }}
            aria-label={sensitiveMode ? 'Sensitive desktop typing' : 'Type on desktop'}
            placeholder={sensitiveMode ? 'Hidden typing (not in transcript)' : 'Type on desktop'}
            className="min-w-0 flex-1 rounded border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-muted)] px-2 py-1 text-[12px]"
            data-testid="workbench-desktop-type"
          />
          <button
            type="button"
            disabled={busy || !typeBuffer}
            onClick={() => { void sendType() }}
            className="rounded border border-[var(--color-pib-line)] px-2 py-1 text-[11px] disabled:opacity-40"
          >
            Send
          </button>
        </div>
      )}
    </div>
  )
}

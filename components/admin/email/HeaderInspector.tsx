'use client'

import { useMemo, useState } from 'react'

/**
 * Raw email header inspector. Paste a full set of RFC 5322 headers (e.g. the
 * "Show original" output from Gmail) and it surfaces the auth-results lines —
 * SPF, DKIM, DMARC, plus Return-Path / From / Message-ID. Pure client-side
 * parsing; nothing leaves the browser.
 */

interface AuthLine {
  label: string
  value: string
  verdict: 'pass' | 'fail' | 'neutral' | 'none' | 'unknown'
}

function verdictFor(text: string): AuthLine['verdict'] {
  const t = text.toLowerCase()
  if (/=\s*pass/.test(t) || /\bpass\b/.test(t)) return 'pass'
  if (/=\s*fail/.test(t) || /\bfail\b/.test(t) || /softfail/.test(t)) return 'fail'
  if (/=\s*none/.test(t) || /\bnone\b/.test(t)) return 'none'
  if (/=\s*neutral/.test(t) || /\bneutral\b/.test(t)) return 'neutral'
  return 'unknown'
}

/** Unfold RFC 5322 headers: continuation lines start with whitespace. */
function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^\s/.test(line) && out.length > 0) {
      out[out.length - 1] += ' ' + line.trim()
    } else {
      out.push(line)
    }
  }
  return out
}

function parseHeaders(raw: string): { auth: AuthLine[]; meta: { key: string; value: string }[] } {
  const lines = unfold(raw)
  const auth: AuthLine[] = []
  const meta: { key: string; value: string }[] = []

  for (const line of lines) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (!value) continue

    if (key === 'authentication-results' || key === 'arc-authentication-results') {
      // Split into the individual mechanisms (spf=, dkim=, dmarc=).
      for (const mech of ['spf', 'dkim', 'dmarc']) {
        const re = new RegExp(`${mech}\\s*=\\s*([a-z]+)([^;]*)`, 'i')
        const hit = value.match(re)
        if (hit) {
          auth.push({
            label: mech.toUpperCase(),
            value: `${hit[1]}${hit[2] ? ' ' + hit[2].trim() : ''}`.trim(),
            verdict: verdictFor(hit[1]),
          })
        }
      }
    } else if (key === 'received-spf') {
      auth.push({ label: 'Received-SPF', value, verdict: verdictFor(value) })
    } else if (['from', 'return-path', 'message-id', 'date', 'subject', 'reply-to', 'to'].includes(key)) {
      meta.push({ key: m[1], value })
    }
  }
  return { auth, meta }
}

const VERDICT_STYLE: Record<AuthLine['verdict'], string> = {
  pass: 'bg-green-500/10 text-green-400 border-green-500/30',
  fail: 'bg-red-500/10 text-red-400 border-red-500/30',
  neutral: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  none: 'bg-on-surface/10 text-on-surface-variant border-on-surface/20',
  unknown: 'bg-on-surface/10 text-on-surface-variant border-on-surface/20',
}

export default function HeaderInspector() {
  const [raw, setRaw] = useState('')
  const parsed = useMemo(() => (raw.trim() ? parseHeaders(raw) : null), [raw])

  return (
    <div className="pib-card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-headline font-bold text-on-surface">Raw header inspector</h2>
        <p className="text-sm text-on-surface-variant mt-0.5">
          Paste a message&apos;s full headers (Gmail &rarr; Show original) to read its SPF / DKIM /
          DMARC auth results. Parsing is local — nothing is uploaded.
        </p>
      </div>
      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={'Authentication-Results: mx.google.com;\n  spf=pass ...; dkim=pass ...; dmarc=pass ...'}
        className="pib-input w-full font-mono text-xs min-h-[140px]"
        rows={7}
      />
      {parsed && parsed.auth.length === 0 && parsed.meta.length === 0 && (
        <p className="text-xs text-on-surface-variant">
          No recognisable headers found. Make sure you pasted the raw header block.
        </p>
      )}
      {parsed && parsed.auth.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {parsed.auth.map((a, i) => (
            <div
              key={i}
              className={`rounded-md border px-3 py-2 text-xs ${VERDICT_STYLE[a.verdict]}`}
            >
              <span className="font-label uppercase tracking-wide">{a.label}</span>
              <span className="ml-2 font-mono">{a.value}</span>
            </div>
          ))}
        </div>
      )}
      {parsed && parsed.meta.length > 0 && (
        <div className="rounded-md border border-[var(--color-card-border)] bg-[var(--color-surface-container)] p-3 space-y-1">
          {parsed.meta.map((m, i) => (
            <div key={i} className="flex gap-2 text-xs">
              <span className="font-label uppercase tracking-wide text-on-surface-variant w-28 shrink-0">
                {m.key}
              </span>
              <span className="font-mono text-on-surface break-all">{m.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

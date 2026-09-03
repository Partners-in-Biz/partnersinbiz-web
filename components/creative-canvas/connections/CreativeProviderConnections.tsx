'use client'

import { useEffect, useState } from 'react'
import { canvasTheme } from '@/components/creative-canvas/theme/tokens'
import { listCreativeCanvasProviders } from '@/lib/creative-canvas/providers'
import type { CreativeProviderConnectionMasked } from '@/lib/creative-canvas/connections/types'
import {
  listConnections,
  createConnection,
  revokeConnection,
  validateConnection,
} from '@/lib/creative-canvas/connections/client'

const connectable = listCreativeCanvasProviders().filter((p) => p.connection)

const label: React.CSSProperties = { fontSize: 12, color: canvasTheme.textMuted, fontWeight: 600 }
const input: React.CSSProperties = {
  width: '100%', fontSize: 13, padding: '7px 9px', borderRadius: 8,
  background: canvasTheme.surfaceRaised, color: canvasTheme.text,
  border: `1px solid ${canvasTheme.border}`,
}
const btn: React.CSSProperties = {
  appearance: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
  padding: '7px 12px', borderRadius: 8, border: `1px solid ${canvasTheme.border}`,
  background: canvasTheme.surfaceRaised, color: canvasTheme.text,
}
const btnAccent: React.CSSProperties = { ...btn, background: canvasTheme.accent, color: canvasTheme.accentText, border: 'none' }

function statusTone(s: string): { bg: string; text: string; label: string } {
  if (s === 'connected') return { bg: '#3ddc97', text: canvasTheme.accentText, label: 'Connected' }
  if (s === 'invalid') return { bg: '#ffb547', text: canvasTheme.accentText, label: 'Invalid' }
  if (s === 'reauth_required') return { bg: '#ffb547', text: canvasTheme.accentText, label: 'Reauth required' }
  return { bg: canvasTheme.surfaceRaised, text: canvasTheme.textMuted, label: s }
}

function Pill({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: bg, color }}>{children}</span>
}

export default function CreativeProviderConnections({ orgId, onChanged }: { orgId: string; onChanged?: () => void }) {
  const [connections, setConnections] = useState<CreativeProviderConnectionMasked[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openForm, setOpenForm] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      setConnections(await listConnections(orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load connections')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const patchRow = (next: CreativeProviderConnectionMasked) =>
    setConnections((rows) => rows.map((r) => (r.id === next.id ? next : r)))

  if (loading) return <div style={{ ...label, padding: 12 }}>Loading connections…</div>
  if (error) return <div role="alert" style={{ ...label, color: '#ff7a7a', padding: 12 }}>{error}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {connectable.map((provider) => {
        const matches = connections.filter((c) => c.provider === provider.key && c.status !== 'revoked')
        const conn = matches.find((c) => c.scope === 'user') ?? matches[0] ?? null
        return (
          <div key={provider.key} style={{ border: `1px solid ${canvasTheme.border}`, borderRadius: 12, background: canvasTheme.surface, padding: 12 }}>
            {conn ? (
              <ConnectedRow
                connection={conn}
                onValidate={async () => {
                  const { connection, validation } = await validateConnection(orgId, conn.id)
                  patchRow(connection)
                  if (!validation.ok) throw new Error(validation.error ?? 'Validation failed')
                }}
                onDisconnect={async () => {
                  await revokeConnection(orgId, conn.id)
                  await refresh()
                  onChanged?.()
                }}
              />
            ) : openForm === provider.key ? (
              <ConnectForm
                provider={provider}
                onCancel={() => setOpenForm(null)}
                onSubmit={async (payload) => {
                  await createConnection({ orgId, provider: provider.key, ...payload })
                  setOpenForm(null)
                  await refresh()
                  onChanged?.()
                }}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: canvasTheme.text }}>{provider.label}</span>
                <button type="button" style={btnAccent} onClick={() => setOpenForm(provider.key)}>Connect {provider.label}</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ConnectedRow({
  connection, onValidate, onDisconnect,
}: {
  connection: CreativeProviderConnectionMasked
  onValidate: () => Promise<void>
  onDisconnect: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)
  const tone = statusTone(connection.status)
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true)
    setRowError(null)
    try { await fn() } catch (e) { setRowError(e instanceof Error ? e.message : 'Action failed') } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: canvasTheme.text }}>{connection.label}</span>
          <Pill bg={canvasTheme.surfaceRaised} color={canvasTheme.textMuted}>{connection.scope === 'user' ? 'Personal' : 'Organisation'}</Pill>
          <Pill bg={tone.bg} color={tone.text}>{tone.label}</Pill>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={btn} disabled={busy} onClick={run(onValidate)}>Re-validate</button>
          <button type="button" style={{ ...btn, color: '#ff7a7a' }} disabled={busy} onClick={run(onDisconnect)}>Disconnect</button>
        </div>
      </div>
      <span style={{ ...label, fontFamily: 'monospace' }}>{connection.credentialHint}</span>
      {rowError && <span role="alert" style={{ fontSize: 12, color: '#ff7a7a' }}>{rowError}</span>}
    </div>
  )
}

function ConnectForm({
  provider, onCancel, onSubmit,
}: {
  provider: ReturnType<typeof listCreativeCanvasProviders>[number]
  onCancel: () => void
  onSubmit: (payload: { scope: 'org' | 'user'; label: string; credentials: Record<string, string> }) => Promise<void>
}) {
  const conn = provider.connection!
  const [values, setValues] = useState<Record<string, string>>({})
  const [nickname, setNickname] = useState('')
  const [scope, setScope] = useState<'org' | 'user'>('org')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const submit = async () => {
    setSubmitting(true)
    setFormError(null)
    try {
      await onSubmit({ scope, label: nickname.trim() || provider.label, credentials: values })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to connect')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: canvasTheme.text }}>Connect {provider.label}</span>
        <a href={conn.consoleUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: canvasTheme.accent }}>Get your key →</a>
      </div>
      {conn.credentialFields.map((field) => (
        <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor={`cc-${provider.key}-${field.key}`} style={label}>{field.label}</label>
          <input
            id={`cc-${provider.key}-${field.key}`}
            style={input}
            type={field.secret ? 'password' : 'text'}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
           aria-label="Input"/>
        </div>
      ))}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label htmlFor={`cc-${provider.key}-nickname`} style={label}>Nickname (optional)</label>
        <input id={`cc-${provider.key}-nickname`} style={input} type="text" value={nickname} onChange={(e) => setNickname(e.target.value)}  aria-label="Input"/>
      </div>
      <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6, color: canvasTheme.text }}>
          <input type="radio" name={`scope-${provider.key}`} checked={scope === 'org'} onChange={() => setScope('org')}  aria-label="Input"/> This organisation
        </label>
        <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 6, color: canvasTheme.text }}>
          <input type="radio" name={`scope-${provider.key}`} checked={scope === 'user'} onChange={() => setScope('user')}  aria-label="Input"/> Just me (usable in all my orgs)
        </label>
      </div>
      {formError && <span role="alert" style={{ fontSize: 12, color: '#ff7a7a' }}>{formError}</span>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" style={btn} onClick={onCancel}>Cancel</button>
        <button type="button" style={btnAccent} disabled={submitting} onClick={() => { void submit() }}>Connect</button>
      </div>
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Surface, StatusPill, DialogDrawer, EmptyState } from '@/components/ui/AppFoundation'
import { apiGet, apiSend, formatDateTime } from '@/components/admin/orgs/OrgDetailApi'

interface RotationLogEntry {
  at: string | null
  actorUid: string
  note: string
}

interface PlatformCredential {
  key: string
  label: string
  oauthPlatform: string
  configured: boolean
  clientIdMasked: string | null
  hasClientSecret: boolean
  authUrl: string | null
  tokenUrl: string | null
  callbackUrl: string
  scopes: string[]
  enabled: boolean
  apiVersion: string | null
  webhookToken: string | null
  webhookTokenMasked: string | null
  lastRotatedAt: string | null
  rotationLog: RotationLogEntry[]
  notes: string
  updatedAt: string | null
}

interface Summary {
  total: number
  configured: number
  missing: number
  disabled: number
  withWebhookToken: number
  inboxWebhookSecret: boolean
}

interface Payload {
  platforms: PlatformCredential[]
  summary: Summary
}

interface TestCheck {
  name: string
  ok: boolean
  detail: string
}

interface TestResult {
  key: string
  label: string
  ok: boolean
  checks: TestCheck[]
  authorizeUrl: string | null
  providerStatus: number | null
  testedAt: string
}

export function SocialCredentialsManager() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await apiGet<Payload>('/api/v1/admin/social-credentials')
      setData(d)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load social credentials')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ── Edit settings drawer ────────────────────────────────────────────────
  const [editing, setEditing] = useState<PlatformCredential | null>(null)
  const [formApiVersion, setFormApiVersion] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  function openEdit(p: PlatformCredential) {
    setEditing(p)
    setFormApiVersion(p.apiVersion ?? '')
    setFormNotes(p.notes ?? '')
    setFormEnabled(p.enabled)
    setFormError('')
  }

  async function saveSettings() {
    if (!editing) return
    setSaving(true)
    setFormError('')
    try {
      await apiSend('/api/v1/admin/social-credentials', 'POST', {
        key: editing.key,
        enabled: formEnabled,
        apiVersion: formApiVersion,
        notes: formNotes,
      })
      setEditing(null)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  // ── Test handshake ──────────────────────────────────────────────────────
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testingKey, setTestingKey] = useState<string | null>(null)

  async function runTest(p: PlatformCredential) {
    setTestingKey(p.key)
    setTestResult(null)
    try {
      const r = await apiSend<TestResult>(`/api/v1/admin/social-credentials/${encodeURIComponent(p.key)}/test`, 'POST', {})
      setTestResult(r)
    } catch (e) {
      setTestResult({
        key: p.key,
        label: p.label,
        ok: false,
        checks: [{ name: 'Request', ok: false, detail: e instanceof Error ? e.message : 'Test failed' }],
        authorizeUrl: null,
        providerStatus: null,
        testedAt: new Date().toISOString(),
      })
    } finally {
      setTestingKey(null)
    }
  }

  // ── Rotation ────────────────────────────────────────────────────────────
  const [rotateTarget, setRotateTarget] = useState<{ p: PlatformCredential; target: 'webhook' | 'secret' } | null>(null)
  const [rotateNote, setRotateNote] = useState('')
  const [rotating, setRotating] = useState(false)
  const [rotateError, setRotateError] = useState('')
  const [rotateResult, setRotateResult] = useState<{ newWebhookToken?: string; instruction?: string; envName?: string } | null>(null)

  async function confirmRotate() {
    if (!rotateTarget) return
    setRotating(true)
    setRotateError('')
    try {
      const r = await apiSend<{ newWebhookToken?: string; instruction?: string; envName?: string }>(
        `/api/v1/admin/social-credentials/${encodeURIComponent(rotateTarget.p.key)}/rotate`,
        'POST',
        { target: rotateTarget.target, note: rotateNote.trim() },
      )
      setRotateResult(r)
      await load()
    } catch (e) {
      setRotateError(e instanceof Error ? e.message : 'Rotation failed')
    } finally {
      setRotating(false)
    }
  }

  function closeRotate() {
    setRotateTarget(null)
    setRotateNote('')
    setRotateError('')
    setRotateResult(null)
  }

  const summary = data?.summary
  const platforms = useMemo(() => data?.platforms ?? [], [data])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="pib-card p-6">
        <p className="eyebrow">Integrations</p>
        <h1 className="pib-page-title mt-2">Social API credentials</h1>
        <p className="mt-3 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Per-platform OAuth app configuration: view masked credentials, test the OAuth handshake, pin API
          versions, manage webhook verification tokens, and rotate secrets. Client IDs &amp; secrets live in Vercel
          env vars; operator settings live in <code className="mx-1">social_credential_settings</code>.
        </p>
      </header>

      {error && <div className="pib-card border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-400">{error}</div>}

      {loading ? (
        <div className="pib-card p-8 text-sm text-[var(--color-pib-text-muted)]">Loading credentials…</div>
      ) : (
        <>
          {summary && (
            <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
              {[
                { label: 'Configured', value: summary.configured },
                { label: 'Missing', value: summary.missing },
                { label: 'Disabled', value: summary.disabled },
                { label: 'Webhook tokens', value: summary.withWebhookToken },
                { label: 'Inbox secret', value: summary.inboxWebhookSecret ? 'Present' : 'Missing' },
              ].map((m) => (
                <div key={m.label} className="pib-card p-5">
                  <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">{m.label}</p>
                  <p className="mt-3 text-2xl font-semibold text-on-surface">{m.value}</p>
                </div>
              ))}
            </section>
          )}

          {platforms.length === 0 ? (
            <EmptyState icon="key" title="No platforms" description="No social platform variants are registered." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {platforms.map((p) => (
                <Surface
                  key={p.key}
                  header={
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="font-label">{p.label}</span>
                      <div className="flex items-center gap-2">
                        <StatusPill tone={p.configured ? 'success' : 'danger'}>
                          {p.configured ? 'Configured' : 'Missing'}
                        </StatusPill>
                        <StatusPill tone={p.enabled ? 'neutral' : 'warn'}>
                          {p.enabled ? 'Enabled' : 'Disabled'}
                        </StatusPill>
                      </div>
                    </div>
                  }
                >
                  <dl className="space-y-2 text-sm">
                    <Row label="Client ID" value={<code className="text-on-surface">{p.clientIdMasked ?? '—'}</code>} />
                    <Row label="Client secret" value={p.hasClientSecret ? 'Present (env)' : 'Missing'} />
                    <Row label="Callback" value={<code className="break-all text-xs text-on-surface-variant">{p.callbackUrl}</code>} />
                    <Row label="Scopes" value={p.scopes.length ? `${p.scopes.length} scope${p.scopes.length === 1 ? '' : 's'}` : '—'} />
                    <Row label="API version pin" value={p.apiVersion ?? <span className="text-on-surface-variant">none</span>} />
                    <Row label="Webhook token" value={p.webhookTokenMasked ? <code className="text-on-surface">{p.webhookTokenMasked}</code> : <span className="text-on-surface-variant">none</span>} />
                    <Row label="Last rotated" value={p.lastRotatedAt ? formatDateTime(p.lastRotatedAt) : '—'} />
                  </dl>

                  {p.scopes.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {p.scopes.map((s) => (
                        <span key={s} className="rounded bg-white/5 px-2 py-0.5 text-[10px] text-on-surface-variant">{s}</span>
                      ))}
                    </div>
                  )}

                  {p.rotationLog.length > 0 && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-on-surface-variant">Rotation history ({p.rotationLog.length})</summary>
                      <ul className="mt-2 space-y-1">
                        {p.rotationLog.map((entry, i) => (
                          <li key={`${p.key}-rot-${i}`} className="text-xs text-on-surface-variant">
                            <span className="opacity-70">{formatDateTime(entry.at)}</span> — {entry.note}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className="pib-btn-secondary text-xs" disabled={testingKey === p.key} onClick={() => void runTest(p)}>
                      {testingKey === p.key ? 'Testing…' : 'Test handshake'}
                    </button>
                    <button type="button" className="pib-btn-ghost text-xs" onClick={() => openEdit(p)}>Edit settings</button>
                    <button type="button" className="pib-btn-ghost text-xs" onClick={() => { setRotateResult(null); setRotateNote(''); setRotateError(''); setRotateTarget({ p, target: 'webhook' }) }}>
                      Rotate webhook
                    </button>
                    <button type="button" className="pib-btn-ghost text-xs text-amber-400" onClick={() => { setRotateResult(null); setRotateNote(''); setRotateError(''); setRotateTarget({ p, target: 'secret' }) }}>
                      Rotate secret
                    </button>
                  </div>
                </Surface>
              ))}
            </div>
          )}
        </>
      )}

      {/* Edit settings drawer */}
      <DialogDrawer
        open={editing !== null}
        title={editing ? `${editing.label} settings` : ''}
        description="Pin the API version, toggle availability, and capture operator notes."
        onClose={() => setEditing(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" className="pib-btn-primary" disabled={saving} onClick={saveSettings}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input type="checkbox" checked={formEnabled} onChange={(e) => setFormEnabled(e.target.checked)} />
            Enabled (available to orgs)
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">API version pin</span>
            <input className="pib-input mt-1 w-full" placeholder="e.g. v19.0" value={formApiVersion} onChange={(e) => setFormApiVersion(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Notes</span>
            <textarea className="pib-input mt-1 w-full" rows={3} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
          </label>
        </div>
      </DialogDrawer>

      {/* Test result drawer */}
      <DialogDrawer
        open={testResult !== null}
        title={testResult ? `${testResult.label} — handshake ${testResult.ok ? 'passed' : 'failed'}` : ''}
        description="OAuth configuration + provider reachability check. No tokens were persisted."
        onClose={() => setTestResult(null)}
        footer={<div className="flex justify-end"><button type="button" className="pib-btn-secondary" onClick={() => setTestResult(null)}>Close</button></div>}
      >
        {testResult && (
          <div className="space-y-3">
            <ul className="space-y-2">
              {testResult.checks.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <StatusPill tone={c.ok ? 'success' : 'danger'}>{c.ok ? 'OK' : 'Fail'}</StatusPill>
                  <span><span className="text-on-surface">{c.name}</span> <span className="text-on-surface-variant">— {c.detail}</span></span>
                </li>
              ))}
            </ul>
            {testResult.authorizeUrl && (
              <div>
                <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Authorization URL</p>
                <code className="mt-1 block break-all rounded bg-white/5 p-2 text-xs text-on-surface-variant">{testResult.authorizeUrl}</code>
              </div>
            )}
            <p className="text-xs text-on-surface-variant">Tested {formatDateTime(testResult.testedAt)}</p>
          </div>
        )}
      </DialogDrawer>

      {/* Rotate drawer */}
      <DialogDrawer
        open={rotateTarget !== null}
        title={rotateTarget ? `Rotate ${rotateTarget.target === 'webhook' ? 'webhook token' : 'client secret'} — ${rotateTarget.p.label}` : ''}
        description={
          rotateTarget?.target === 'webhook'
            ? 'Generates a new webhook verification token and stores it. The old token stops working immediately.'
            : 'OAuth client secrets live in Vercel env vars. This records the rotation request and tells you which env var to update.'
        }
        onClose={closeRotate}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="pib-btn-secondary" onClick={closeRotate}>{rotateResult ? 'Done' : 'Cancel'}</button>
            {!rotateResult && (
              <button type="button" className="pib-btn-primary" disabled={rotating} onClick={confirmRotate}>
                {rotating ? 'Rotating…' : 'Confirm rotation'}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          {rotateError && <p className="text-sm text-red-400">{rotateError}</p>}
          {!rotateResult ? (
            <label className="block">
              <span className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Reason / note (optional)</span>
              <textarea className="pib-input mt-1 w-full" rows={2} value={rotateNote} onChange={(e) => setRotateNote(e.target.value)} placeholder="Why are you rotating?" />
            </label>
          ) : (
            <div className="space-y-2">
              {rotateResult.newWebhookToken && (
                <div>
                  <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">New webhook token (shown once)</p>
                  <code className="mt-1 block break-all rounded bg-emerald-500/10 p-2 text-xs text-emerald-300">{rotateResult.newWebhookToken}</code>
                </div>
              )}
              {rotateResult.instruction && (
                <p className="text-sm text-amber-300">{rotateResult.instruction}</p>
              )}
              {rotateResult.envName && (
                <code className="block rounded bg-white/5 p-2 text-xs text-on-surface-variant">{rotateResult.envName}</code>
              )}
            </div>
          )}
        </div>
      </DialogDrawer>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-right text-on-surface">{value}</dd>
    </div>
  )
}

export default SocialCredentialsManager

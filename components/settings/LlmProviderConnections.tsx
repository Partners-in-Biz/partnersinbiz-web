'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LlmProviderConnectionMasked, LlmOauthSessionPublic, LlmShareMode, LlmShareTargets } from '@/lib/llm-providers/types'
import { DEFAULT_LLM_SHARE_TARGETS } from '@/lib/llm-providers/types'
import type { LlmProviderDefinition } from '@/lib/llm-providers/providers'
import {
  listLlmProviderCatalog,
  connectLlmApiKey,
  startLlmOauth,
  pollLlmOauth,
  exchangeLlmOauth,
  revokeLlmConnection,
  resyncLlmConnection,
  updateLlmShareTargets,
  type LlmProviderCatalogResponse,
} from '@/lib/llm-providers/client'

function statusTone(status: string) {
  if (status === 'connected') return 'bg-emerald-500/15 text-emerald-300'
  if (status === 'invalid' || status === 'reauth_required') return 'bg-[color-mix(in_srgb,var(--st-warning)_15%,transparent)] text-[var(--st-warning)]'
  return 'bg-white/[0.06] text-[var(--color-pib-text-muted)]'
}

function oauthVerifyUrl(session: LlmOauthSessionPublic): string {
  return session.authorizeUrl || session.verificationUriComplete || session.verificationUri || ''
}

export default function LlmProviderConnections({ orgId }: { orgId: string }) {
  const [providers, setProviders] = useState<LlmProviderDefinition[]>([])
  const [connections, setConnections] = useState<LlmProviderConnectionMasked[]>([])
  const [bindings, setBindings] = useState<LlmProviderCatalogResponse['bindings']>([])
  const [canManageOrgConnections, setCanManageOrgConnections] = useState(false)
  const [syncTargets, setSyncTargets] = useState<LlmProviderCatalogResponse['syncTargets']>()
  const [notes, setNotes] = useState<LlmProviderCatalogResponse['notes'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [oauthSession, setOauthSession] = useState<LlmOauthSessionPublic | null>(null)
  const [codeCopied, setCodeCopied] = useState(false)
  const [authCode, setAuthCode] = useState('')
  const [exchanging, setExchanging] = useState(false)
  const oauthBannerRef = useRef<HTMLDivElement | null>(null)
  const oauthProviderLabel = oauthSession
    ? providers.find((provider) => provider.key === oauthSession.provider)?.label || 'provider'
    : 'provider'

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listLlmProviderCatalog(orgId)
      setProviders(data.providers)
      setConnections(data.connections)
      setBindings(data.bindings ?? [])
      setCanManageOrgConnections(data.canManageOrgConnections)
      setSyncTargets(data.syncTargets)
      setNotes(data.notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load LLM providers')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!oauthSession) return
    const isDeviceFlow = oauthSession.status === 'pending'
    const isAwaitingCode = oauthSession.status === 'awaiting_code'
    // Keep the sign-in banner in view for BOTH flows  -  previously it sat above
    // a long list while the connect form stayed open, so "Connect with OAuth"
    // looked dead. Claude's authorization_code flow (awaiting_code) needs the
    // same scroll so the paste-code box is visible when the user returns.
    if (isDeviceFlow || isAwaitingCode) {
      oauthBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    // Only device-code sessions poll a token endpoint; authorization_code
    // sessions wait for the human to paste the hosted-callback code.
    if (!isDeviceFlow) return
    const intervalMs = Math.max(3000, (oauthSession.intervalSeconds || 5) * 1000)
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const result = await pollLlmOauth(orgId, oauthSession.id)
          setOauthSession(result.session)
          if (result.connection) {
            setOauthSession(null)
            setOpenForm(null)
            await refresh()
          }
          if (result.session.status === 'failed' || result.session.status === 'expired') {
            setError(result.session.error || 'OAuth failed')
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'OAuth poll failed')
        }
      })()
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [oauthSession, orgId, refresh])

  const beginOauth = useCallback(async (providerKey: string, payload: { scope: 'org' | 'user'; label?: string }) => {
    setError(null)
    const { session } = await startLlmOauth({
      orgId,
      provider: providerKey,
      ...payload,
    })
    if (!session?.id || (session.status !== 'pending' && session.status !== 'awaiting_code')) {
      throw new Error('OAuth session did not start. Try again, or check the browser console for a blocked request.')
    }
    setOauthSession(session)
    setOpenForm(null)
    setCodeCopied(false)
    setAuthCode('')
    const url = oauthVerifyUrl(session)
    // Device-code flows need a visible code + link. Opening the verify page
    // immediately is the strongest signal that the click worked.
    if (url) {
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (!opened) {
        // Popup blocked  -  banner still has the link and code.
        setError('Browser blocked the sign-in tab. Use the link in “Complete sign-in” below and enter the code.')
      }
    }
  }, [orgId])

  const copyUserCode = useCallback(async () => {
    if (!oauthSession?.userCode) return
    try {
      await navigator.clipboard.writeText(oauthSession.userCode)
      setCodeCopied(true)
      window.setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      setError('Could not copy code  -  select it manually.')
    }
  }, [oauthSession?.userCode])

  const submitAuthCode = useCallback(async () => {
    if (!oauthSession || !authCode.trim()) return
    setExchanging(true)
    setError(null)
    try {
      // Anthropic's hosted callback page shows (and its Copy button copies) the
      // combined "code#state" string. Split it so the OAuth code is exchanged
      // and the state is validated against the session instead of being sent
      // as part of the code (which Anthropic rejects as invalid_grant).
      const [codePart, statePart] = authCode.trim().split('#', 2)
      if (!codePart) {
        setError('Paste the code from the Anthropic sign-in page first.')
        return
      }
      const result = await exchangeLlmOauth(orgId, oauthSession.id, codePart, statePart || undefined)
      if (result.connection) {
        setOauthSession(null)
        setOpenForm(null)
        setAuthCode('')
        await refresh()
        return
      }
      if (result.session.status === 'failed' || result.session.status === 'expired') {
        setError(result.session.error || 'OAuth exchange failed')
        setOauthSession(result.session)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OAuth exchange failed')
    } finally {
      setExchanging(false)
    }
  }, [oauthSession, authCode, orgId, refresh])

  if (loading) {
    return <p className="text-sm text-[var(--color-pib-text-muted)]">Loading LLM providers…</p>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-[var(--color-pib-line)] bg-white/[0.03] px-4 py-3 text-sm text-[var(--color-pib-text-muted)] space-y-2">
        <p>
          <span className="font-medium text-[var(--color-pib-text)]">Organisation VPS</span>
          {'  -  '}
          {notes?.orgScope
            || 'Shared credentials sync only to this organisation’s VPS and are used by everyone on that VPS.'}
        </p>
        <p>
          <span className="font-medium text-[var(--color-pib-text)]">Linked computers</span>
          {'  -  '}
          {notes?.userScope
            || 'Personal credentials sync only to computers owned by your account.'}
        </p>
        {syncTargets && syncTargets.targetCount === 0 && syncTargets.reasonIfEmpty ? (
          <p className="text-[color-mix(in_srgb,var(--st-warning)_90%,transparent)]">{syncTargets.reasonIfEmpty}</p>
        ) : syncTargets && syncTargets.targetCount > 0 ? (
          <p>
            Organisation sync targets ready: {syncTargets.targetCount}
            {syncTargets.orgVpsDeviceCount > 0 ? ` (${syncTargets.orgVpsDeviceCount} org VPS device${syncTargets.orgVpsDeviceCount === 1 ? '' : 's'})` : ''}
          </p>
        ) : null}
        {connections.length === 0 && notes?.hermesNative ? (
          <p className="text-[color-mix(in_srgb,var(--st-warning)_90%,transparent)]">{notes.hermesNative}</p>
        ) : notes?.hermesNative ? (
          <p>{notes.hermesNative}</p>
        ) : null}
        {notes?.cursor ? <p>{notes.cursor}</p> : null}
      </div>
      {error && (
        <div role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {oauthSession && (oauthSession.status === 'pending' || oauthSession.status === 'awaiting_code') && (
        <div
          ref={oauthBannerRef}
          role="status"
          aria-live="polite"
          className="rounded-md border-2 border-[var(--color-pib-accent)]/50 bg-[var(--color-pib-accent-soft)] px-4 py-4 text-sm shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
        >
          <p className="font-medium text-[var(--color-pib-text)]">Complete sign-in</p>
          {oauthSession.flow === 'authorization_code' ? (
            <>
              <p className="mt-1 text-[var(--color-pib-text-muted)]">
                Approve with {oauthProviderLabel}. A sign-in tab should have opened  -  if not, use the link below. After
                approving, Anthropic shows a page that says “Paste this into Claude Code”  -  that is the code you need.
                Copy it and paste it into the field below.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  className="pib-btn-primary text-xs"
                  href={oauthVerifyUrl(oauthSession)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open sign-in page
                </a>
              </div>
              <label className="mt-3 block text-xs text-[var(--color-pib-text-muted)]">
                Authorization code
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-black/30 px-3 py-2 font-mono text-sm text-[var(--color-pib-text)]"
                  placeholder="Paste the code from Anthropic here"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitAuthCode()
                  }}
                />
              </label>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="pib-btn-primary text-xs"
                  disabled={exchanging || !authCode.trim()}
                  onClick={() => void submitAuthCode()}
                >
                  {exchanging ? 'Exchanging…' : 'Submit code'}
                </button>
                <button
                  type="button"
                  className="mt-0 text-xs text-[var(--color-pib-text-muted)] underline"
                  onClick={() => setOauthSession(null)}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 text-[var(--color-pib-text-muted)]">
                Approve this device with {oauthProviderLabel}. A sign-in tab should have opened  -  if not, use the link below.
              </p>
              {oauthSession.userCode ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-[var(--color-pib-line)] bg-black/30 px-3 py-2 font-mono text-lg tracking-wider text-[var(--color-pib-text)]">
                    {oauthSession.userCode}
                  </span>
                  <button type="button" className="btn-pib-secondary text-xs" onClick={() => void copyUserCode()}>
                    {codeCopied ? 'Copied' : 'Copy code'}
                  </button>
                  <a
                    className="pib-btn-primary text-xs"
                    href={oauthVerifyUrl(oauthSession)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open sign-in page
                  </a>
                </div>
              ) : (
                <p className="mt-3">
                  <a
                    className="text-[var(--color-pib-accent-hover)] underline"
                    href={oauthVerifyUrl(oauthSession)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {oauthSession.verificationUri}
                  </a>
                </p>
              )}
              <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Waiting for approval… this page updates automatically.</p>
              <button
                type="button"
                className="mt-3 text-xs text-[var(--color-pib-text-muted)] underline"
                onClick={() => setOauthSession(null)}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      <div className="space-y-3">
        {providers.map((provider) => {
          const matches = connections.filter((c) => c.provider === provider.key)
          return (
            <div
              key={provider.key}
              className="rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] p-4 space-y-3"
            >
              {matches.length > 0 ? (
                matches.map((conn) => (
                  <ConnectedRow
                    key={conn.id}
                    connection={conn}
                    bindings={bindings.filter((binding) => binding.connectionId === conn.id)}
                    canManageOrgConnections={canManageOrgConnections}
                    orgId={orgId}
                    onShareSaved={refresh}
                    onResync={async () => {
                      type SyncPayload = {
                        failed?: Array<{ agentId: string; error: string }>
                        synced?: string[]
                        message?: string
                        verified?: Array<{ agentId: string; usable: boolean; detail?: string }>
                      }
                      const result = await resyncLlmConnection(orgId, conn.id)
                      const payload = (result && typeof result === 'object'
                        ? result as { sync?: SyncPayload } & SyncPayload
                        : {}) as { sync?: SyncPayload } & SyncPayload
                      const sync: SyncPayload = payload.sync ?? payload
                      await refresh()
                      if (sync.failed && sync.failed.length > 0) {
                        const detail = sync.failed
                          .map((f: { agentId: string; error: string }) => `${f.agentId}: ${f.error}`)
                          .join(' · ')
                        throw new Error(sync.message ? `${sync.message} ${detail}` : detail)
                      }
                    }}
                    onReconnect={async () => {
                      await beginOauth(conn.provider, {
                        scope: conn.scope,
                        label: conn.label,
                      })
                    }}
                    onDisconnect={async () => {
                      await revokeLlmConnection(orgId, conn.id)
                      await refresh()
                    }}
                  />
                ))
              ) : null}
              {matches.length === 0 || openForm === provider.key ? (
                openForm === provider.key ? (
                  <ConnectForm
                    provider={provider}
                    canManageOrgConnections={canManageOrgConnections}
                    onCancel={() => setOpenForm(null)}
                    onApiKey={async (payload) => {
                      await connectLlmApiKey({ orgId, provider: provider.key, ...payload })
                      setOpenForm(null)
                      await refresh()
                    }}
                    onOauth={(payload) => beginOauth(provider.key, payload)}
                  />
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-pib-text)]">{provider.label}</p>
                      <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">{provider.description}</p>
                    </div>
                    <button
                      type="button"
                      className="pib-btn-primary shrink-0 text-xs"
                      onClick={() => setOpenForm(provider.key)}
                    >
                      Connect
                    </button>
                  </div>
                )
              ) : (
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn-pib-secondary text-xs"
                    onClick={() => setOpenForm(provider.key)}
                  >
                    Add another scope
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function shareModeLabel(mode: LlmShareMode): string {
  if (mode === 'organization') return 'everyone in the organisation'
  if (mode === 'teams') return 'selected teams'
  if (mode === 'selected_users') return 'selected people'
  return 'organisation admins and the organisation VPS'
}

function ShareTargetsEditor({
  orgId,
  connection,
  canManage,
  onSaved,
}: {
  orgId: string
  connection: LlmProviderConnectionMasked
  canManage: boolean
  onSaved: () => Promise<void>
}) {
  const share = connection.shareTargets ?? DEFAULT_LLM_SHARE_TARGETS
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<LlmShareMode>(share.mode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (next: LlmShareTargets) => {
    setSaving(true)
    setError(null)
    try {
      await updateLlmShareTargets(orgId, connection.id, next)
      await onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update sharing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--color-pib-text-muted)]">
        Delivered to: {shareModeLabel(share.mode)}
        {connection.meta?.rotateRecommended ? ' · Rotate this key — a revoke is still pending on an offline computer.' : ''}
      </p>
      {canManage ? (
        <details open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-[11px] font-medium text-[var(--color-pib-text)]">Sharing</summary>
          <div className="mt-2 space-y-1 text-[11px] text-[var(--color-pib-text-muted)]">
            {([
              ['admins', 'Admins and organisation VPS only'],
              ['organization', 'Everyone in the organisation'],
              ['teams', 'Selected teams'],
              ['selected_users', 'Selected people'],
            ] as Array<[LlmShareMode, string]>).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`share-${connection.id}`}
                  checked={mode === value}
                  disabled={saving}
                  onChange={() => {
                    setMode(value)
                    void save({ ...share, mode: value })
                  }}
                />
                {label}
              </label>
            ))}
            {error ? <p role="alert" className="text-red-200">{error}</p> : null}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function ConnectedRow({
  connection,
  bindings,
  canManageOrgConnections,
  orgId,
  onResync,
  onReconnect,
  onDisconnect,
  onShareSaved,
}: {
  connection: LlmProviderConnectionMasked
  bindings: LlmProviderCatalogResponse['bindings']
  canManageOrgConnections: boolean
  orgId: string
  onResync: () => Promise<void>
  onReconnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onShareSaved: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)
  const isPersonal = connection.scope === 'user'
  const canManage = isPersonal || canManageOrgConnections
  const currentBindings = bindings.filter(
    (binding) => binding.credentialVersion === connection.credentialVersion,
  )
  const hasLinkedBindings = currentBindings.some((binding) => Boolean(binding.deviceId))
  const visibleBindings = hasLinkedBindings
    ? currentBindings.filter((binding) => Boolean(binding.deviceId))
    : currentBindings
  const readyCount = visibleBindings.filter(
    (binding) => binding.status === 'ready' && binding.liveAuthVerified,
  ).length
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true)
    setRowError(null)
    try {
      await fn()
    } catch (e) {
      setRowError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[var(--color-pib-text)]">{connection.label}</span>
          <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[10px] text-[var(--color-pib-text-muted)]">
            {isPersonal ? 'Personal · linked computer' : canManage ? 'Organisation · VPS' : 'Shared by organisation'}
          </span>
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${statusTone(connection.status)}`}>
            {connection.status}
          </span>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            {connection.status === 'reauth_required' ? (
              <button type="button" className="pib-btn-primary text-xs" disabled={busy} onClick={run(onReconnect)}>
                Reconnect account
              </button>
            ) : (
              <button type="button" className="btn-pib-secondary text-xs" disabled={busy} onClick={run(onResync)}>
                {isPersonal ? 'Sync to my computers' : 'Sync to organisation VPS'}
              </button>
            )}
            <button
              type="button"
              className="btn-pib-secondary text-xs text-red-300"
              disabled={busy}
              onClick={run(onDisconnect)}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <span className="text-[11px] text-[var(--color-pib-text-muted)]">Managed by an organisation admin</span>
        )}
      </div>
      {canManage ? (
        <p className="font-mono text-xs text-[var(--color-pib-text-muted)]">{connection.credentialHint}</p>
      ) : null}
      {isPersonal ? (
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">
          Syncs only to computers owned by your account. The shared organisation VPS never receives this credential.
        </p>
      ) : (
        <ShareTargetsEditor
          orgId={orgId}
          connection={connection}
          canManage={canManageOrgConnections}
          onSaved={onShareSaved}
        />
      )}
      {visibleBindings.length > 0 ? (
        <p className="text-[11px] text-[var(--color-pib-text-muted)]">
          Live verified on {isPersonal ? 'your linked computers' : 'the organisation VPS'}:{' '}
          <span className={readyCount === visibleBindings.length ? 'text-emerald-300' : 'text-[var(--st-warning)]'}>
            {readyCount}/{visibleBindings.length} profiles
          </span>
        </p>
      ) : null}
      {visibleBindings.length > 0 && (
        <div className="space-y-1">
          {visibleBindings.map((binding) => (
            <p key={binding.id} className="text-[11px] text-[var(--color-pib-text-muted)]">
              {binding.machineLabel} · {binding.agentId}:{' '}
              <span className={binding.liveAuthVerified ? 'text-emerald-300' : binding.status === 'failed' ? 'text-red-200' : 'text-[var(--st-warning)]'}>
                {binding.liveAuthVerified ? 'Ready · live verified' : binding.status}
              </span>
              {binding.lastError ? `  -  ${binding.lastError}` : ''}
            </p>
          ))}
        </div>
      )}
      {connection.lastError && visibleBindings.length === 0 && (
        <p className="text-xs text-[var(--st-warning)]">{connection.lastError}</p>
      )}
      {rowError && <p role="alert" className="text-xs text-red-200">{rowError}</p>}
    </div>
  )
}

function ConnectForm({
  provider,
  canManageOrgConnections,
  onCancel,
  onApiKey,
  onOauth,
}: {
  provider: LlmProviderDefinition
  canManageOrgConnections: boolean
  onCancel: () => void
  onApiKey: (payload: { scope: 'org' | 'user'; label: string; credentials: Record<string, string> }) => Promise<void>
  onOauth: (payload: { scope: 'org' | 'user'; label?: string }) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [nickname, setNickname] = useState('')
  const [scope, setScope] = useState<'org' | 'user'>(canManageOrgConnections ? 'org' : 'user')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const wantsOauth = provider.oauthCapable && (provider.credentialFields.length === 0 || provider.key === 'anthropic')
  const canApiKey = provider.credentialFields.length > 0

  const submit = async (mode: 'oauth' | 'api_key') => {
    setSubmitting(true)
    setFormError(null)
    try {
      if (mode === 'oauth') {
        await onOauth({ scope, label: nickname.trim() || undefined })
      } else {
        await onApiKey({ scope, label: nickname.trim() || provider.label, credentials: values })
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to connect')
    } finally {
      // Always re-enable controls. Success used to leave submitting=true forever,
      // so the OAuth button looked dead even when the session started.
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-[var(--color-pib-text)]">Connect {provider.label}</p>
        {provider.consoleUrl && (
          <a href={provider.consoleUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--color-pib-accent-hover)]">
            Open console →
          </a>
        )}
      </div>
      {provider.key === 'anthropic' && (
        <p className="rounded-lg border border-amber-500/30 bg-[color-mix(in_srgb,var(--st-warning)_10%,transparent)] px-3 py-2 text-xs text-[color-mix(in_srgb,var(--st-warning)_90%,transparent)]">
          OAuth requires a Claude Max plan with purchased extra usage credits; Claude Pro cannot use this path. API key is
          the reliable alternative.
        </p>
      )}
      {canApiKey && provider.credentialFields.map((field) => (
        <label key={field.key} className="block text-xs text-[var(--color-pib-text-muted)]">
          {field.label}
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-pib-text)]"
            type={field.secret ? 'password' : 'text'}
            placeholder={field.placeholder}
            value={values[field.key] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
          />
        </label>
      ))}
      <label className="block text-xs text-[var(--color-pib-text-muted)]">
        Nickname (optional)
        <input
          className="mt-1 w-full rounded-lg border border-[var(--color-pib-line)] bg-transparent px-3 py-2 text-sm text-[var(--color-pib-text)]"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </label>
      <div className="space-y-2 text-sm text-[var(--color-pib-text)]">
        {canManageOrgConnections ? (
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={scope === 'org'} onChange={() => setScope('org')} />
            <span>
              <span className="font-medium">This organisation’s VPS</span>
              <span className="block text-xs text-[var(--color-pib-text-muted)]">
                Shared by everyone using the organisation VPS. Synced to Hermes on that VPS.
              </span>
            </span>
          </label>
        ) : null}
        <label className="flex items-start gap-2">
          <input type="radio" className="mt-1" checked={scope === 'user'} onChange={() => setScope('user')} />
          <span>
            <span className="font-medium">Just me · linked computers</span>
            <span className="block text-xs text-[var(--color-pib-text-muted)]">
              Delivered only to computers owned by your account, then live-tested before it appears in Messages.
            </span>
          </span>
        </label>
      </div>
      {formError && <p role="alert" className="text-xs text-red-200">{formError}</p>}
      <div className="flex flex-wrap gap-2">
        {wantsOauth && (
          <button type="button" className="pib-btn-primary text-xs" disabled={submitting} onClick={() => void submit('oauth')}>
            {submitting
              ? `Starting ${provider.label} sign-in…`
              : provider.key === 'anthropic'
                ? 'Connect with OAuth'
                : `Sign in with ${provider.label}`}
          </button>
        )}
        {canApiKey && (
          <button type="button" className="pib-btn-primary text-xs" disabled={submitting} onClick={() => void submit('api_key')}>
            {submitting
              ? 'Saving…'
              : scope === 'org'
                ? 'Save & sync to org VPS'
                : 'Save & sync to my computers'}
          </button>
        )}
        {provider.oauthCapable && canApiKey && !wantsOauth && (
          <button type="button" className="btn-pib-secondary text-xs" disabled={submitting} onClick={() => void submit('oauth')}>
            {submitting ? 'Starting OAuth…' : 'Prefer OAuth instead'}
          </button>
        )}
        <button type="button" className="btn-pib-secondary text-xs" disabled={submitting} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

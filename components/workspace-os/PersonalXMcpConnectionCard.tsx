'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { appendQueryParams } from '@/lib/portal/scoped-routing'
import { X_MCP_CAPABILITY_SCOPES, X_MCP_CLIENT_CONFIG, X_MCP_CONNECTION_KEY, X_MCP_SCOPE_ROWS } from '@/lib/workspace-os/xMcp'

type WorkspaceConnectionSummary = {
  id: string
  displayName?: string
  connectionKey?: string | null
  connectionType?: string
  status?: string
  tokenStatus?: string
  provider?: string
  ownerUserId?: string | null
  safeMetadata?: Record<string, unknown>
}

type PortalOrgSummary = {
  id: string
  name?: string
}

type PersonalXMcpConnectionCardProps = {
  orgId?: string | null
  setupSurface?: string
  className?: string
}

const X_MCP_CAPABILITIES = {
  xPostsRead: true,
  xSearchRead: true,
  xUsersRead: true,
  xBookmarksRead: true,
  xBookmarksWrite: true,
  xNewsRead: true,
  xArticlesWrite: true,
}

function isXMcpVerified(connection: WorkspaceConnectionSummary | null): boolean {
  return connection?.status === 'active' && ['valid', 'healthy'].includes(connection.tokenStatus ?? '')
}

function statusLabel(connection: WorkspaceConnectionSummary | null): string {
  if (!connection) return 'Not prepared'
  if (isXMcpVerified(connection)) return 'Authorized · usable by agents'
  return 'Authorization required · not usable by agents yet'
}

function statusClass(connection: WorkspaceConnectionSummary | null): string {
  return isXMcpVerified(connection)
    ? 'rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-green-300'
    : 'rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-label uppercase tracking-wide text-amber-300'
}

export function PersonalXMcpConnectionCard({
  orgId,
  setupSurface = 'portal_personal_social_accounts',
  className = '',
}: PersonalXMcpConnectionCardProps) {
  const [activeOrgId, setActiveOrgId] = useState(orgId ?? '')
  const [activeOrgName, setActiveOrgName] = useState('')
  const [connection, setConnection] = useState<WorkspaceConnectionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [preparing, setPreparing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const effectiveOrgId = orgId ?? activeOrgId

  const connectionListPath = useMemo(() => {
    if (!effectiveOrgId) return ''
    return appendQueryParams('/api/v1/workspace-connections', {
      orgId: effectiveOrgId,
      provider: 'x_mcp',
      owner: 'me',
    })
  }, [effectiveOrgId])

  const loadActiveOrg = useCallback(async () => {
    if (orgId) return orgId
    const response = await fetch('/api/v1/portal/orgs')
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(typeof body?.error === 'string' ? body.error : 'Could not resolve your active workspace.')
    }
    const orgs = Array.isArray(body?.orgs) ? body.orgs as PortalOrgSummary[] : []
    const selectedId = typeof body?.activeOrgId === 'string' ? body.activeOrgId : orgs[0]?.id ?? ''
    const selectedOrg = orgs.find((item) => item.id === selectedId)
    setActiveOrgId(selectedId)
    setActiveOrgName(selectedOrg?.name ?? '')
    return selectedId
  }, [orgId])

  const loadConnection = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextOrgId = await loadActiveOrg()
      if (!nextOrgId) throw new Error('Choose a company workspace first so PiB can store the user-owned X MCP registry record safely.')
      const response = await fetch(appendQueryParams('/api/v1/workspace-connections', {
        orgId: nextOrgId,
        provider: 'x_mcp',
        owner: 'me',
      }))
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Could not load your personal X MCP registry record.')
      }
      const records = Array.isArray(body?.data) ? body.data as WorkspaceConnectionSummary[] : []
      setConnection(records.find((item) => item.provider === 'x_mcp' && item.connectionKey === X_MCP_CONNECTION_KEY) ?? null)
    } catch (err) {
      setConnection(null)
      setError(err instanceof Error ? err.message : 'Could not load your personal X MCP registry record.')
    } finally {
      setLoading(false)
    }
  }, [loadActiveOrg])

  useEffect(() => {
    loadConnection()
  }, [loadConnection])

  async function prepareConnection() {
    if (!effectiveOrgId || preparing) return
    setPreparing(true)
    setNotice(null)
    setError(null)
    try {
      const response = await fetch('/api/v1/workspace-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Org-Id': effectiveOrgId },
        body: JSON.stringify({
          orgId: effectiveOrgId,
          connectionKey: X_MCP_CONNECTION_KEY,
          displayName: 'Personal X MCP account',
          provider: 'x_mcp',
          connectionType: 'user_oauth',
          tokenStatus: 'user_authorization_required',
          status: 'proposed',
          capabilityScopes: [...X_MCP_CAPABILITY_SCOPES],
          capabilities: X_MCP_CAPABILITIES,
          scopes: X_MCP_SCOPE_ROWS,
          riskLevel: 'high',
          safeMetadata: {
            setupSurface,
            perUserAccount: true,
            sharedPlatformTokenStored: false,
            docsMcpServer: X_MCP_CLIENT_CONFIG.docsServer,
          },
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to prepare personal X MCP connection.')
      }
      setNotice('Setup metadata saved. Authorization is still required in xurl before PiB agents can read your X bookmarks.')
      await loadConnection()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare personal X MCP connection.')
    } finally {
      setPreparing(false)
    }
  }

  return (
    <section className={`pib-card space-y-4 ${className}`} aria-label="Personal X MCP account">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-accent)]">Personal intelligence</p>
          <h2 className="mt-1 font-headline text-xl font-bold text-on-surface">Personal X MCP and bookmarks</h2>
          <p className="mt-2 text-sm leading-6 text-on-surface-variant">
            This is for your own X account permissions: bookmarks, searches, timelines, posts, news, and article drafts. It is separate from company X/Twitter accounts used for brand publishing below.
          </p>
        </div>
        <span className={statusClass(connection)}>{loading ? 'Checking…' : statusLabel(connection)}</span>
      </div>

      <div className="grid gap-2 rounded-lg border border-outline-variant/50 bg-[var(--color-surface)] p-3 text-xs text-on-surface-variant">
        <p><span className="font-medium text-on-surface">Workspace record:</span> user-owned{activeOrgName ? ` in ${activeOrgName}` : ''}; no shared X bearer or refresh token stored by PiB.</p>
        <p><span className="font-medium text-on-surface">Server:</span> {X_MCP_CLIENT_CONFIG.streamableHttpServer}</p>
        <p><span className="font-medium text-on-surface">Client command:</span> <code className="rounded bg-[var(--color-surface-container)] px-1 py-0.5">{X_MCP_CLIENT_CONFIG.command}</code></p>
        <p><span className="font-medium text-on-surface">Docs MCP:</span> {X_MCP_CLIENT_CONFIG.docsServer}</p>
        <p><span className="font-medium text-on-surface">Startup timeout:</span> {X_MCP_CLIENT_CONFIG.startupTimeoutSeconds}s minimum for the one-time OAuth login.</p>
        <p><span className="font-medium text-on-surface">Bookmark access in PiB:</span> Personal X social OAuth now requests <code className="rounded bg-[var(--color-surface-container)] px-1 py-0.5">bookmark.read</code> and <code className="rounded bg-[var(--color-surface-container)] px-1 py-0.5">bookmark.write</code>. If your X account was connected before this update, reconnect it from this Personal accounts page so PiB can read your latest bookmark.</p>
      </div>

      {error && <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{notice}</p>}
      {connection && !isXMcpVerified(connection) && (
        <p className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          X MCP setup metadata is saved, but authorization is still required in xurl and PiB cannot verify a local xurl OAuth session yet. Agents will not use this MCP record for bookmarks until a verified authorization/health check exists.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={prepareConnection}
          disabled={loading || preparing || Boolean(connection) || !connectionListPath}
          className="pib-btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {preparing ? 'Preparing…' : connection ? 'X MCP setup saved — authorize in xurl' : 'Prepare personal X MCP'}
        </button>
        <a href="https://docs.x.com/tools/mcp" className="pib-btn-secondary text-xs" target="_blank" rel="noreferrer">
          Open X MCP docs
        </a>
      </div>
    </section>
  )
}

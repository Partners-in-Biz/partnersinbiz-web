'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useOrg } from '@/lib/contexts/OrgContext'
import {
  FaXTwitter, FaLinkedin, FaFacebook, FaInstagram,
  FaReddit, FaTiktok, FaPinterest, FaYoutube,
} from 'react-icons/fa6'
import { SiThreads, SiBluesky } from 'react-icons/si'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AccountStatus = 'active' | 'token_expired' | 'disconnected' | 'rate_limited'
type SubAccountType = 'personal' | 'business' | 'page' | 'group'

interface SocialAccount {
  id: string
  platform: string
  displayName: string
  username: string
  status: AccountStatus
  isDefault?: boolean
  subAccountType?: SubAccountType
  accountType?: SubAccountType
  platformAccountId?: string
  lastUsedAt: { _seconds?: number; seconds?: number } | string | null
  tokenExpiresAt: { _seconds?: number; seconds?: number } | string | null
  platformMeta?: Record<string, unknown>
}

interface PendingOption {
  index: number
  displayName: string
  username: string
  avatarUrl: string
  accountType: 'personal' | 'page'
  platformAccountId: string
  platformMeta?: Record<string, unknown>
}

/* ------------------------------------------------------------------ */
/*  Platform config                                                    */
/* ------------------------------------------------------------------ */

const PLATFORM_ICONS: Record<string, { color: string; icon: React.ReactNode }> = {
  twitter:   { color: 'bg-black',      icon: <FaXTwitter size={14} /> },
  linkedin:  { color: 'bg-blue-700',   icon: <FaLinkedin size={14} /> },
  facebook:  { color: 'bg-blue-600',   icon: <FaFacebook size={14} /> },
  instagram: { color: 'bg-pink-600',   icon: <FaInstagram size={14} /> },
  reddit:    { color: 'bg-orange-600', icon: <FaReddit size={14} /> },
  tiktok:    { color: 'bg-gray-800',   icon: <FaTiktok size={14} /> },
  pinterest: { color: 'bg-red-700',    icon: <FaPinterest size={14} /> },
  bluesky:   { color: 'bg-sky-500',    icon: <SiBluesky size={14} /> },
  threads:   { color: 'bg-gray-700',   icon: <SiThreads size={14} /> },
  youtube:   { color: 'bg-red-600',    icon: <FaYoutube size={14} /> },
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'X (Twitter)', linkedin: 'LinkedIn', facebook: 'Facebook',
  instagram: 'Instagram', reddit: 'Reddit', tiktok: 'TikTok',
  pinterest: 'Pinterest', bluesky: 'Bluesky', threads: 'Threads', youtube: 'YouTube',
}

const OAUTH_PLATFORMS = ['twitter','linkedin','facebook','instagram','reddit','tiktok','pinterest','threads','youtube']

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function tsToDate(ts: { _seconds?: number; seconds?: number } | string | null): Date | null {
  if (!ts) return null
  if (typeof ts === 'object' && ts._seconds) return new Date(ts._seconds * 1000)
  if (typeof ts === 'object' && ts.seconds) return new Date(ts.seconds * 1000)
  return new Date(ts as string)
}

function daysUntil(ts: { _seconds?: number; seconds?: number } | string | null): number | null {
  const d = tsToDate(ts)
  if (!d) return null
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function PlatformBadge({ platformId }: { platformId: string }) {
  const cfg = PLATFORM_ICONS[platformId]
  if (!cfg) return <span className="bg-surface-container-high text-on-surface-variant text-[10px] px-2 py-0.5 rounded font-bold uppercase">{platformId.slice(0, 2)}</span>
  return <span className={`${cfg.color} text-white w-7 h-7 flex items-center justify-center rounded`}>{cfg.icon}</span>
}

function SubAccountRow({
  account,
  onDisconnect,
  onSetDefault,
  disconnecting,
}: {
  account: SocialAccount
  onDisconnect: (id: string) => void
  onSetDefault: (id: string) => void
  disconnecting: boolean
}) {
  const days = daysUntil(account.tokenExpiresAt)
  const subAccountType = account.subAccountType ?? account.accountType
  const hasPlaceholderIdentity =
    account.platform === 'instagram' &&
    (!account.username || account.platformAccountId === 'unknown' || account.displayName.toLowerCase() === 'instagram')
  const accountName = hasPlaceholderIdentity ? 'Instagram reconnect required' : account.displayName
  const username = hasPlaceholderIdentity
    ? 'account identity missing'
    : account.username || account.displayName || account.platformAccountId || 'unknown account'

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-surface-container-high">
      <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-on-surface-variant text-xs font-semibold">
        {accountName.slice(0, 2).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface truncate">{accountName}</p>
        <p className="text-xs text-on-surface-variant truncate">
          {hasPlaceholderIdentity ? username : `@${username}`}
        </p>
        {days !== null && days <= 7 && (
          <p className={`text-[10px] ${days <= 0 ? 'text-red-400' : 'text-yellow-400'}`}>
            {days <= 0 ? 'Token expired' : `Expires in ${days}d`}
          </p>
        )}
      </div>
      {subAccountType && (
        <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
          subAccountType === 'personal'
            ? 'bg-blue-900/30 text-blue-400'
            : 'bg-green-900/30 text-green-400'
        }`}>
          {subAccountType.toUpperCase()}
        </span>
      )}
      <button
        aria-pressed={account.isDefault}
        title={account.isDefault ? 'Default account for agents' : 'Set as default'}
        onClick={() => !account.isDefault && onSetDefault(account.id)}
        className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
          account.isDefault
            ? 'bg-indigo-900/40 text-indigo-300 cursor-default'
            : 'bg-surface-container-high text-on-surface-variant hover:bg-indigo-900/20 hover:text-indigo-300 cursor-pointer'
        }`}
      >
        {account.isDefault ? '★ default' : '☆'}
      </button>
      <button
        onClick={() => onDisconnect(account.id)}
        disabled={disconnecting}
        className="text-xs text-red-400 opacity-60 hover:opacity-100 transition-opacity disabled:opacity-30"
      >
        Disconnect
      </button>
    </div>
  )
}

function PlatformCard({
  platform,
  accounts,
  orgId,
  onDisconnect,
  onSetDefault,
  disconnectingId,
}: {
  platform: string
  accounts: SocialAccount[]
  orgId: string
  onDisconnect: (id: string) => void
  onSetDefault: (id: string) => void
  disconnectingId: string | null
}) {
  const label = PLATFORM_LABELS[platform] ?? platform
  const oauthUrl = `/api/v1/social/oauth/${platform}?redirectUrl=/admin/social/accounts&orgId=${encodeURIComponent(orgId)}`
  const linkedInPersonalUrl = `${oauthUrl}&linkedinMode=personal`
  const linkedInOrganizationUrl = `${oauthUrl}&linkedinMode=organization`

  return (
    <div className="rounded-xl bg-surface-container overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <PlatformBadge platformId={platform} />
        <span className="text-sm font-semibold text-on-surface flex-1">{label}</span>
        <span className="text-xs text-on-surface-variant">{accounts.length} connected</span>
        {platform === 'linkedin' ? (
          <div className="flex items-center gap-2">
            <a
              href={linkedInPersonalUrl}
              className="text-xs text-on-surface-variant border border-surface-container-high rounded px-2 py-1 hover:bg-surface-container-high transition-colors"
            >
              + Personal
            </a>
            <a
              href={linkedInOrganizationUrl}
              className="text-xs text-on-surface-variant border border-surface-container-high rounded px-2 py-1 hover:bg-surface-container-high transition-colors"
            >
              + Company page
            </a>
          </div>
        ) : OAUTH_PLATFORMS.includes(platform) && (
          <a
            href={oauthUrl}
            className="text-xs text-on-surface-variant border border-surface-container-high rounded px-2 py-1 hover:bg-surface-container-high transition-colors"
          >
            + Add account
          </a>
        )}
      </div>
      {accounts.map(acc => (
        <SubAccountRow
          key={acc.id}
          account={acc}
          onDisconnect={onDisconnect}
          onSetDefault={onSetDefault}
          disconnecting={disconnectingId === acc.id}
        />
      ))}
    </div>
  )
}

function PickerModal({
  nonce,
  platform,
  orgId,
  onConfirm,
  onSkip,
}: {
  nonce: string
  platform: string
  orgId: string
  onConfirm: () => void
  onSkip: () => void
}) {
  const [options, setOptions] = useState<PendingOption[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [defaultIndex, setDefaultIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setSelected(new Set())
    setDefaultIndex(null)
    setLoading(true)
    setError('')
    const qs = `?orgId=${encodeURIComponent(orgId)}`
    fetch(`/api/v1/social/oauth/pending/${nonce}${qs}`)
      .then(r => r.json())
      .then(body => {
        const opts: PendingOption[] = body.data?.options ?? []
        setOptions(opts)
        const all = new Set(opts.map((_: PendingOption, i: number) => i))
        setSelected(all)
        if (opts.length > 0) setDefaultIndex(0)
      })
      .catch(() => setError('Failed to load account options.'))
      .finally(() => setLoading(false))
  }, [nonce, orgId])

  function toggleSelect(index: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
        if (defaultIndex === index) setDefaultIndex(null)
      } else {
        next.add(index)
      }
      return next
    })
  }

  function setAsDefault(index: number) {
    if (!selected.has(index)) return
    setDefaultIndex(index)
  }

  async function handleConfirm() {
    if (selected.size === 0) return
    setSaving(true)
    const qs = `?orgId=${encodeURIComponent(orgId)}`
    try {
      const selections = Array.from(selected).map(i => ({
        index: i,
        isDefault: i === defaultIndex,
      }))
      const res = await fetch(`/api/v1/social/accounts/confirm${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce, selections }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      onConfirm()
    } catch {
      setError('Failed to save accounts. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const icfg = PLATFORM_ICONS[platform]
  const label = PLATFORM_LABELS[platform] ?? platform

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-container rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-2">
          {icfg && (
            <span className={`${icfg.color} text-white w-8 h-8 flex items-center justify-center rounded-lg`}>
              {icfg.icon}
            </span>
          )}
          <h2 className="text-base font-semibold text-on-surface">Choose {label} accounts to connect</h2>
        </div>
        <p className="text-xs text-on-surface-variant mb-5">
          Select all you&apos;d like to connect. Click a selected account to mark it as ★ default for agent auto-posting.
        </p>

        {loading && <div className="h-24 rounded-xl bg-surface-container-high animate-pulse" />}

        {!loading && error && <p className="text-sm text-red-400">{error}</p>}

        {!loading && !error && (
          <div className="flex flex-col gap-2 mb-5">
            {options.map((opt, i) => {
              const isSelected = selected.has(i)
              const isDefault = defaultIndex === i
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  onClick={() => isSelected ? setAsDefault(i) : toggleSelect(i)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      if (isSelected) setAsDefault(i)
                      else toggleSelect(i)
                    }
                  }}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer transition-colors border ${
                    isSelected
                      ? isDefault
                        ? 'border-indigo-500 bg-indigo-900/20'
                        : 'border-surface-container-high bg-surface-container-high'
                      : 'border-surface-container-high bg-surface-container opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(i)}
                    onClick={e => e.stopPropagation()}
                    className="w-4 h-4 accent-indigo-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface">{opt.displayName}</p>
                    <p className="text-xs text-on-surface-variant">@{opt.username}</p>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    opt.accountType === 'personal'
                      ? 'bg-blue-900/30 text-blue-400'
                      : 'bg-green-900/30 text-green-400'
                  }`}>
                    {opt.accountType.toUpperCase()}
                  </span>
                  {isSelected && isDefault && (
                    <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-indigo-900/40 text-indigo-300">
                      ★ default
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[10px] text-on-surface-variant mb-4">
          ★ Click a selected account to set it as the default. Agents auto-post to the default unless told otherwise.
        </p>

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            disabled={saving || selected.size === 0}
            className="flex-1 bg-white text-black rounded-lg py-2.5 text-sm font-semibold hover:bg-white/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Connecting…' : `Connect selected (${selected.size})`}
          </button>
          <button
            onClick={onSkip}
            className="border border-surface-container-high text-on-surface-variant rounded-lg px-4 py-2.5 text-sm hover:bg-surface-container-high transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

function BlueskyForm({ onSuccess, orgId }: { onSuccess: () => void; orgId: string }) {
  const [handle, setHandle] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!handle.trim() || !appPassword.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const qs = `?orgId=${encodeURIComponent(orgId)}`
      const res = await fetch(`/api/v1/social/accounts${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'bluesky',
          displayName: handle.trim(),
          username: handle.trim(),
          status: 'active',
          platformMeta: { handle: handle.trim(), appPassword: appPassword.trim() },
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `Failed (${res.status})`)
      }
      setHandle('')
      setAppPassword('')
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-surface-container p-5 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <PlatformBadge platformId="bluesky" />
        <span className="text-sm font-medium text-on-surface">Connect Bluesky</span>
        <span className="text-xs text-on-surface-variant">(App Password)</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="text"
          placeholder="you.bsky.social"
          value={handle}
          onChange={e => setHandle(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-surface-container-high text-on-surface text-sm placeholder:text-on-surface-variant/40 outline-none focus:ring-1 focus:ring-white/20"
        />
        <input
          type="password"
          placeholder="xxxx-xxxx-xxxx-xxxx"
          value={appPassword}
          onChange={e => setAppPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-surface-container-high text-on-surface text-sm placeholder:text-on-surface-variant/40 outline-none focus:ring-1 focus:ring-white/20"
        />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !handle.trim() || !appPassword.trim()}
        className="px-4 py-2 rounded-lg bg-white text-black font-label text-sm font-medium hover:bg-white/90 transition-colors disabled:opacity-50"
      >
        {submitting ? 'Connecting…' : 'Connect Bluesky'}
      </button>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AccountsPage() {
  const { orgId } = useOrg()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const pickerNonce = searchParams.get('picker')
  const pickerPlatform = searchParams.get('platform') ?? ''

  const fetchAccounts = useCallback(async () => {
    if (!orgId) {
      setAccounts([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/v1/social/accounts?orgId=${encodeURIComponent(orgId)}`)
      const body = await res.json()
      setAccounts(body.data ?? [])
    } catch {
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { fetchAccounts() }, [fetchAccounts])

  useEffect(() => {
    const status = searchParams.get('status')
    const msg = searchParams.get('message')
    const platform = searchParams.get('platform')
    if (status === 'error' && msg) {
      setActionError(decodeURIComponent(msg))
    } else if (status === 'success' && platform && !pickerNonce) {
      fetchAccounts()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleDisconnect(id: string) {
    if (!confirm('Disconnect this account? You can reconnect later.')) return
    setActionError(null)
    setDisconnectingId(id)
    try {
      const qs = `?orgId=${encodeURIComponent(orgId)}`
      const res = await fetch(`/api/v1/social/accounts/${id}${qs}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      await fetchAccounts()
    } catch {
      setActionError('Failed to disconnect account. Please try again.')
    } finally {
      setDisconnectingId(null)
    }
  }

  async function handleSetDefault(id: string) {
    setActionError(null)
    try {
      const qs = `?orgId=${encodeURIComponent(orgId)}`
      const res = await fetch(`/api/v1/social/accounts/${id}/set-default${qs}`, { method: 'PUT' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      await fetchAccounts()
    } catch {
      setActionError('Failed to update default account.')
    }
  }

  function dismissPicker() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('picker')
    params.delete('platform')
    router.replace(`/admin/social/accounts?${params.toString()}`)
  }

  function handlePickerConfirm() {
    dismissPicker()
    fetchAccounts()
  }

  const activeAccounts = accounts.filter(a => a.status !== 'disconnected')
  const grouped = activeAccounts.reduce<Record<string, SocialAccount[]>>((acc, a) => {
    if (!acc[a.platform]) acc[a.platform] = []
    acc[a.platform].push(a)
    return acc
  }, {})

  const connectedPlatforms = new Set(activeAccounts.map(a => a.platform))
  const unconnectedOAuth = OAUTH_PLATFORMS.filter(p => !connectedPlatforms.has(p))
  const showBlueskyForm = !connectedPlatforms.has('bluesky')

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {pickerNonce && orgId && (
        <PickerModal
          nonce={pickerNonce}
          platform={pickerPlatform}
          orgId={orgId}
          onConfirm={handlePickerConfirm}
          onSkip={dismissPicker}
        />
      )}

      <div>
        <h1 className="text-2xl font-semibold text-on-surface">Social Accounts</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Connect and manage your social media accounts. Click ☆ on any account to set it as the agent default.
        </p>
      </div>
      {actionError && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-4 py-2">{actionError}</p>
      )}

      {!orgId ? (
        <div className="rounded-xl bg-surface-container p-8 text-center">
          <p className="text-sm text-on-surface-variant">Select a client context before connecting social accounts.</p>
        </div>
      ) : (
        <>

      <div>
        <h2 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide mb-3">
          Connected Accounts
        </h2>
        {loading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-surface-container animate-pulse" />
            ))}
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="rounded-xl bg-surface-container p-8 text-center">
            <p className="text-sm text-on-surface-variant">No accounts connected yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([platform, accs]) => (
              <PlatformCard
                key={platform}
                platform={platform}
                accounts={accs}
                orgId={orgId ?? ''}
                onDisconnect={handleDisconnect}
                onSetDefault={handleSetDefault}
                disconnectingId={disconnectingId}
              />
            ))}
          </div>
        )}
      </div>

      {(unconnectedOAuth.length > 0 || showBlueskyForm) && (
        <div>
          <h2 className="text-sm font-semibold text-on-surface-variant uppercase tracking-wide mb-3">
            Connect New Account
          </h2>
          {unconnectedOAuth.length > 0 && (
            <div className="flex gap-3 flex-wrap mb-4">
              {unconnectedOAuth.map(p => (
                <a
                  key={p}
                  href={`/api/v1/social/oauth/${p}?redirectUrl=/admin/social/accounts&orgId=${encodeURIComponent(orgId)}${p === 'linkedin' ? '&linkedinMode=personal' : ''}`}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black font-label text-sm font-medium hover:bg-white/90 transition-colors"
                >
                  <span className={`${PLATFORM_ICONS[p]?.color ?? 'bg-gray-600'} text-white w-6 h-6 flex items-center justify-center rounded`}>
                    {PLATFORM_ICONS[p]?.icon}
                  </span>
                  Connect {PLATFORM_LABELS[p] ?? p}
                </a>
              ))}
            </div>
          )}
          {showBlueskyForm && <BlueskyForm onSuccess={fetchAccounts} orgId={orgId ?? ''} />}
        </div>
      )}
        </>
      )}
    </div>
  )
}

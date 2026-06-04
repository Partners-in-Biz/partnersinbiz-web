'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  FaXTwitter, FaLinkedin, FaFacebook, FaInstagram,
  FaReddit, FaTiktok, FaPinterest, FaYoutube,
} from 'react-icons/fa6'
import { SiThreads, SiBluesky } from 'react-icons/si'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

type AccountStatus = 'active' | 'token_expired' | 'disconnected' | 'rate_limited'
type SubAccountType = 'personal' | 'business' | 'page' | 'group'
type TimestampLike = { _seconds?: number; seconds?: number } | string | null | undefined

interface SocialAccount {
  id: string
  platform: string
  displayName: string
  username?: string
  status: AccountStatus
  isDefault?: boolean
  subAccountType?: SubAccountType
  accountType?: SubAccountType
  avatarUrl?: string
  platformAccountId?: string
  lastUsedAt?: TimestampLike
  lastUsed?: TimestampLike
  tokenExpiresAt?: TimestampLike
  platformMeta?: Record<string, unknown>
}

interface PendingOption {
  index: number
  displayName: string
  username: string
  avatarUrl: string
  accountType: SubAccountType
  platformAccountId: string
  platformMeta?: Record<string, unknown>
}

const PLATFORM_ICONS: Record<string, { bg: string; icon: React.ReactNode }> = {
  twitter:   { bg: 'bg-black',       icon: <FaXTwitter size={14} /> },
  x:         { bg: 'bg-black',       icon: <FaXTwitter size={14} /> },
  linkedin:  { bg: 'bg-blue-700',    icon: <FaLinkedin size={14} /> },
  facebook:  { bg: 'bg-blue-600',    icon: <FaFacebook size={14} /> },
  instagram: { bg: 'bg-pink-600',    icon: <FaInstagram size={14} /> },
  reddit:    { bg: 'bg-orange-600',  icon: <FaReddit size={14} /> },
  tiktok:    { bg: 'bg-gray-800',    icon: <FaTiktok size={14} /> },
  pinterest: { bg: 'bg-red-700',     icon: <FaPinterest size={14} /> },
  bluesky:   { bg: 'bg-sky-500',     icon: <SiBluesky size={14} /> },
  threads:   { bg: 'bg-gray-700',    icon: <SiThreads size={14} /> },
  youtube:   { bg: 'bg-red-600',     icon: <FaYoutube size={14} /> },
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'X (Twitter)',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  instagram: 'Instagram',
  reddit: 'Reddit',
  tiktok: 'TikTok',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  threads: 'Threads',
  youtube: 'YouTube',
}

const OAUTH_PLATFORMS = ['twitter', 'linkedin', 'facebook', 'instagram', 'reddit', 'tiktok', 'pinterest', 'threads', 'youtube']

type SocialScope = 'org' | 'personal'

interface SocialAccountsManagerProps {
  scope?: SocialScope
  basePath?: string
  title?: string
  eyebrow?: string
  description?: string
  emptyDescription?: string
  orgId?: string | null
}

const STATUS_PILLS: Record<AccountStatus, string> = {
  active: 'pib-pill pib-pill-success',
  token_expired: 'pib-pill pib-pill-danger',
  disconnected: 'pib-pill',
  rate_limited: 'pib-pill pib-pill-warn',
}

const STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Active',
  token_expired: 'Expired',
  disconnected: 'Disconnected',
  rate_limited: 'Rate limited',
}

function timestampToDate(ts: TimestampLike): Date | null {
  if (!ts) return null
  if (typeof ts === 'object' && typeof ts._seconds === 'number') return new Date(ts._seconds * 1000)
  if (typeof ts === 'object' && typeof ts.seconds === 'number') return new Date(ts.seconds * 1000)
  if (typeof ts !== 'string') return null
  const date = new Date(ts)
  return Number.isNaN(date.getTime()) ? null : date
}

function daysUntil(ts: TimestampLike): number | null {
  const date = timestampToDate(ts)
  if (!date) return null
  return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function formatLastUsed(ts: TimestampLike): string {
  const date = timestampToDate(ts)
  if (!date) return 'Not used yet'
  return date.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}

function getAccountName(account: SocialAccount): string {
  const hasPlaceholderIdentity =
    account.platform === 'instagram' &&
    (!account.platformAccountId || account.platformAccountId === 'unknown' || account.displayName.toLowerCase() === 'instagram')
  return hasPlaceholderIdentity ? 'Instagram reconnect required' : account.displayName
}

function PlatformBadge({ platformId }: { platformId: string }) {
  const config = PLATFORM_ICONS[platformId]
  if (!config) {
    return (
      <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-surface-container)] text-[10px] font-bold uppercase text-on-surface-variant">
        {platformId.slice(0, 2)}
      </span>
    )
  }
  return (
    <span className={`${config.bg} grid h-8 w-8 place-items-center rounded-md text-white`}>
      {config.icon}
    </span>
  )
}

function AccountAvatar({ account }: { account: SocialAccount }) {
  if (account.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={account.avatarUrl}
        alt=""
        className="h-9 w-9 rounded-full border border-[var(--color-card-border)] object-cover"
      />
    )
  }

  return (
    <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-surface-container)] text-xs font-bold text-on-surface">
      {account.displayName.slice(0, 2).toUpperCase()}
    </span>
  )
}

function SubAccountRow({
  account,
  onDisconnect,
  onSetDefault,
  disconnecting,
}: {
  account: SocialAccount
  onDisconnect: (account: SocialAccount) => void
  onSetDefault: (id: string) => void
  disconnecting: boolean
}) {
  const days = daysUntil(account.tokenExpiresAt)
  const subAccountType = account.subAccountType ?? account.accountType
  const hasPlaceholderIdentity =
    account.platform === 'instagram' &&
    (!account.platformAccountId || account.platformAccountId === 'unknown' || account.displayName.toLowerCase() === 'instagram')
  const accountName = getAccountName(account)
  const platformLabel = PLATFORM_LABELS[account.platform] ?? account.platform
  const username = hasPlaceholderIdentity
    ? 'account identity missing'
    : account.username || account.platformAccountId || account.displayName || 'unknown account'

  return (
    <div className="grid gap-3 border-t border-[var(--color-card-border)] px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <AccountAvatar account={account} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-on-surface">{accountName}</p>
          <p className="truncate text-xs text-on-surface-variant">
            {hasPlaceholderIdentity ? username : `@${username}`}
          </p>
          <p className="mt-1 text-[11px] text-on-surface-variant">Last used: {formatLastUsed(account.lastUsedAt ?? account.lastUsed)}</p>
          {days !== null && days <= 7 && (
            <p className={`mt-1 text-[11px] ${days <= 0 ? 'text-[#FCA5A5]' : 'text-[#FBBF24]'}`}>
              {days <= 0 ? 'Token expired' : `Token expires in ${days} day${days === 1 ? '' : 's'}`}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className={STATUS_PILLS[account.status] ?? 'pib-pill'}>
          {STATUS_LABELS[account.status] ?? account.status}
        </span>
        {subAccountType && (
          <span className={subAccountType === 'page' ? 'pib-pill pib-pill-info' : 'pib-pill'}>
            {subAccountType}
          </span>
        )}
        <button
          type="button"
          aria-pressed={account.isDefault}
          onClick={() => !account.isDefault && onSetDefault(account.id)}
          className={`rounded-md border px-2.5 py-1 text-xs font-label transition-colors ${
            account.isDefault
              ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/10 text-[var(--color-pib-accent)]'
              : 'border-[var(--color-card-border)] text-on-surface-variant hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-accent)]'
          }`}
        >
          {account.isDefault ? 'Default' : 'Set default'}
        </button>
        <button
          type="button"
          aria-label={`Disconnect social account ${accountName} from ${platformLabel}`}
          onClick={() => onDisconnect(account)}
          disabled={disconnecting}
          className="rounded-md border border-red-400/30 px-2.5 py-1 text-xs font-label text-red-300 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>
    </div>
  )
}

function PlatformCard({
  platform,
  accounts,
  onDisconnect,
  onSetDefault,
  disconnectingId,
  scope,
  redirectPath,
  orgId,
}: {
  platform: string
  accounts: SocialAccount[]
  onDisconnect: (account: SocialAccount) => void
  onSetDefault: (id: string) => void
  disconnectingId: string | null
  scope: SocialScope
  redirectPath: string
  orgId?: string | null
}) {
  const label = PLATFORM_LABELS[platform] ?? platform
  const oauthUrl = appendQueryParams(`/api/v1/social/oauth/${platform}`, {
    redirectUrl: redirectPath,
    scope: scope === 'personal' ? 'personal' : undefined,
    orgId,
  })
  const linkedInPersonalUrl = appendQueryParams(oauthUrl, { linkedinMode: 'personal' })
  const linkedInOrganizationUrl = appendQueryParams(oauthUrl, { linkedinMode: 'organization' })
  const defaultAccount = accounts.find((account) => account.isDefault)

  return (
    <section className="pib-card overflow-hidden !p-0">
      <div className="flex flex-wrap items-center gap-3 px-4 py-4">
        <PlatformBadge platformId={platform} />
        <div className="min-w-0 flex-1">
          <h3 className="font-headline text-lg font-bold leading-tight text-on-surface">{label}</h3>
          <p className="text-xs text-on-surface-variant">
            {accounts.length} connected{defaultAccount ? ` · default: ${defaultAccount.displayName}` : ''}
          </p>
        </div>
        {platform === 'linkedin' && scope === 'org' ? (
          <div className="flex flex-wrap items-center gap-2">
            <a href={linkedInPersonalUrl} className="btn-pib-secondary !px-3 !py-2 !text-xs">
              <span className="material-symbols-outlined text-base">person_add</span>
              Personal
            </a>
            <a href={linkedInOrganizationUrl} className="btn-pib-secondary !px-3 !py-2 !text-xs">
              <span className="material-symbols-outlined text-base">business</span>
              Company page
            </a>
          </div>
        ) : OAUTH_PLATFORMS.includes(platform) && (
          <a href={platform === 'linkedin' ? linkedInPersonalUrl : oauthUrl} className="btn-pib-secondary !px-3 !py-2 !text-xs">
            <span className="material-symbols-outlined text-base">add</span>
            Add account
          </a>
        )}
      </div>
      {accounts.map((account) => (
        <SubAccountRow
          key={account.id}
          account={account}
          onDisconnect={onDisconnect}
          onSetDefault={onSetDefault}
          disconnecting={disconnectingId === account.id}
        />
      ))}
    </section>
  )
}

function PickerModal({
  nonce,
  platform,
  onConfirm,
  onSkip,
  orgId,
}: {
  nonce: string
  platform: string
  onConfirm: () => void
  onSkip: () => void
  orgId?: string | null
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

    fetch(appendQueryParams(`/api/v1/social/oauth/pending/${nonce}`, { orgId }))
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`Failed (${res.status})`)))
      .then((body) => {
        const opts: PendingOption[] = body.data?.options ?? []
        setOptions(opts)
        setSelected(new Set(opts.map((_, index) => index)))
        if (opts.length > 0) setDefaultIndex(0)
      })
      .catch(() => setError('Failed to load account options. Please reconnect and try again.'))
      .finally(() => setLoading(false))
  }, [nonce, orgId])

  function toggleSelect(index: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
        if (defaultIndex === index) setDefaultIndex(null)
      } else {
        next.add(index)
        if (defaultIndex === null) setDefaultIndex(index)
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
    setError('')

    try {
      const selections = Array.from(selected).map((index) => ({
        index,
        isDefault: index === defaultIndex,
      }))
      const res = await fetch(appendQueryParams('/api/v1/social/accounts/confirm', { orgId }), {
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

  const label = PLATFORM_LABELS[platform] ?? platform
  const icon = PLATFORM_ICONS[platform]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)] p-6 shadow-2xl">
        <div className="mb-2 flex items-center gap-3">
          {icon && <span className={`${icon.bg} grid h-9 w-9 place-items-center rounded-md text-white`}>{icon.icon}</span>}
          <h2 className="font-headline text-xl font-bold text-on-surface">Choose {label} accounts</h2>
        </div>
        <p className="mb-5 text-sm text-on-surface-variant">
          Select every account you want connected. The default account is what Pip uses first when posting automatically.
        </p>

        {loading && <div className="h-28 animate-pulse rounded-md bg-[var(--color-surface-container)]" />}
        {!loading && error && <p className="rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-300">{error}</p>}

        {!loading && !error && (
          <div className="mb-5 space-y-2">
            {options.map((option, index) => {
              const isSelected = selected.has(index)
              const isDefault = defaultIndex === index
              return (
                <div
                  key={`${option.platformAccountId}-${index}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => isSelected ? setAsDefault(index) : toggleSelect(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      if (isSelected) setAsDefault(index)
                      else toggleSelect(index)
                    }
                  }}
                  className={`flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors ${
                    isSelected
                      ? isDefault
                        ? 'border-[var(--color-pib-accent)] bg-[var(--color-pib-accent)]/10'
                        : 'border-[var(--color-card-border)] bg-[var(--color-surface-container)]'
                      : 'border-[var(--color-card-border)] opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(index)}
                    onClick={(event) => event.stopPropagation()}
                    className="h-4 w-4 accent-[var(--color-pib-accent)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-on-surface">{option.displayName}</p>
                    <p className="truncate text-xs text-on-surface-variant">@{option.username}</p>
                  </div>
                  <span className={option.accountType === 'page' ? 'pib-pill pib-pill-info' : 'pib-pill'}>
                    {option.accountType}
                  </span>
                  {isSelected && isDefault && <span className="pib-pill pib-pill-success">Default</span>}
                </div>
              )
            })}
            {options.length === 0 && (
              <div className="rounded-md border border-[var(--color-card-border)] p-5 text-center text-sm text-on-surface-variant">
                No account options were returned.
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || selected.size === 0}
            className="btn-pib-accent flex-1 justify-center disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Connecting...' : `Connect selected (${selected.size})`}
          </button>
          <button type="button" onClick={onSkip} className="btn-pib-secondary justify-center">
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

function BlueskyForm({
  onSuccess,
  disabled,
  scope,
  orgId,
}: {
  onSuccess: () => void
  disabled: boolean
  scope: SocialScope
  orgId?: string | null
}) {
  const [handle, setHandle] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!handle.trim() || !appPassword.trim()) return
    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(appendQueryParams('/api/v1/social/accounts', {
        scope: scope === 'personal' ? 'personal' : undefined,
        orgId,
      }), {
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
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? `Failed (${res.status})`)
      setHandle('')
      setAppPassword('')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Bluesky.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="pib-card space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PlatformBadge platformId="bluesky" />
        <div>
          <h3 className="font-headline text-lg font-bold text-on-surface">Connect Bluesky</h3>
          <p className="text-xs text-on-surface-variant">Use a Bluesky app password, not your main password.</p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <input
          type="text"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="handle.bsky.social"
          disabled={disabled || submitting}
          className="pib-input"
        />
        <input
          type="password"
          value={appPassword}
          onChange={(event) => setAppPassword(event.target.value)}
          placeholder="App password"
          disabled={disabled || submitting}
          className="pib-input"
        />
        <button
          type="submit"
          disabled={disabled || submitting || !handle.trim() || !appPassword.trim()}
          className="btn-pib-accent justify-center disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Connecting...' : 'Connect'}
        </button>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </form>
  )
}

export default function SocialAccountsManager({
  scope = 'org',
  basePath = '/portal/social/accounts',
  eyebrow = 'Social media',
  title = 'Social Accounts',
  description = 'Connect every profile or page you want Pip to publish to. Multiple accounts per platform are supported.',
  emptyDescription = 'Connect your first account below so scheduled content has somewhere to publish.',
  orgId,
}: SocialAccountsManagerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<SocialAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null)
  const [disconnectCandidate, setDisconnectCandidate] = useState<SocialAccount | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const pickerNonce = searchParams.get('picker')
  const pickerPlatform = searchParams.get('platform') ?? ''
  const socialApiPath = useCallback((path: string) => appendQueryParams(path, {
    scope: scope === 'personal' ? 'personal' : undefined,
    orgId,
  }), [orgId, scope])
  const tenantApiPath = useCallback((path: string) => appendQueryParams(path, { orgId }), [orgId])

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(socialApiPath('/api/v1/social/accounts'))
      const body = await res.json()
      setAccounts(body.data ?? [])
    } catch {
      setAccounts([])
      setActionError('Failed to load social accounts.')
    } finally {
      setLoading(false)
    }
  }, [socialApiPath])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  useEffect(() => {
    const status = searchParams.get('status')
    const platform = searchParams.get('platform')
    const errorMessage = searchParams.get('message')

    if (status === 'error' && errorMessage) {
      setActionError(decodeURIComponent(errorMessage))
    } else if (status === 'success' && platform && !pickerNonce) {
      setMessage(`${PLATFORM_LABELS[platform] ?? platform} connected.`)
      fetchAccounts()
    }
  }, [fetchAccounts, pickerNonce, searchParams])

  function requestDisconnect(account: SocialAccount) {
    setActionError(null)
    setMessage(null)
    setDisconnectCandidate(account)
  }

  async function handleDisconnect(account: SocialAccount) {
    const id = account.id
    setActionError(null)
    setMessage(null)
    setDisconnectingId(id)

    try {
      const res = await fetch(tenantApiPath(`/api/v1/social/accounts/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setMessage('Account disconnected.')
      setDisconnectCandidate(null)
      await fetchAccounts()
    } catch {
      setActionError('Failed to disconnect account. Please try again.')
    } finally {
      setDisconnectingId(null)
    }
  }

  async function handleSetDefault(id: string) {
    setActionError(null)
    setMessage(null)

    try {
      const res = await fetch(tenantApiPath(`/api/v1/social/accounts/${id}/set-default`), { method: 'PUT' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setMessage('Default account updated.')
      await fetchAccounts()
    } catch {
      setActionError('Failed to update default account.')
    }
  }

  function dismissPicker() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('picker')
    params.delete('platform')
    const qs = params.toString()
    const basePathWithoutQuery = basePath.split('?')[0] ?? basePath
    router.replace(qs ? `${basePathWithoutQuery}?${qs}` : basePath)
  }

  function handlePickerConfirm() {
    dismissPicker()
    setMessage('Selected accounts connected.')
    fetchAccounts()
  }

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.status !== 'disconnected'),
    [accounts],
  )
  const grouped = useMemo(() => {
    return activeAccounts.reduce<Record<string, SocialAccount[]>>((acc, account) => {
      if (!acc[account.platform]) acc[account.platform] = []
      acc[account.platform].push(account)
      return acc
    }, {})
  }, [activeAccounts])

  const connectedPlatformIds = useMemo(
    () => new Set(activeAccounts.map((account) => account.platform)),
    [activeAccounts],
  )
  const unconnectedOAuth = OAUTH_PLATFORMS.filter((platform) => !connectedPlatformIds.has(platform))
  const defaultCount = activeAccounts.filter((account) => account.isDefault).length
  const needsAttentionCount = activeAccounts.filter((account) => account.status !== 'active').length
  const disconnectCandidateName = disconnectCandidate ? getAccountName(disconnectCandidate) : ''
  const disconnectCandidatePlatform = disconnectCandidate
    ? PLATFORM_LABELS[disconnectCandidate.platform] ?? disconnectCandidate.platform
    : ''

  return (
    <div className="space-y-8">
      {pickerNonce && (
        <PickerModal
          nonce={pickerNonce}
          platform={pickerPlatform}
          onConfirm={handlePickerConfirm}
          onSkip={dismissPicker}
          orgId={orgId}
        />
      )}

      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-accent)]">{eyebrow}</p>
          <h1 className="mt-1 font-headline text-3xl font-bold tracking-tight text-on-surface">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-on-surface-variant">
            {description}
          </p>
        </div>
        <a href="#connect-new-account" className="btn-pib-accent self-start md:self-auto">
          <span className="material-symbols-outlined text-base">add_link</span>
          Connect account
        </a>
      </header>

      {disconnectCandidate && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Disconnect ${disconnectCandidatePlatform} account "${disconnectCandidateName}"?`}
          className="rounded-md border border-red-400/30 bg-red-400/10 p-4 shadow-sm"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <p className="font-headline text-lg font-bold text-red-100">
                Disconnect {disconnectCandidatePlatform} account &quot;{disconnectCandidateName}&quot;?
              </p>
              <p className="mt-1 text-sm text-red-100/80">
                This removes the account from posting, scheduling, and inbox sync. You can reconnect it later from this workspace.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDisconnectCandidate(null)}
                disabled={disconnectingId === disconnectCandidate.id}
                className="rounded-md border border-red-100/30 px-3 py-2 text-xs font-label text-red-50 transition-colors hover:bg-red-50/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Keep account connected
              </button>
              <button
                type="button"
                onClick={() => handleDisconnect(disconnectCandidate)}
                disabled={disconnectingId === disconnectCandidate.id}
                className="rounded-md bg-red-300 px-3 py-2 text-xs font-label text-red-950 transition-colors hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {disconnectingId === disconnectCandidate.id
                  ? 'Disconnecting...'
                  : `Confirm disconnect ${disconnectCandidatePlatform} account ${disconnectCandidateName}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {(message || actionError) && (
        <div
          className={`flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm ${
            actionError
              ? 'border-red-400/30 bg-red-400/10 text-red-300'
              : 'border-green-400/30 bg-green-400/10 text-green-300'
          }`}
        >
          <span>{actionError ?? message}</span>
          <button
            type="button"
            onClick={() => {
              setMessage(null)
              setActionError(null)
            }}
            className="text-on-surface-variant hover:text-on-surface"
            aria-label="Dismiss message"
          >
            x
          </button>
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="pib-card px-4 py-3">
          <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Connected</p>
          <p className="mt-2 font-headline text-2xl font-bold text-on-surface">{activeAccounts.length}</p>
        </div>
        <div className="pib-card px-4 py-3">
          <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Platforms</p>
          <p className="mt-2 font-headline text-2xl font-bold text-on-surface">{connectedPlatformIds.size}</p>
        </div>
        <div className="pib-card px-4 py-3">
          <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Defaults</p>
          <p className="mt-2 font-headline text-2xl font-bold text-on-surface">
            {defaultCount}
            {needsAttentionCount > 0 && <span className="ml-2 align-middle text-xs font-label text-[#FBBF24]">{needsAttentionCount} need attention</span>}
          </p>
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Connected Accounts</h2>
          <p className="text-xs text-on-surface-variant">Set one default account per platform for auto-posting.</p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="pib-skeleton h-28 rounded-md" />
            ))}
          </div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="pib-card py-14 text-center">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant">hub</span>
            <h3 className="mt-3 font-headline text-xl font-bold text-on-surface">No accounts connected yet</h3>
            <p className="mt-1 text-sm text-on-surface-variant">{emptyDescription}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([platform, platformAccounts]) => (
              <PlatformCard
                key={platform}
                platform={platform}
                accounts={platformAccounts}
                onDisconnect={requestDisconnect}
                onSetDefault={handleSetDefault}
                disconnectingId={disconnectingId}
                scope={scope}
                redirectPath={basePath}
                orgId={orgId}
              />
            ))}
          </div>
        )}
      </section>

      <section id="connect-new-account" className="space-y-4 scroll-mt-24">
        <div>
          <h2 className="text-xs font-label uppercase tracking-widest text-on-surface-variant">Connect New Account</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            OAuth platforms can return several pages or profiles. You can choose which ones to save after authorising.
          </p>
        </div>

        {unconnectedOAuth.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {unconnectedOAuth.map((platform) => (
              <a
                key={platform}
                href={appendQueryParams(`/api/v1/social/oauth/${platform}`, {
                  redirectUrl: basePath,
                  scope: scope === 'personal' ? 'personal' : undefined,
                  orgId,
                  linkedinMode: platform === 'linkedin' ? 'personal' : undefined,
                })}
                className="pib-card pib-card-hover flex items-center gap-3 p-4"
              >
                <PlatformBadge platformId={platform} />
                <span className="min-w-0 flex-1 text-sm font-semibold text-on-surface">
                  Connect {PLATFORM_LABELS[platform] ?? platform}
                </span>
                <span className="material-symbols-outlined text-base text-on-surface-variant">arrow_forward</span>
              </a>
            ))}
          </div>
        ) : (
          <div className="pib-card p-4 text-sm text-on-surface-variant">
            All OAuth platforms have at least one connected account. Use Add account inside a platform card to connect another profile or page.
          </div>
        )}

        {!connectedPlatformIds.has('bluesky') && (
          <BlueskyForm onSuccess={fetchAccounts} disabled={loading} scope={scope} orgId={orgId} />
        )}
      </section>
    </div>
  )
}

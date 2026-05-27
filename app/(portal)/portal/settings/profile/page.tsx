// app/(portal)/portal/settings/profile/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface ProfileData {
  firstName: string
  lastName: string
  jobTitle: string
  phone: string
  avatarUrl: string
  role: string | null
}

type PersonalAccount = {
  id: string
  platform: string
  displayName: string
  username?: string
  status: string
  isDefault?: boolean
}

type PendingOption = {
  index: number
  displayName: string
  username: string
  accountType: string
  platformAccountId: string
}

const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'X',
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

export default function ProfilePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profile, setProfile] = useState<ProfileData>({
    firstName: '', lastName: '', jobTitle: '', phone: '', avatarUrl: '', role: null,
  })
  const [accounts, setAccounts] = useState<PersonalAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [postContent, setPostContent] = useState('')
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [scheduledFor, setScheduledFor] = useState('')
  const [marketingMessage, setMarketingMessage] = useState('')
  const [marketingError, setMarketingError] = useState('')
  const [posting, setPosting] = useState(false)
  const [pendingOptions, setPendingOptions] = useState<PendingOption[]>([])
  const [pendingSelected, setPendingSelected] = useState<Set<number>>(new Set())
  const [pendingLoading, setPendingLoading] = useState(false)
  const [pendingSaving, setPendingSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/v1/portal/settings/profile')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.profile) setProfile(d.profile) })
      .finally(() => setLoading(false))
  }, [])

  const pickerNonce = searchParams.get('picker')
  const pickerPlatform = searchParams.get('platform') ?? ''

  async function refreshPersonalAccounts() {
    setAccountsLoading(true)
    try {
      const res = await fetch('/api/v1/social/accounts?scope=personal')
      const body = await res.json().catch(() => ({}))
      setAccounts(Array.isArray(body.data) ? body.data : [])
    } catch {
      setMarketingError('Failed to load personal social accounts.')
    } finally {
      setAccountsLoading(false)
    }
  }

  useEffect(() => {
    refreshPersonalAccounts()
  }, [])

  useEffect(() => {
    if (!pickerNonce) return
    setPendingLoading(true)
    fetch(`/api/v1/social/oauth/pending/${pickerNonce}`)
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('Failed to load account options')))
      .then((body) => {
        const options = Array.isArray(body.data?.options) ? body.data.options : []
        setPendingOptions(options)
        setPendingSelected(new Set(options.map((_: PendingOption, index: number) => index)))
      })
      .catch(() => setMarketingError('Failed to load personal account options. Please reconnect and try again.'))
      .finally(() => setPendingLoading(false))
  }, [pickerNonce])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    const res = await fetch('/api/v1/portal/settings/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    })
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Failed to save. Try again.')
    }
    setSaving(false)
  }

  function field(key: keyof ProfileData, label: string, required = false) {
    return (
      <div className="flex flex-col gap-1.5">
        <label className="pib-label !mb-0">
          {label}{required && ' *'}
        </label>
        <input
          type="text"
          value={(profile[key] as string) ?? ''}
          onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
          required={required}
          className="pib-input"
        />
      </div>
    )
  }

  function dismissPicker() {
    router.replace('/portal/settings/profile')
  }

  async function confirmPendingAccounts() {
    if (!pickerNonce || pendingSelected.size === 0) return
    setPendingSaving(true)
    setMarketingError('')
    setMarketingMessage('')
    try {
      const selections = Array.from(pendingSelected).map((index, position) => ({
        index,
        isDefault: position === 0,
      }))
      const res = await fetch('/api/v1/social/accounts/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: pickerNonce, selections }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to connect personal accounts.')
      setMarketingMessage('Personal accounts connected.')
      await refreshPersonalAccounts()
      dismissPicker()
    } catch (err) {
      setMarketingError(err instanceof Error ? err.message : 'Failed to connect personal accounts.')
    } finally {
      setPendingSaving(false)
    }
  }

  async function createPersonalPost(action: 'draft' | 'schedule') {
    setMarketingError('')
    setMarketingMessage('')
    if (!postContent.trim()) {
      setMarketingError('Write the post content first.')
      return
    }
    const selected = accounts.filter((account) => selectedAccountIds.includes(account.id))
    if (selected.length === 0) {
      setMarketingError('Select at least one personal account.')
      return
    }
    if (action === 'schedule' && !scheduledFor) {
      setMarketingError('Choose a schedule date and time.')
      return
    }

    setPosting(true)
    try {
      const res = await fetch('/api/v1/social/posts?scope=personal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { text: postContent.trim(), platformOverrides: {} },
          platforms: Array.from(new Set(selected.map((account) => account.platform))),
          accountIds: selected.map((account) => account.id),
          status: action === 'schedule' ? 'scheduled' : 'draft',
          scheduledAt: action === 'schedule' ? new Date(scheduledFor).toISOString() : undefined,
          source: 'ui',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Failed to save personal post.')
      setPostContent('')
      setScheduledFor('')
      setSelectedAccountIds([])
      setMarketingMessage(action === 'schedule' ? 'Personal post scheduled.' : 'Personal draft saved.')
    } catch (err) {
      setMarketingError(err instanceof Error ? err.message : 'Failed to save personal post.')
    } finally {
      setPosting(false)
    }
  }

  if (loading) return <div className="text-sm text-[var(--color-pib-text-muted)]">Loading…</div>

  return (
    <div className="max-w-4xl space-y-10">
      <h1 className="text-lg font-semibold mb-1">My profile</h1>
      <p className="text-sm text-[var(--color-pib-text-muted)] mb-8">
        Your identity in this workspace. Used on CRM records, comments, and activity.
      </p>

      {profile.role && (
        <div className="mb-6 flex items-center gap-2">
          <span className="text-xs text-[var(--color-pib-text-muted)]">Workspace role:</span>
          <span className="pill !text-[11px] !py-0.5 !px-2 capitalize">{profile.role}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div className="pib-card space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field('firstName', 'First name', true)}
            {field('lastName', 'Last name', true)}
          </div>
          {field('jobTitle', 'Job title')}
          {field('phone', 'Work phone')}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="pib-btn-primary w-full justify-center disabled:opacity-60 sm:w-auto"
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save profile'}
        </button>
      </form>

      <section className="space-y-5">
        <div>
          <p className="text-xs font-label uppercase tracking-widest text-[var(--color-pib-accent)]">Personal marketing</p>
          <h2 className="mt-1 text-lg font-semibold">Personal social & campaigns</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
            Connect social accounts for your own profile and draft or schedule posts that stay separate from the organisation's shared marketing.
          </p>
        </div>

        {pickerNonce && (
          <div className="pib-card space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Choose {PLATFORM_LABELS[pickerPlatform] ?? pickerPlatform} accounts</p>
                <p className="text-xs text-[var(--color-pib-text-muted)]">These will be saved as personal accounts for your profile.</p>
              </div>
              <button type="button" onClick={dismissPicker} className="text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)]">Close</button>
            </div>
            {pendingLoading ? (
              <div className="pib-skeleton h-20 rounded-md" />
            ) : (
              <div className="space-y-2">
                {pendingOptions.map((option, index) => (
                  <label key={`${option.platformAccountId}-${index}`} className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-pib-line)] px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={pendingSelected.has(index)}
                      onChange={() => {
                        setPendingSelected((prev) => {
                          const next = new Set(prev)
                          if (next.has(index)) next.delete(index)
                          else next.add(index)
                          return next
                        })
                      }}
                      className="accent-[var(--color-pib-accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate">{option.displayName}</span>
                    <span className="text-xs text-[var(--color-pib-text-muted)]">@{option.username}</span>
                  </label>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={confirmPendingAccounts}
              disabled={pendingSaving || pendingSelected.size === 0}
              className="pib-btn-primary disabled:opacity-60"
            >
              {pendingSaving ? 'Connecting...' : `Connect selected (${pendingSelected.size})`}
            </button>
          </div>
        )}

        {(marketingMessage || marketingError) && (
          <div className={`rounded-md border px-4 py-3 text-sm ${marketingError ? 'border-red-400/30 bg-red-400/10 text-red-300' : 'border-green-400/30 bg-green-400/10 text-green-300'}`}>
            {marketingError || marketingMessage}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.9fr)]">
          <div className="pib-card space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Personal accounts</p>
                <p className="text-xs text-[var(--color-pib-text-muted)]">{accounts.length} connected to your profile</p>
              </div>
              <a href="#personal-connect" className="pib-btn-secondary !py-2 !text-xs">Connect account</a>
            </div>
            {accountsLoading ? (
              <div className="pib-skeleton h-16 rounded-md" />
            ) : accounts.length === 0 ? (
              <div className="rounded-md border border-dashed border-[var(--color-pib-line)] px-4 py-6 text-sm text-[var(--color-pib-text-muted)]">
                No personal accounts connected yet.
              </div>
            ) : (
              <div className="space-y-2">
                {accounts.map((account) => (
                  <label key={account.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-[var(--color-pib-line)] px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedAccountIds.includes(account.id)}
                      onChange={() => setSelectedAccountIds((prev) => prev.includes(account.id) ? prev.filter((id) => id !== account.id) : [...prev, account.id])}
                      className="accent-[var(--color-pib-accent)]"
                    />
                    <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase">{PLATFORM_LABELS[account.platform] ?? account.platform}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">{account.displayName}</span>
                    <span className="text-xs text-[var(--color-pib-text-muted)]">{account.status}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="pib-card space-y-4">
            <div>
              <p className="text-sm font-semibold">Compose personal post</p>
              <p className="text-xs text-[var(--color-pib-text-muted)]">Draft or schedule against the selected personal accounts only.</p>
            </div>
            <textarea
              rows={5}
              value={postContent}
              onChange={(event) => setPostContent(event.target.value)}
              placeholder="Write your personal post..."
              className="pib-input min-h-32 resize-y"
            />
            <input
              type="datetime-local"
              value={scheduledFor}
              min={new Date().toISOString().slice(0, 16)}
              onChange={(event) => setScheduledFor(event.target.value)}
              className="pib-input"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => createPersonalPost('draft')} disabled={posting} className="pib-btn-secondary disabled:opacity-60">
                Save draft
              </button>
              <button type="button" onClick={() => createPersonalPost('schedule')} disabled={posting || !scheduledFor} className="pib-btn-primary disabled:opacity-60">
                Schedule
              </button>
            </div>
          </div>
        </div>

        <div id="personal-connect" className="pib-card space-y-3">
          <p className="text-sm font-semibold">Connect a personal account</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {OAUTH_PLATFORMS.map((platform) => (
              <a
                key={platform}
                href={`/api/v1/social/oauth/${platform}?scope=personal&redirectUrl=/portal/settings/profile${platform === 'linkedin' ? '&linkedinMode=personal' : ''}`}
                className="rounded-md border border-[var(--color-pib-line)] px-3 py-2 text-sm hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-accent)]"
              >
                Connect {PLATFORM_LABELS[platform] ?? platform}
              </a>
            ))}
          </div>
          <p className="text-xs text-[var(--color-pib-text-muted)]">Bluesky app-password support will stay available from the main Social Accounts page until a compact secure form is added here.</p>
        </div>
      </section>
    </div>
  )
}

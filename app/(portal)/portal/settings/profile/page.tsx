// app/(portal)/portal/settings/profile/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  ButtonLink,
  Field,
  Icon,
  Input,
  Notice,
  Panel,
  Skeleton,
  Title,
  Toolbar,
} from '@/components/studio'

interface ProfileData {
  firstName: string
  lastName: string
  jobTitle: string
  phone: string
  avatarUrl: string
  role: string | null
}

type ProfileResponse = {
  profile?: ProfileData
  error?: string
}

function isFilled(value: string) {
  return value.trim().length > 0
}

function formatRole(role: string | null) {
  if (!role) return 'Member access'
  return `${role[0].toUpperCase()}${role.slice(1)} access`
}

function fullName(profile: ProfileData) {
  const name = [profile.firstName, profile.lastName].filter(isFilled).join(' ').trim()
  return name || 'Name missing'
}

function countReadyFields(profile: ProfileData) {
  return [profile.firstName, profile.lastName, profile.jobTitle, profile.phone].filter(isFilled).length
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData>({
    firstName: '', lastName: '', jobTitle: '', phone: '', avatarUrl: '', role: null,
  })
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
    const body = await res.json().catch(() => ({})) as ProfileResponse
    if (res.ok) {
      setSaved(true)
      if (body.profile) setProfile((prev) => ({ ...prev, ...body.profile }))
      setTimeout(() => setSaved(false), 3000)
    } else {
      setError(body.error ?? 'Failed to save. Try again.')
    }
    setSaving(false)
  }

  const readyFields = countReadyFields(profile)
  const ownershipState = isFilled(profile.firstName) && isFilled(profile.lastName) && isFilled(profile.jobTitle)
    ? 'Profile ready'
    : 'Profile incomplete'
  const contactState = isFilled(profile.phone) ? profile.phone : 'Phone missing'

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton height={24} width={160} />
        <Panel className="space-y-3">
          <Skeleton height={20} width={224} />
          <Skeleton height={16} className="w-full max-w-xl" />
        </Panel>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="My profile."
        description="Manage the identity your team sees, then jump into your own user-owned marketing workspace."
      />

      <section role="region" aria-label="Profile command center" className="space-y-4">
        <Panel className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="sc-tiny">Profile and attribution</p>
              <Title className="mt-1">Profile command center</Title>
              <p className="sc-body mt-2 max-w-2xl text-[var(--sc-ink-soft)]">
                This is your human identity across CRM handoffs, approvals, personal social drafts, and user-owned workspace activity.
              </p>
            </div>
            <p className="sc-body rounded border border-[var(--sc-line)] px-4 py-3 text-[var(--sc-ink-soft)]">
              {formatRole(profile.role)}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div data-testid="profile-readiness-ready-fields" className="pib-stat-card st-panel--flat min-w-0 space-y-2 p-4">
              <p className="st-num text-2xl text-[var(--sc-ink)]">{readyFields} ready fields</p>
              <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">Name, title, and contact coverage.</p>
            </div>
            <div data-testid="profile-readiness-name" className="pib-stat-card st-panel--flat min-w-0 space-y-2 p-4">
              <p className="truncate text-sm text-[var(--sc-ink)]" title={fullName(profile)}>{fullName(profile)}</p>
              <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">Displayed on CRM records, comments, and personal drafts.</p>
            </div>
            <div data-testid="profile-readiness-title" className="pib-stat-card st-panel--flat min-w-0 space-y-2 p-4">
              <p className="truncate text-sm text-[var(--sc-ink)]" title={profile.jobTitle || 'Job title missing'}>{profile.jobTitle || 'Job title missing'}</p>
              <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">{ownershipState}</p>
            </div>
            <div data-testid="profile-readiness-contact" className="pib-stat-card st-panel--flat min-w-0 space-y-2 p-4">
              <p className="truncate text-sm text-[var(--sc-ink)]" title={contactState}>{contactState}</p>
              <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">Used when workspace work needs a direct contact.</p>
            </div>
          </div>
        </Panel>
      </section>

      <section role="region" aria-label="Personal social marketing" className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Panel className="space-y-5 overflow-hidden">
          <div className="flex items-start gap-4">
            <Icon name="person_play" />
            <div>
              <p className="sc-tiny">Your own channels</p>
              <Title className="mt-2">Personal social marketing</Title>
              <p className="sc-body mt-2 max-w-2xl text-[var(--sc-ink-soft)]">
                Use this for posts, content vault, schedules, X MCP/bookmarks, and accounts that belong to you as a user. Company / organisation social remains the shared brand or client workspace.
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Link href="/portal/personal/marketing" className="pib-stat-card st-panel--flat group min-w-0 space-y-2 p-4 transition hover:border-[var(--sc-ink)]">
              <Icon name="space_dashboard" />
              <p className="text-sm text-[var(--sc-ink)]">Open personal workspace</p>
              <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">Dashboard, vault, calendar, history, and X MCP setup.</p>
            </Link>
            <Link href="/portal/personal/social/compose" className="pib-stat-card st-panel--flat group min-w-0 space-y-2 p-4 transition hover:border-[var(--sc-ink)]">
              <Icon name="edit_square" />
              <p className="text-sm text-[var(--sc-ink)]">Compose personal post</p>
              <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">Draft, schedule, preview, and publish from your accounts.</p>
            </Link>
            <Link href="/portal/personal/social/accounts" className="pib-stat-card st-panel--flat group min-w-0 space-y-2 p-4 transition hover:border-[var(--sc-ink)]">
              <Icon name="add_link" />
              <p className="text-sm text-[var(--sc-ink)]">Connect personal accounts</p>
              <p className="sc-body text-[0.75rem] text-[var(--sc-ink-soft)]">OAuth and X MCP are user-owned, not shared company tokens.</p>
            </Link>
          </div>
        </Panel>
        <Panel flat className="space-y-3">
          <p className="sc-tiny">Clear distinction</p>
          <div className="sc-body space-y-3 text-[var(--sc-ink-soft)]">
            <p><span className="text-[var(--sc-ink)]">Personal</span> is for your profile, bookmarks, personal voice, and accounts owned by your login.</p>
            <p><span className="text-[var(--sc-ink)]">Company / organisation</span> is for shared brand/client publishing, approvals, and team-managed accounts.</p>
          </div>
          <ButtonLink href="/portal/social" variant="ghost" size="sm">
            Open company social instead
            <Icon name="arrow_forward" />
          </ButtonLink>
        </Panel>
      </section>

      <form onSubmit={handleSave} className="space-y-4">
        <Panel className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="profile-firstName" label="First name">
              <Input
                id="profile-firstName"
                aria-label="First name"
                type="text"
                value={profile.firstName}
                onChange={e => setProfile(p => ({ ...p, firstName: e.target.value }))}
                required
              />
            </Field>
            <Field id="profile-lastName" label="Last name">
              <Input
                id="profile-lastName"
                aria-label="Last name"
                type="text"
                value={profile.lastName}
                onChange={e => setProfile(p => ({ ...p, lastName: e.target.value }))}
                required
              />
            </Field>
          </div>
          <Field id="profile-jobTitle" label="Job title">
            <Input
              id="profile-jobTitle"
              aria-label="Job title"
              type="text"
              value={profile.jobTitle}
              onChange={e => setProfile(p => ({ ...p, jobTitle: e.target.value }))}
            />
          </Field>
          <Field id="profile-phone" label="Work phone">
            <Input
              id="profile-phone"
              aria-label="Work phone"
              type="text"
              value={profile.phone}
              onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
            />
          </Field>
        </Panel>

        {error ? <Notice tone="danger">{error}</Notice> : null}

        <Toolbar className="sticky bottom-4 z-10 border border-[var(--sc-line)] bg-[var(--sc-surface)] p-4">
          <Button type="submit" loading={saving}>
            {saved ? 'Saved' : 'Save profile'}
          </Button>
        </Toolbar>
      </form>
    </div>
  )
}

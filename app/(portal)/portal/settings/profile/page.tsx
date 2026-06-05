// app/(portal)/portal/settings/profile/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'

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

  function field(key: keyof ProfileData, label: string, required = false) {
    const id = `profile-${key}`
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="pib-label !mb-0">
          {label}{required && ' *'}
        </label>
        <input
          id={id}
          type="text"
          value={(profile[key] as string) ?? ''}
          onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
          required={required}
          className="pib-input"
        />
      </div>
    )
  }

  const readyFields = countReadyFields(profile)
  const ownershipState = isFilled(profile.firstName) && isFilled(profile.lastName) && isFilled(profile.jobTitle)
    ? 'CRM ownership ready'
    : 'CRM ownership incomplete'
  const contactState = isFilled(profile.phone) ? profile.phone : 'Phone missing'

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-40 rounded bg-[var(--color-pib-surface-soft)]" />
        <div className="pib-card space-y-3">
          <div className="h-5 w-56 rounded bg-[var(--color-pib-surface-soft)]" />
          <div className="h-4 w-full max-w-xl rounded bg-[var(--color-pib-surface-soft)]" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">CRM settings</p>
        <h1 className="pib-page-title mt-2">My profile</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
          Keep your CRM identity complete so records, comments, activity, and ownership handoffs have a clear accountable person.
        </p>
      </div>

      <section role="region" aria-label="Profile command center" className="space-y-4">
        <div className="pib-card space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow !text-[10px]">CRM attribution</p>
              <h2 className="mt-2 font-display text-2xl text-[var(--color-pib-text)]">Profile command center</h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
                This is the identity your team sees on assigned contacts, activity notes, approvals, and internal handoffs.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] px-4 py-3 text-sm text-[var(--color-pib-text-muted)]">
              {formatRole(profile.role)}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
              <p className="text-2xl font-semibold text-[var(--color-pib-text)]">{readyFields} ready fields</p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">Name, title, and contact coverage.</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">{fullName(profile)}</p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">Displayed on CRM records and comments.</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">{profile.jobTitle || 'Job title missing'}</p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">{ownershipState}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-pib-border)] bg-[var(--color-pib-surface-soft)] p-4">
              <p className="text-sm font-semibold text-[var(--color-pib-text)]">{contactState}</p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-pib-text-muted)]">Used when CRM work needs a direct internal contact.</p>
            </div>
          </div>
        </div>
      </section>

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
    </div>
  )
}

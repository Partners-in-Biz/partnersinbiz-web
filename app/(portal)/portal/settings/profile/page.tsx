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

  if (loading) return <div className="text-sm text-[var(--color-pib-text-muted)]">Loading…</div>

  return (
    <div className="max-w-4xl space-y-10">
      <div>
        <h1 className="text-lg font-semibold mb-1">My profile</h1>
        <p className="text-sm text-[var(--color-pib-text-muted)]">
          Your identity in this workspace. Used on CRM records, comments, and activity.
        </p>
      </div>

      {profile.role && (
        <div className="flex items-center gap-2">
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
    </div>
  )
}

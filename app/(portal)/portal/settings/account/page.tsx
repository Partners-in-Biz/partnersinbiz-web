// app/(portal)/portal/settings/account/page.tsx
'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import {
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  updatePassword,
  EmailAuthProvider,
} from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/config'
import { AccountDeletionFlow } from '@/components/settings/AccountDeletionFlow'

const TIMEZONES = [
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST, UTC+2)' },
  { value: 'Africa/Nairobi', label: 'Africa/Nairobi (EAT, UTC+3)' },
  { value: 'Africa/Lagos', label: 'Africa/Lagos (WAT, UTC+1)' },
  { value: 'Africa/Cairo', label: 'Africa/Cairo (EET, UTC+2)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET, UTC+1)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET, UTC+1)' },
  { value: 'Europe/Amsterdam', label: 'Europe/Amsterdam (CET, UTC+1)' },
  { value: 'America/New_York', label: 'America/New_York (EST/EDT)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
  { value: 'America/Denver', label: 'America/Denver (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'America/Sao_Paulo', label: 'America/Sao_Paulo (BRT, UTC−3)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST, UTC+4)' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore (SST, UTC+8)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST, UTC+9)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
  { value: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
]

function unwrap(body: unknown): Record<string, unknown> {
  const b = body as { data?: Record<string, unknown> } & Record<string, unknown>
  return (b?.data ?? b) ?? {}
}

export default function AccountSettingsPage() {
  const auth = getClientAuth()
  const user = auth.currentUser
  const email = user?.email ?? ''
  const emailDisplay = email || 'Email missing'

  // ---- Profile state ----
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [timezone, setTimezone] = useState('Africa/Johannesburg')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [profileLoading, setProfileLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileError, setProfileError] = useState('')

  // ---- Avatar upload ----
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState('')

  // ---- 2FA status ----
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null)

  // ---- Password reset (email link) ----
  const [resetting, setResetting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetError, setResetError] = useState('')

  // ---- In-page change password ----
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  // ---- Delete ----

  useEffect(() => {
    let alive = true
    // Load profile (orgMembers + timezone).
    fetch('/api/v1/portal/settings/profile')
      .then(async (res) => (await res.json().catch(() => ({}))))
      .then((body) => {
        if (!alive) return
        const profile = (body as { profile?: Record<string, unknown> }).profile ?? {}
        setFirstName((profile.firstName as string) ?? '')
        setLastName((profile.lastName as string) ?? '')
        setPhone((profile.phone as string) ?? '')
        setAvatarUrl((profile.avatarUrl as string) ?? '')
      })
      .catch(() => {})
      .finally(() => { if (alive) setProfileLoading(false) })

    // Timezone lives on the users doc — exposed via 2fa status? No. Use a light read via update? Use status route only for 2FA.
    fetch('/api/v1/account/2fa/status')
      .then(async (res) => unwrap(await res.json().catch(() => ({}))))
      .then((data) => { if (alive) setTwoFactorEnabled(data.enabled === true) })
      .catch(() => { if (alive) setTwoFactorEnabled(false) })

    return () => { alive = false }
  }, [])

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (savingProfile) return
    setSavingProfile(true)
    setProfileSaved(false)
    setProfileError('')
    try {
      const res = await fetch('/api/v1/account/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, phone, timezone, avatarUrl }),
      })
      const data = unwrap(await res.json().catch(() => ({})))
      if (!res.ok) throw new Error((data.error as string) ?? 'Failed to save profile')
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleAvatarSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    setAvatarError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/v1/account/avatar', { method: 'POST', body: fd })
      const data = unwrap(await res.json().catch(() => ({})))
      if (!res.ok) throw new Error((data.error as string) ?? 'Upload failed')
      const url = data.url as string
      setAvatarUrl(url)
      // Persist immediately so the avatar isn't lost if the user navigates away.
      await fetch('/api/v1/account/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, phone, timezone, avatarUrl: url }),
      })
    } catch (err: unknown) {
      setAvatarError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handlePasswordReset() {
    if (!email || resetting) return
    setResetting(true)
    setResetError('')
    try {
      await sendPasswordResetEmail(auth, email)
      setResetSent(true)
    } catch {
      setResetError('Failed to send reset email. Try again.')
    } finally {
      setResetting(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (changingPassword || !user || !email) return
    setPasswordError('')
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.')
      return
    }
    setChangingPassword(true)
    try {
      const credential = EmailAuthProvider.credential(email, currentPassword)
      await reauthenticateWithCredential(user, credential)
      await updatePassword(user, newPassword)
      setPasswordChanged(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordChanged(false), 4000)
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? ''
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPasswordError('Current password is incorrect.')
      } else if (code === 'auth/weak-password') {
        setPasswordError('New password is too weak.')
      } else {
        setPasswordError('Could not change password. Try signing out and back in, then retry.')
      }
    } finally {
      setChangingPassword(false)
    }
  }

  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || email.charAt(0).toUpperCase()

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">Portal settings</p>
          <h1 className="pib-page-title mt-2">Account settings</h1>
          <p className="mt-2 max-w-3xl text-sm text-[var(--color-pib-text-muted)]">
            Manage your profile, login identity, password, and security without changing workspace, CRM, or client data.
          </p>
        </div>
      </div>

      {/* ---- Profile ---- */}
      <section data-testid="account-profile-panel" className="pib-card-section">
        <div className="pib-card-section-header flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Your profile</p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">Profile details</h2>
          </div>
          <span aria-live="polite">
            {savingProfile ? <span className="pib-pill">Saving…</span> : profileSaved ? <span className="pib-pill pib-pill-success">Saved</span> : null}
          </span>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-6 p-5">
          <div className="flex items-center gap-5 max-sm:flex-col max-sm:items-start">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)]">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Profile picture" className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-semibold text-[var(--color-pib-text-muted)]">{initials}</span>
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarSelected}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="rounded-lg border border-[var(--color-pib-line)] px-4 py-2 text-sm font-medium text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.03] disabled:opacity-60"
              >
                {uploadingAvatar ? 'Uploading…' : 'Upload profile picture'}
              </button>
              <p className="text-xs text-[var(--color-pib-text-muted)]">PNG or JPG, up to 5MB.</p>
              {avatarError && <p className="text-xs text-red-400" role="alert">{avatarError}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="pib-label" htmlFor="acct-first-name">First name</label>
              <input id="acct-first-name" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="pib-input w-full" placeholder="First name" disabled={profileLoading} />
            </div>
            <div>
              <label className="pib-label" htmlFor="acct-last-name">Last name</label>
              <input id="acct-last-name" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="pib-input w-full" placeholder="Last name" disabled={profileLoading} />
            </div>
            <div>
              <label className="pib-label" htmlFor="acct-phone">Phone</label>
              <input id="acct-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="pib-input w-full" placeholder="+27 ..." disabled={profileLoading} />
            </div>
            <div>
              <label className="pib-label" htmlFor="acct-timezone">Timezone</label>
              <select id="acct-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="pib-input w-full" disabled={profileLoading}>
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
          </div>

          {profileError && <p className="text-xs text-red-400" role="alert">{profileError}</p>}

          <button type="submit" disabled={savingProfile || profileLoading || !firstName.trim()} className="pib-btn-primary disabled:opacity-60">
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>

      {/* ---- Login identity (read-only) ---- */}
      <section data-testid="account-login-panel" className="pib-card-section">
        <div className="pib-card-section-header">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Login identity</p>
        </div>
        <div className="pib-card-section-row items-start gap-4 max-sm:flex-col">
          <span className="material-symbols-outlined rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-2 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">alternate_email</span>
          <div className="min-w-0 flex-1 space-y-2">
            <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Login email</h2>
            <p className="truncate text-sm font-semibold text-[var(--color-pib-text)]" title={emailDisplay}>{emailDisplay}</p>
            <p className="text-xs leading-5 text-[var(--color-pib-text-muted)]">
              Read-only. Managed by your account provider so CRM ownership remains tied to a verified identity.
            </p>
          </div>
        </div>
      </section>

      {/* ---- Security: 2FA + Sessions links ---- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section data-testid="account-2fa-panel" className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Security</p>
          </div>
          <div className="pib-card-section-row items-start gap-4 max-sm:flex-col">
            <span className="material-symbols-outlined rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-2 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">shield_lock</span>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Two-factor authentication</h2>
                {twoFactorEnabled === null ? null : twoFactorEnabled ? (
                  <span className="pib-pill pib-pill-success">On</span>
                ) : (
                  <span className="pib-pill">Off</span>
                )}
              </div>
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                Require a one-time code from an authenticator app at sign-in for extra protection.
              </p>
              <a href="/portal/settings/security" className="pib-btn-primary inline-flex w-fit">
                {twoFactorEnabled ? 'Manage 2FA' : 'Enable 2FA'}
              </a>
            </div>
          </div>
        </section>

        <section data-testid="account-sessions-panel" className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Sessions</p>
          </div>
          <div className="pib-card-section-row items-start gap-4 max-sm:flex-col">
            <span className="material-symbols-outlined rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-2 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">devices</span>
            <div className="min-w-0 flex-1 space-y-3">
              <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Active sessions</h2>
              <p className="text-sm text-[var(--color-pib-text-muted)]">
                Review signed-in devices, revoke individual sessions, or sign out everywhere else.
              </p>
              <a href="/portal/settings/sessions" className="rounded-lg border border-[var(--color-pib-line)] px-4 py-2 text-sm font-medium text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.03] inline-flex w-fit">
                Manage sessions
              </a>
            </div>
          </div>
        </section>
      </div>

      {/* ---- Password: change in-page + reset email ---- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <section data-testid="account-change-password-panel" className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Change password</p>
          </div>
          <form onSubmit={handleChangePassword} className="space-y-4 p-5">
            <p className="text-sm text-[var(--color-pib-text-muted)]">
              Update your password directly. We&apos;ll re-confirm your current password first.
            </p>
            <div>
              <label className="pib-label" htmlFor="acct-current-pw">Current password</label>
              <input id="acct-current-pw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="pib-input w-full" autoComplete="current-password" />
            </div>
            <div>
              <label className="pib-label" htmlFor="acct-new-pw">New password</label>
              <input id="acct-new-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="pib-input w-full" autoComplete="new-password" />
            </div>
            <div>
              <label className="pib-label" htmlFor="acct-confirm-pw">Confirm new password</label>
              <input id="acct-confirm-pw" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="pib-input w-full" autoComplete="new-password" />
            </div>
            {passwordError && <p className="text-xs text-red-400" role="alert">{passwordError}</p>}
            {passwordChanged && <p className="pib-pill pib-pill-success w-fit" role="status">Password updated.</p>}
            <button type="submit" disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} className="pib-btn-primary disabled:opacity-60">
              {changingPassword ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </section>

        <section data-testid="account-password-panel" className="pib-card-section">
          <div className="pib-card-section-header">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Credential recovery</p>
          </div>
          <div className="pib-card-section-row items-start gap-4 max-sm:flex-col">
            <span className="material-symbols-outlined rounded-xl border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-soft)] p-2 text-[20px] text-[var(--color-pib-accent)]" aria-hidden="true">key</span>
            <div className="min-w-0 flex-1 space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">Password reset email</h2>
                <p className="mt-2 text-sm text-[var(--color-pib-text-muted)]">
                  Prefer a link? Send a reset email to recover account ownership.
                </p>
              </div>
              {resetSent ? (
                <p className="pib-pill pib-pill-success w-fit" role="status">Password reset email sent to {email}.</p>
              ) : (
                <>
                  <button type="button" onClick={handlePasswordReset} disabled={resetting || !email} className="rounded-lg border border-[var(--color-pib-line)] px-4 py-2 text-sm font-medium text-[var(--color-pib-text)] transition-colors hover:bg-white/[0.03] disabled:opacity-60">
                    {resetting ? 'Sending...' : 'Send password reset email'}
                  </button>
                  {resetError && <p className="text-xs text-red-400 mt-1" role="alert">{resetError}</p>}
                </>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ---- Danger zone (hardened, recoverable deletion — US-217) ---- */}
      <AccountDeletionFlow />
    </div>
  )
}

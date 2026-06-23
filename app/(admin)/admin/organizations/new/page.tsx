'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'

interface ResultState {
  orgId: string
  slug: string
  ownerEmail: string
  ownerCreated: boolean
  setupLink: string | null
  welcomeEmailSent: boolean
  trialSet: boolean
  trialDays: number
  warnings: string[]
}

export default function NewOrganizationPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ResultState | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    website: '',
    industry: '',
    description: '',
    plan: '',
    timezone: 'Africa/Johannesburg',
    currency: 'ZAR',
    agentName: '',
    provisionWorkspace: true,
    // Owner / onboarding
    ownerName: '',
    ownerEmail: '',
    trialDays: 14,
    sendWelcomeEmail: true,
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    if (type === 'checkbox') {
      setFormData((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }))
      return
    }
    if (type === 'number') {
      setFormData((prev) => ({ ...prev, [name]: value === '' ? '' : Number(value) }))
      return
    }
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setResult(null)

    const name = formData.name.trim()
    const ownerName = formData.ownerName.trim()
    const ownerEmail = formData.ownerEmail.trim().toLowerCase()

    if (!name) {
      setError('Client workspace name is required before this platform provisioning operation can run.')
      setLoading(false)
      return
    }
    if (!ownerName) {
      setError('Owner name is required so the client can be created and invited.')
      setLoading(false)
      return
    }
    if (!ownerEmail) {
      setError('Owner email is required so a login can be created for the client.')
      setLoading(false)
      return
    }

    const trialDays = Number(formData.trialDays) > 0 ? Math.floor(Number(formData.trialDays)) : 0
    const warnings: string[] = []

    try {
      // 1) Create the organisation record (+ optional workspace provisioning).
      const orgRes = await fetch('/api/v1/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          website: formData.website,
          industry: formData.industry,
          description: formData.description,
          billingEmail: ownerEmail,
          plan: formData.plan,
          settings: {
            timezone: formData.timezone,
            currency: formData.currency,
          },
          agentName: formData.agentName,
          provisionWorkspace: formData.provisionWorkspace,
          type: 'client',
          status: 'onboarding',
        }),
      })

      const orgBody = await orgRes.json().catch(() => ({}))
      if (!orgRes.ok || !orgBody?.success) {
        // The org POST returns { id, slug } even on provisioning failure (500 with extra fields).
        const partialId = orgBody?.id
        if (!partialId) {
          setError(orgBody?.error || 'Failed to provision client workspace')
          setLoading(false)
          return
        }
        warnings.push(orgBody?.error || 'Workspace provisioning reported an issue; the org record was still created.')
      }

      const orgId: string = orgBody?.data?.id ?? orgBody?.id
      const slug: string = orgBody?.data?.slug ?? orgBody?.slug ?? ''
      if (!orgId) {
        setError('Organisation was created but no id was returned; cannot continue onboarding.')
        setLoading(false)
        return
      }

      // 2) Create the owner login (Firebase Auth user + member + password-setup email).
      let ownerCreated = false
      let setupLink: string | null = null
      let welcomeEmailSent = false
      try {
        const loginRes = await fetch(`/api/v1/organizations/${orgId}/create-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: ownerEmail,
            name: ownerName,
            role: 'owner',
            sendWelcomeEmail: formData.sendWelcomeEmail,
          }),
        })
        const loginBody = await loginRes.json().catch(() => ({}))
        if (loginRes.ok && loginBody?.success) {
          ownerCreated = true
          setupLink = loginBody.data?.setupLink ?? null
          welcomeEmailSent = formData.sendWelcomeEmail && Boolean(setupLink)
        } else {
          warnings.push(loginBody?.error || 'Owner login could not be created. Create it from the org admin page.')
        }
      } catch {
        warnings.push('Owner login request failed. Create the login from the org admin page.')
      }

      // 3) Set the EFT trial window on the org's adminBilling.
      let trialSet = false
      if (trialDays > 0) {
        try {
          const trialRes = await fetch(`/api/v1/admin/org/${orgId}/trial`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trialDays, currency: formData.currency }),
          })
          const trialBody = await trialRes.json().catch(() => ({}))
          if (trialRes.ok && trialBody?.success) {
            trialSet = true
          } else {
            warnings.push(trialBody?.error || 'Trial window could not be set on the org billing record.')
          }
        } catch {
          warnings.push('Trial request failed. Set the trial from the org billing page.')
        }
      }

      setResult({
        orgId,
        slug,
        ownerEmail,
        ownerCreated,
        setupLink,
        welcomeEmailSent,
        trialSet,
        trialDays,
        warnings,
      })
    } catch {
      setError('An error occurred while provisioning the client workspace')
    } finally {
      setLoading(false)
    }
  }

  // Success / summary view
  if (result) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="text-xs text-on-surface-variant font-label uppercase tracking-wide">
          <Link href="/admin/organizations" className="hover:text-on-surface">Organisations</Link>
          <span className="mx-2">/</span>
          <span>Workspace provisioned</span>
        </div>

        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Client workspace created</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            The organisation record, owner login, and trial window have been set up.
          </p>
        </div>

        <div className="pib-card space-y-3">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Summary</p>
          <ul className="text-sm text-on-surface space-y-2">
            <li>✅ Organisation record created{result.slug ? ` (slug: ${result.slug})` : ''}.</li>
            <li>{result.ownerCreated ? '✅' : '⚠️'} Owner login for <strong>{result.ownerEmail}</strong> {result.ownerCreated ? 'created and added as owner.' : 'could not be created.'}</li>
            <li>{result.welcomeEmailSent ? '✅ Welcome / password-setup email sent.' : (formData.sendWelcomeEmail ? '⚠️ Welcome email was requested but no setup link was generated.' : 'ℹ️ Welcome email skipped (toggle off).')}</li>
            <li>{result.trialDays > 0 ? (result.trialSet ? `✅ ${result.trialDays}-day EFT trial set.` : `⚠️ ${result.trialDays}-day trial could not be set.`) : 'ℹ️ No trial set (0 days).'}</li>
          </ul>
        </div>

        {result.setupLink ? (
          <div className="pib-card space-y-2">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Password-setup link</p>
            <p className="text-xs text-on-surface-variant">
              {result.welcomeEmailSent
                ? 'Already emailed to the owner. Copy below if you need to forward it manually.'
                : 'Welcome email was skipped — forward this link to the owner so they can set their password.'}
            </p>
            <input
              readOnly
              value={result.setupLink}
              onFocus={(e) => e.currentTarget.select()}
              className="pib-input text-xs"
            />
          </div>
        ) : null}

        {result.warnings.length > 0 ? (
          <div className="pib-card !border-amber-500/30 !bg-amber-500/5 space-y-1">
            <p className="text-[10px] font-label uppercase tracking-widest text-amber-400">Warnings</p>
            {result.warnings.map((w, i) => (
              <p key={i} className="text-sm text-amber-300">• {w}</p>
            ))}
          </div>
        ) : null}

        <div className="flex gap-3 pt-2">
          <Link href="/admin/organizations" className="pib-btn-primary">Back to organisations</Link>
          {result.slug ? (
            <Link href={`/admin/org/${result.slug}/dashboard`} className="pib-btn-secondary">Open workspace</Link>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-xs text-on-surface-variant font-label uppercase tracking-wide">
        <Link href="/admin/organizations" className="hover:text-on-surface">Organisations</Link>
        <span className="mx-2">/</span>
        <span>Provision Client Workspace</span>
      </div>

      {/* Heading */}
      <div>
        <h1 className="text-2xl font-headline font-bold text-on-surface">Provision Client Workspace</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Creates a client organisation, an owner login with a password-setup email, an EFT trial window,
          and optional Cowork/Hermes workspace scaffolding. No card required — EFT billing only.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <div className="pib-card !border-red-500/30 !bg-red-500/5 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Company Details Card */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Client Workspace Details
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="pib-label">Client workspace name *</label>
              <input id="name" type="text" name="name" required value={formData.name} onChange={handleChange} placeholder="e.g. Acme Inc" className="pib-input" />
            </div>
            <div>
              <label htmlFor="website" className="pib-label">Website</label>
              <input id="website" type="url" name="website" value={formData.website} onChange={handleChange} placeholder="e.g. https://acme.com" className="pib-input" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="timezone" className="pib-label">Timezone</label>
              <select id="timezone" name="timezone" value={formData.timezone} onChange={handleChange} className="pib-select">
                <option value="Africa/Johannesburg">Africa/Johannesburg (SAST)</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Los_Angeles">America/Los_Angeles</option>
                <option value="Europe/London">Europe/London</option>
                <option value="Europe/Amsterdam">Europe/Amsterdam</option>
                <option value="Asia/Dubai">Asia/Dubai</option>
                <option value="Australia/Sydney">Australia/Sydney</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div>
              <label htmlFor="currency" className="pib-label">Currency</label>
              <select id="currency" name="currency" value={formData.currency} onChange={handleChange} className="pib-select">
                <option value="ZAR">ZAR (R)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="industry" className="pib-label">Industry</label>
            <input id="industry" type="text" name="industry" value={formData.industry} onChange={handleChange} placeholder="e.g. Technology" className="pib-input" />
          </div>

          <div>
            <label htmlFor="description" className="pib-label">Description</label>
            <textarea id="description" name="description" value={formData.description} onChange={handleChange} placeholder="Brief description of the client..." rows={4} className="pib-textarea" />
          </div>
        </div>

        {/* Owner & Onboarding Card */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Owner & Onboarding
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ownerName" className="pib-label">Owner name *</label>
              <input id="ownerName" type="text" name="ownerName" required value={formData.ownerName} onChange={handleChange} placeholder="e.g. Jane Doe" className="pib-input" />
            </div>
            <div>
              <label htmlFor="ownerEmail" className="pib-label">Owner email *</label>
              <input id="ownerEmail" type="email" name="ownerEmail" required value={formData.ownerEmail} onChange={handleChange} placeholder="e.g. jane@acme.com" className="pib-input" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="trialDays" className="pib-label">Trial length (days)</label>
              <input id="trialDays" type="number" name="trialDays" min={0} max={365} value={formData.trialDays} onChange={handleChange} placeholder="14" className="pib-input" />
              <p className="text-xs text-on-surface-variant mt-1">Sets an EFT trial window on the org. Use 0 for no trial.</p>
            </div>
            <div>
              <label htmlFor="plan" className="pib-label">Plan</label>
              <select id="plan" name="plan" value={formData.plan} onChange={handleChange} className="pib-select">
                <option value="">-- Select Plan --</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="agency">Agency</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-3 text-sm text-on-surface">
            <input
              type="checkbox"
              name="sendWelcomeEmail"
              checked={formData.sendWelcomeEmail}
              onChange={handleChange}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Send welcome / password-setup email</span>
              <span className="block text-xs text-on-surface-variant">
                Emails the owner a button to set their password and sign in. When off, the setup link is
                shown here for you to forward manually.
              </span>
            </span>
          </label>
        </div>

        {/* Cowork & Hermes Card */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Cowork & Hermes Provisioning
          </p>

          <label className="flex items-start gap-3 text-sm text-on-surface">
            <input
              type="checkbox"
              name="provisionWorkspace"
              checked={formData.provisionWorkspace}
              onChange={handleChange}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Provision full client workspace</span>
              <span className="block text-xs text-on-surface-variant">
                Creates the VPS Cowork folder, Obsidian agent domain, wiki/log/raw folders,
                project instructions, Hermes profile, SOUL.md, and global Cowork mapping.
              </span>
            </span>
          </label>

          <div>
            <label htmlFor="agentName" className="pib-label">Agent profile name</label>
            <input
              id="agentName"
              type="text"
              name="agentName"
              value={formData.agentName}
              onChange={handleChange}
              placeholder="Defaults to the first word of the organisation name"
              className="pib-input"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={loading} className="pib-btn-primary">
            {loading ? 'Provisioning...' : 'Provision client workspace'}
          </button>
          <Link href="/admin/organizations" className="pib-btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}

'use client'
export const dynamic = 'force-dynamic'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface OrgDetail {
  id: string
  name: string
  slug: string
  type: string
  status: string
  description?: string
  website?: string
  industry?: string
  billingEmail?: string
  plan?: string
  logoUrl?: string
  memberCount?: number
  settings?: {
    timezone?: string
    currency?: string
  }
}

export default function OrganizationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    website: '',
    industry: '',
    description: '',
    billingEmail: '',
    plan: '',
    status: '',
    timezone: 'Africa/Johannesburg',
    currency: 'ZAR',
  })

  useEffect(() => {
    fetch(`/api/v1/organizations/${id}`)
      .then(r => r.json())
      .then(body => {
        const o: OrgDetail = body.data ?? body
        setOrg(o)
        setFormData({
          name: o.name ?? '',
          website: o.website ?? '',
          industry: o.industry ?? '',
          description: o.description ?? '',
          billingEmail: o.billingEmail ?? '',
          plan: o.plan ?? '',
          status: o.status ?? '',
          timezone: o.settings?.timezone ?? 'Africa/Johannesburg',
          currency: o.settings?.currency ?? 'ZAR',
        })
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess(false)

    try {
      const response = await fetch(`/api/v1/organizations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          website: formData.website,
          industry: formData.industry,
          description: formData.description,
          billingEmail: formData.billingEmail,
          plan: formData.plan,
          status: formData.status,
          settings: {
            timezone: formData.timezone,
            currency: formData.currency,
          },
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to save changes')
        return
      }

      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    } catch {
      setError('An error occurred while saving')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <div className="pib-skeleton h-6 w-48" />
        <div className="pib-skeleton h-64 w-full" />
      </div>
    )
  }

  if (!org) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center">
        <p className="text-[var(--color-pib-text-muted)]">Organisation not found.</p>
        <Link href="/admin/organizations" className="st-btn st-btn--secondary mt-4 inline-block">Back to Organisations</Link>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-xs text-[var(--color-pib-text-muted)] font-label uppercase tracking-wide">
        <Link href="/admin/organizations" className="hover:text-[var(--color-pib-text)]">Client Workspaces</Link>
        <span className="mx-2">/</span>
        <span className="truncate">{org.name}</span>
      </div>

      {/* Heading */}
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Admin · Client workspace</p>
          <h1 className="pib-page-title mt-2 truncate">{org.name}</h1>
          <p className="pib-page-sub">
            Platform-admin organisation record for client workspace provisioning, billing controls, and operational status.
          </p>
        </div>
        {org.slug && (
          <Link
            href={`/admin/org/${org.slug}/dashboard`}
            className="st-btn st-btn--secondary shrink-0"
          >
            Open admin workspace ↗
          </Link>
        )}
      </header>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Feedback */}
        {error && (
          <div className="st-panel text-sm text-[var(--color-error)]">{error}</div>
        )}
        {success && (
          <div className="st-panel !border-green-500/30 !bg-green-500/5 text-sm text-[var(--color-pib-green)]">Changes saved.</div>
        )}

        {/* Details Card */}
        <div className="st-panel space-y-4">
          <p className="sc-tiny">Client Workspace Details</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="sc-tiny">Name *</label>
              <input id="name" type="text" name="name" required value={formData.name} onChange={handleChange} className="st-input" />
            </div>
            <div>
              <label htmlFor="website" className="sc-tiny">Website</label>
              <input id="website" type="url" name="website" value={formData.website} onChange={handleChange} placeholder="https://" className="st-input" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="status" className="sc-tiny">Status</label>
              <select id="status" name="status" value={formData.status} onChange={handleChange} className="st-select">
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label htmlFor="industry" className="sc-tiny">Industry</label>
              <input id="industry" type="text" name="industry" value={formData.industry} onChange={handleChange} placeholder="e.g. Technology" className="st-input" />
            </div>
          </div>

          <div>
            <label htmlFor="description" className="sc-tiny">Description</label>
            <textarea id="description" name="description" value={formData.description} onChange={handleChange} rows={3} className="st-textarea" />
          </div>
        </div>

        {/* Billing & Plan Card */}
        <div className="st-panel space-y-4">
          <p className="sc-tiny">Billing & Plan Controls</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="billingEmail" className="sc-tiny">Billing Email</label>
              <input id="billingEmail" type="email" name="billingEmail" value={formData.billingEmail} onChange={handleChange} placeholder="billing@example.com" className="st-input" />
            </div>
            <div>
              <label htmlFor="plan" className="sc-tiny">Plan</label>
              <select id="plan" name="plan" value={formData.plan} onChange={handleChange} className="st-select">
                <option value="">-- Select Plan --</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="agency">Agency</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="timezone" className="sc-tiny">Timezone</label>
              <select id="timezone" name="timezone" value={formData.timezone} onChange={handleChange} className="st-select">
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
              <label htmlFor="currency" className="sc-tiny">Currency</label>
              <select id="currency" name="currency" value={formData.currency} onChange={handleChange} className="st-select">
                <option value="ZAR">ZAR (R)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="st-btn st-btn--primary">
            {saving ? 'Saving...' : 'Save platform record'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/organizations')}
            className="st-btn st-btn--secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

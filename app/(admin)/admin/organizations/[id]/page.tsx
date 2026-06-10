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
        <p className="text-on-surface-variant">Organisation not found.</p>
        <Link href="/admin/organizations" className="pib-btn-secondary mt-4 inline-block">Back to Organisations</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-xs text-on-surface-variant font-label uppercase tracking-wide">
        <Link href="/admin/organizations" className="hover:text-on-surface">Organisations</Link>
        <span className="mx-2">/</span>
        <span className="truncate">{org.name}</span>
      </div>

      {/* Heading */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-headline font-bold text-on-surface truncate">{org.name}</h1>
        {org.slug && (
          <Link
            href={`/admin/org/${org.slug}/dashboard`}
            className="pib-btn-secondary text-xs font-label shrink-0"
          >
            Open workspace ↗
          </Link>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Feedback */}
        {error && (
          <div className="pib-card !border-red-500/30 !bg-red-500/5 text-sm text-red-400">{error}</div>
        )}
        {success && (
          <div className="pib-card !border-green-500/30 !bg-green-500/5 text-sm text-green-400">Changes saved.</div>
        )}

        {/* Details Card */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Organisation Details</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="pib-label">Name *</label>
              <input id="name" type="text" name="name" required value={formData.name} onChange={handleChange} className="pib-input" />
            </div>
            <div>
              <label htmlFor="website" className="pib-label">Website</label>
              <input id="website" type="url" name="website" value={formData.website} onChange={handleChange} placeholder="https://" className="pib-input" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="status" className="pib-label">Status</label>
              <select id="status" name="status" value={formData.status} onChange={handleChange} className="pib-select">
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="churned">Churned</option>
              </select>
            </div>
            <div>
              <label htmlFor="industry" className="pib-label">Industry</label>
              <input id="industry" type="text" name="industry" value={formData.industry} onChange={handleChange} placeholder="e.g. Technology" className="pib-input" />
            </div>
          </div>

          <div>
            <label htmlFor="description" className="pib-label">Description</label>
            <textarea id="description" name="description" value={formData.description} onChange={handleChange} rows={3} className="pib-textarea" />
          </div>
        </div>

        {/* Billing & Plan Card */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Billing & Plan</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="billingEmail" className="pib-label">Billing Email</label>
              <input id="billingEmail" type="email" name="billingEmail" value={formData.billingEmail} onChange={handleChange} placeholder="billing@example.com" className="pib-input" />
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
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className="pib-btn-primary">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/organizations')}
            className="pib-btn-secondary"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

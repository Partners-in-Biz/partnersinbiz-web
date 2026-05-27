'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function NewClientPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    website: '',
    industry: '',
    description: '',
    billingEmail: '',
    plan: '',
    timezone: 'Africa/Johannesburg',
    currency: 'ZAR',
    agentName: '',
    provisionWorkspace: true,
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target
    if (type === 'checkbox') {
      setFormData(prev => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }))
      return
    }
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const name = formData.name.trim()
    if (!name) {
      setError('Organisation name is required before a client workspace can be created.')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/v1/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          website: formData.website,
          industry: formData.industry,
          description: formData.description,
          billingEmail: formData.billingEmail,
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

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Failed to create client')
        return
      }

      router.push('/admin/clients')
    } catch {
      setError('An error occurred while creating the client')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-xs text-on-surface-variant font-label uppercase tracking-wide">
        <Link href="/admin/clients" className="hover:text-on-surface">Clients</Link>
        <span className="mx-2">/</span>
        <span>New Client</span>
      </div>

      {/* Heading */}
      <h1 className="text-2xl font-headline font-bold text-on-surface">New Client</h1>

      {/* Form */}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Error message */}
        {error && (
          <div className="pib-card !border-red-500/30 !bg-red-500/5 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Company Details Card */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Company Details
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="name" className="pib-label">Organisation Name *</label>
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

        {/* Billing & Plan Card */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Billing & Plan
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="billingEmail" className="pib-label">Billing Email</label>
              <input id="billingEmail" type="email" name="billingEmail" value={formData.billingEmail} onChange={handleChange} placeholder="e.g. billing@acme.com" className="pib-input" />
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
        </div>

        {/* Cowork & Hermes Card */}
        <div className="pib-card space-y-4">
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Cowork & Hermes Setup
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
              <span className="block font-medium">Create full client workspace</span>
              <span className="block text-xs text-on-surface-variant">
                Creates the VPS Cowork folder, Obsidian agent domain, wiki/log/raw folders,
                project instructions, Hermes profile, SOUL.md, and global Cowork mapping.
              </span>
            </span>
          </label>

          <div>
            <label htmlFor="agentName" className="pib-label">Agent Name</label>
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
            {loading ? 'Creating...' : 'Create Client'}
          </button>
          <Link href="/admin/clients" className="pib-btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}

// app/(admin)/admin/crm/contacts/page.tsx
'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ContactForm } from '@/components/admin/crm/ContactForm'
import { useOrg } from '@/lib/contexts/OrgContext'

const STAGES = ['new','contacted','replied','demo','proposal','won','lost']
const TYPES = ['lead','prospect','client','churned']

interface Contact {
  id: string
  name: string
  email: string
  company: string
  type: string
  stage: string
  lastContactedAt: unknown
  tags: string[]
}

function StageBadge({ stage }: { stage: string }) {
  const win = ['won', 'demo', 'replied']
  const lost = ['lost']
  const color = lost.includes(stage)
    ? 'var(--color-error)'
    : win.includes(stage)
    ? '#4ade80'
    : 'var(--color-accent-v2)'
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full capitalize"
      style={{ background: `${color}20`, color }}
    >
      {stage}
    </span>
  )
}

function TypeBadge({ type }: { type: string }) {
  const color = type === 'client'
    ? '#4ade80'
    : type === 'churned'
    ? 'var(--color-error)'
    : 'var(--color-accent-v2)'
  return (
    <span
      className="text-[10px] font-label uppercase tracking-wide px-2 py-0.5 rounded-full capitalize"
      style={{ background: `${color}20`, color }}
    >
      {type}
    </span>
  )
}

export default function ContactsPage() {
  const { selectedOrgId, orgs } = useOrg()

  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [contactOrgId, setContactOrgId] = useState('')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [showNew, setShowNew] = useState(false)
  const activeOrgId = selectedOrgId || contactOrgId

  const fetchContacts = useCallback(async () => {
    if (!activeOrgId) {
      setContacts([])
      setLoading(false)
      return
    }
    setLoading(true)
    const params = new URLSearchParams()
    params.set('orgId', activeOrgId)
    if (search) params.set('search', search)
    if (stageFilter) params.set('stage', stageFilter)
    if (typeFilter) params.set('type', typeFilter)
    const res = await fetch(`/api/v1/crm/contacts?${params}`)
    const body = await res.json()
    setContacts(body.data ?? [])
    setLoading(false)
  }, [search, stageFilter, typeFilter, activeOrgId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchContacts()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchContacts])

  async function createContact(data: Record<string, unknown>) {
    if (!activeOrgId) throw new Error('Select a client workspace before creating a contact')
    const res = await fetch('/api/v1/crm/contacts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...data, orgId: activeOrgId }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error ?? 'Failed to create contact')
    }
    setShowNew(false)
    fetchContacts()
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-headline text-2xl font-bold tracking-tighter">Contacts</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-accent-v2)' }}>
            {contacts.length} total
          </p>
        </div>
        <button
          onClick={() => activeOrgId && setShowNew(true)}
          disabled={!activeOrgId}
          className="pib-btn-primary text-sm font-label disabled:cursor-not-allowed disabled:opacity-50"
        >
          + New Contact
        </button>
      </div>

      {!selectedOrgId && (
        <div className="pib-card mb-4 space-y-2">
          <label htmlFor="contactOrgId" className="pib-label">Client workspace</label>
          <select
            id="contactOrgId"
            value={contactOrgId}
            onChange={(e) => setContactOrgId(e.target.value)}
            className="pib-select max-w-md"
          >
            <option value="">Select workspace before adding or viewing contacts…</option>
            {orgs
              .filter((org) => org.type === 'client')
              .map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
          </select>
          <p className="text-xs text-on-surface-variant">
            Contacts are always scoped to one client organisation so leads, automations, and handoffs do not bleed across workspaces.
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          placeholder="Search name, email, company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pib-input flex-1"
        />
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="pib-input !w-auto"
        >
          <option value="">All stages</option>
          {STAGES.map((s) => <option key={s} value={s} className="bg-black">{s}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="pib-input !w-auto"
        >
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t} className="bg-black">{t}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 pib-skeleton" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="border border-outline-variant rounded-lg p-12 text-center">
          <p className="text-on-surface-variant mb-4">No contacts yet.</p>
          <button
            onClick={() => activeOrgId && setShowNew(true)}
            disabled={!activeOrgId}
            className="pib-btn-primary text-sm font-label disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add your first lead →
          </button>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-outline-variant text-left">
              {['Name', 'Email', 'Company', 'Type', 'Stage', 'Tags'].map((h) => (
                <th key={h} className="py-2 px-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c.id} className="border-b border-outline-variant hover:bg-surface-container transition-colors">
                <td className="py-2.5 px-3">
                  <Link href={`/admin/crm/contacts/${c.id}`} className="font-medium hover:underline" style={{ color: 'var(--color-accent-v2)' }}>
                    {c.name}
                  </Link>
                </td>
                <td className="py-2.5 px-3 text-on-surface-variant">{c.email}</td>
                <td className="py-2.5 px-3 text-on-surface-variant">{c.company || '—'}</td>
                <td className="py-2.5 px-3"><TypeBadge type={c.type} /></td>
                <td className="py-2.5 px-3"><StageBadge stage={c.stage} /></td>
                <td className="py-2.5 px-3 text-on-surface-variant text-xs">
                  {c.tags?.join(', ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* New Contact Slide-In */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setShowNew(false)} />
          <div className="w-96 bg-surface-container border-l border-outline-variant overflow-y-auto">
            <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between">
              <h2 className="font-headline text-base font-bold tracking-tight">New Contact</h2>
              <button onClick={() => setShowNew(false)} className="text-on-surface-variant hover:text-on-surface text-lg leading-none">✕</button>
            </div>
            <ContactForm onSave={createContact} onCancel={() => setShowNew(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

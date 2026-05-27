'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageTabs } from '@/components/ui/AppFoundation'

interface Contact {
  id: string
  name: string
  email: string
  company?: string
  stage: string
  type: string
  tags: string[]
}

interface Deal {
  id: string
  contactId: string
  title: string
  value: number
  currency: string
  stage: string
}

type Tab = 'contacts' | 'deals'

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`pib-skeleton ${className}`} />
}

const CONTACT_STAGES = ['new', 'contacted', 'replied', 'demo', 'proposal', 'won', 'lost']
const DEAL_STAGES = ['discovery', 'proposal', 'negotiation', 'won', 'lost']

function StageBadge({ stage }: { stage: string }) {
  const winStages = ['won', 'demo', 'replied']
  const lostStages = ['lost']
  const color = lostStages.includes(stage)
    ? 'var(--color-error)'
    : winStages.includes(stage)
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

export default function PipelinePage() {
  const [tab, setTab] = useState<Tab>('contacts')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/crm/contacts').then(r => r.json()),
      fetch('/api/v1/crm/deals').then(r => r.json()),
    ]).then(([cBody, dBody]) => {
      setContacts(cBody.data ?? [])
      setDeals(dBody.data ?? [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const stages = tab === 'contacts' ? CONTACT_STAGES : DEAL_STAGES

  const filteredContacts = contacts.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase()) || c.company?.toLowerCase().includes(search.toLowerCase())
    const matchStage = stageFilter === 'all' || c.stage === stageFilter
    return matchSearch && matchStage
  })

  const filteredDeals = deals.filter(d => {
    const matchSearch = !search || d.title.toLowerCase().includes(search.toLowerCase())
    const matchStage = stageFilter === 'all' || d.stage === stageFilter
    return matchSearch && matchStage
  })

  // Pipeline value
  const totalValue = deals.filter(d => d.stage !== 'lost').reduce((sum, d) => sum + (d.value || 0), 0)
  const wonValue = deals.filter(d => d.stage === 'won').reduce((sum, d) => sum + (d.value || 0), 0)

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface">Pipeline</h1>
          <p className="text-sm text-on-surface-variant mt-0.5">CRM — contacts and deals</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/crm/contacts" className="pib-btn-secondary text-sm font-label">
            + Contact
          </Link>
        </div>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="grid grid-cols-3 gap-4">
          <div className="pib-card">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Contacts</p>
            <p className="text-2xl font-headline font-bold" style={{ color: 'var(--color-accent-v2)' }}>{contacts.length}</p>
          </div>
          <div className="pib-card">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Pipeline Value</p>
            <p className="text-2xl font-headline font-bold text-on-surface">${totalValue.toLocaleString()}</p>
          </div>
          <div className="pib-card">
            <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant mb-1">Won</p>
            <p className="text-2xl font-headline font-bold text-on-surface">${wonValue.toLocaleString()}</p>
          </div>
        </div>
      )}

      <PageTabs
        ariaLabel="CRM pipeline type"
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab)
          setStageFilter('all')
        }}
        tabs={[
          { value: 'contacts', label: 'Contacts', badge: contacts.length },
          { value: 'deals', label: 'Deals', badge: deals.length },
        ]}
      />

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="text"
          placeholder={`Search ${tab}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 px-4 py-2 text-sm bg-[var(--color-card)] border border-[var(--color-card-border)] rounded-[var(--radius-btn)] text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-[var(--color-accent-v2)] transition-colors"
        />
        {['all', ...stages].map(s => (
          <button
            key={s}
            onClick={() => setStageFilter(s)}
            className={[
              'text-xs font-label px-3 py-1.5 rounded-[var(--radius-btn)] transition-colors capitalize',
              stageFilter === s
                ? 'text-black font-medium'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container',
            ].join(' ')}
            style={stageFilter === s ? { background: 'var(--color-accent-v2)' } : {}}
          >
            {s === 'all' ? 'All' : s}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="pib-card overflow-hidden !p-0">
        {tab === 'contacts' ? (
          <>
            <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-card-border)]">
              <p className="col-span-4 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Name</p>
              <p className="col-span-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Company</p>
              <p className="col-span-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Stage</p>
              <p className="col-span-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Tags</p>
            </div>
            {loading ? (
              <div className="divide-y divide-[var(--color-card-border)]">
                {Array.from({ length: 6 }).map((_, i) => <div key={i} className="px-5 py-4"><Skeleton className="h-5 w-48" /></div>)}
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="py-10 text-center"><p className="text-on-surface-variant text-sm">No contacts found.</p></div>
            ) : (
              <div className="divide-y divide-[var(--color-card-border)]">
                {filteredContacts.map(c => (
                  <Link
                    key={c.id}
                    href={`/admin/crm/contacts/${c.id}`}
                    className="grid grid-cols-12 gap-4 items-center px-5 py-3 hover:bg-[var(--color-row-hover)] transition-colors"
                  >
                    <div className="col-span-4 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{c.name}</p>
                      <p className="text-xs text-on-surface-variant truncate">{c.email}</p>
                    </div>
                    <div className="col-span-3 min-w-0">
                      <p className="text-sm text-on-surface-variant truncate">{c.company || '—'}</p>
                    </div>
                    <div className="col-span-2"><StageBadge stage={c.stage} /></div>
                    <div className="col-span-3 flex gap-1 flex-wrap">
                      {c.tags?.slice(0, 2).map(t => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant">{t}</span>
                      ))}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-12 gap-4 px-5 py-3 border-b border-[var(--color-card-border)]">
              <p className="col-span-5 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Deal</p>
              <p className="col-span-3 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Value</p>
              <p className="col-span-4 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Stage</p>
            </div>
            {loading ? (
              <div className="divide-y divide-[var(--color-card-border)]">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="px-5 py-4"><Skeleton className="h-5 w-48" /></div>)}
              </div>
            ) : filteredDeals.length === 0 ? (
              <div className="py-10 text-center"><p className="text-on-surface-variant text-sm">No deals found.</p></div>
            ) : (
              <div className="divide-y divide-[var(--color-card-border)]">
                {filteredDeals.map(d => (
                  <div key={d.id} className="grid grid-cols-12 gap-4 items-center px-5 py-3 hover:bg-[var(--color-row-hover)] transition-colors">
                    <div className="col-span-5 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{d.title}</p>
                    </div>
                    <div className="col-span-3">
                      <p className="text-sm font-medium text-on-surface">${(d.value || 0).toLocaleString()} <span className="text-xs text-on-surface-variant">{d.currency}</span></p>
                    </div>
                    <div className="col-span-4"><StageBadge stage={d.stage} /></div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import { formatZar, formatDate, tsToMillis } from '@/lib/billing/format'
import {
  Button,
  ButtonLink,
  Choice,
  DataItem,
  DataList,
  Field,
  Input,
  Notice,
  Panel,
  Select,
  Skeleton,
  Status,
  Table,
  THead,
  TR,
  TH,
  TD,
  Textarea,
  Title,
  Toolbar,
} from '@/components/studio'

type PartnerStatus = 'pending' | 'approved' | 'rejected' | 'suspended'

interface PartnerApplication {
  id: string
  companyName: string
  contactName: string
  email: string
  phone?: string
  website?: string
  pitch?: string
  expectedVolume?: string
  status: PartnerStatus
  commissionPercent?: number
  payoutMethod?: 'eft' | 'paypal'
  rejectionReason?: string | null
  referralsCount?: number
  totalCommissionZar?: number
  createdAt?: unknown
  reviewedAt?: unknown
}

interface Summary {
  pendingCount: number
  approvedCount: number
  totalCommissionZar: number
  avgCommissionPercent: number
}

const STATUS_FILTERS: Array<{ key: PartnerStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'rejected', label: 'Rejected' },
]

function statusTone(status: PartnerStatus): 'warning' | 'success' | 'danger' | 'info' {
  if (status === 'pending') return 'warning'
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'info'
}

export default function AdminPartnersPage() {
  const [applications, setApplications] = useState<PartnerApplication[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [defaultCommission, setDefaultCommission] = useState(20)
  const [loading, setLoading] = useState(true)
  const [topError, setTopError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<PartnerStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [commissionInput, setCommissionInput] = useState('')
  const [payoutMethod, setPayoutMethod] = useState<'eft' | 'paypal'>('eft')
  const [rejectionReason, setRejectionReason] = useState('')
  const [panelError, setPanelError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [form, setForm] = useState({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    expectedVolume: '',
    pitch: '',
  })

  async function load() {
    setLoading(true)
    setTopError(null)
    try {
      const res = await fetch('/api/v1/admin/partners')
      const body = await res.json()
      if (!res.ok) {
        setTopError(body?.error ?? 'Failed to load partners')
        setApplications([])
        setSummary(null)
      } else {
        const data = body.data ?? body
        setApplications(data.applications ?? [])
        setSummary(data.summary ?? null)
        if (typeof data.defaultCommissionPercent === 'number') {
          setDefaultCommission(data.defaultCommissionPercent)
        }
      }
    } catch (err) {
      setTopError(err instanceof Error ? err.message : 'Failed to load partners')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const selected = useMemo(
    () => applications.find((a) => a.id === selectedId) ?? null,
    [applications, selectedId],
  )

  useEffect(() => {
    if (!selected) return
    setCommissionInput(
      typeof selected.commissionPercent === 'number'
        ? String(selected.commissionPercent)
        : String(defaultCommission),
    )
    setPayoutMethod(selected.payoutMethod ?? 'eft')
    setRejectionReason('')
    setPanelError(null)
  }, [selectedId, selected, defaultCommission])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return applications.filter((a) => {
      if (filter !== 'all' && a.status !== filter) return false
      if (!q) return true
      return [a.companyName, a.contactName, a.email, a.expectedVolume]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [applications, filter, search])

  const activePartners = useMemo(
    () => applications.filter((a) => a.status === 'approved'),
    [applications],
  )

  async function runAction(action: 'approve' | 'reject' | 'suspend') {
    if (!selected) return
    setPanelError(null)
    setNotice(null)

    const payload: Record<string, unknown> = { action }
    if (action === 'approve') {
      const commissionPercent = Number(commissionInput)
      if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
        setPanelError('Commission must be between 0 and 100')
        return
      }
      payload.commissionPercent = commissionPercent
      payload.payoutMethod = payoutMethod
    }
    if (action === 'reject') {
      if (!rejectionReason.trim()) {
        setPanelError('A rejection reason is required')
        return
      }
      payload.rejectionReason = rejectionReason.trim()
    }

    setBusy(true)
    try {
      const res = await fetch(`/api/v1/admin/partners/${selected.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json()
      if (!res.ok) {
        setPanelError(body?.error ?? `Failed to ${action} partner`)
        return
      }
      const data = body.data ?? body
      const emailNote =
        data.emailStatus === 'queued'
          ? ' (email queued - provider not configured)'
          : data.emailStatus === 'sent'
            ? ' and applicant emailed'
            : ''
      setNotice(`${selected.companyName} ${action}d${emailNote}.`)
      await load()
    } catch (err) {
      setPanelError(err instanceof Error ? err.message : `Failed to ${action} partner`)
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setNotice(null)
    if (!form.companyName.trim() || !form.contactName.trim() || !form.email.trim()) {
      setCreateError('Company, contact and email are required')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/v1/admin/partners', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName.trim(),
          contactName: form.contactName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim() || undefined,
          website: form.website.trim() || undefined,
          expectedVolume: form.expectedVolume.trim() || undefined,
          pitch: form.pitch.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setCreateError(body?.error ?? 'Failed to add applicant')
        return
      }
      setNotice(`Applicant ${form.companyName.trim()} added.`)
      setForm({
        companyName: '',
        contactName: '',
        email: '',
        phone: '',
        website: '',
        expectedVolume: '',
        pitch: '',
      })
      setShowCreate(false)
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to add applicant')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHeader
        eyebrow="Billing / Partner programme"
        title="Partners."
        description="Review partner applications, set commission rates, and track referral payouts. Payouts settle offline via EFT / PayPal."
        actions={
          <>
            <Button type="button" onClick={() => setShowCreate((v) => !v)}>
              {showCreate ? 'Cancel' : 'New applicant'}
            </Button>
            <ButtonLink href="/api/v1/admin/partners/export" variant="ghost">
              Export CSV
            </ButtonLink>
          </>
        }
      />

      {topError ? <Notice tone="danger">{topError}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {showCreate ? (
        <Panel>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field id="partner-company" label="Company">
                <Input aria-label="Company" id="partner-company"
                  value={form.companyName}
                  onChange={(e) => setForm((prev) => ({ ...prev, companyName: e.target.value }))}
                  placeholder="Acme Agency"
                  required
                />
              </Field>
              <Field id="partner-contact" label="Contact">
                <Input aria-label="Contact" id="partner-contact"
                  value={form.contactName}
                  onChange={(e) => setForm((prev) => ({ ...prev, contactName: e.target.value }))}
                  placeholder="Jane Doe"
                  required
                />
              </Field>
              <Field id="partner-email" label="Email">
                <Input aria-label="Email" id="partner-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="jane@acme.co.za"
                  required
                />
              </Field>
              <Field id="partner-phone" label="Phone">
                <Input aria-label="Phone" id="partner-phone"
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  placeholder="+27 ..."
                />
              </Field>
              <Field id="partner-website" label="Website">
                <Input aria-label="Website" id="partner-website"
                  value={form.website}
                  onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                  placeholder="https://acme.co.za"
                />
              </Field>
              <Field id="partner-volume" label="Expected volume">
                <Input aria-label="Expected volume" id="partner-volume"
                  value={form.expectedVolume}
                  onChange={(e) => setForm((prev) => ({ ...prev, expectedVolume: e.target.value }))}
                  placeholder="e.g. 5-10 referrals / month"
                />
              </Field>
              <div className="md:col-span-2">
                <Field id="partner-pitch" label="Pitch">
                  <Textarea aria-label="Pitch" id="partner-pitch"
                    value={form.pitch}
                    onChange={(e) => setForm((prev) => ({ ...prev, pitch: e.target.value }))}
                    placeholder="Audience, channels, why they want to partner..."
                    rows={3}
                  />
                </Field>
              </div>
            </div>
            {createError ? <Notice tone="danger">{createError}</Notice> : null}
            <Toolbar>
              <Button type="submit" disabled={creating}>
                {creating ? 'Adding...' : 'Add applicant'}
              </Button>
            </Toolbar>
          </form>
        </Panel>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading || !summary ? (
          <>
            <Skeleton height="5rem" />
            <Skeleton height="5rem" />
            <Skeleton height="5rem" />
            <Skeleton height="5rem" />
          </>
        ) : (
          <>
            <Panel>
              <p className="sc-tiny">Pending</p>
              <p className="st-num mt-1 text-[1.75rem] leading-none text-[var(--sc-ink)]">{summary.pendingCount}</p>
            </Panel>
            <Panel>
              <p className="sc-tiny">Active partners</p>
              <p className="st-num mt-1 text-[1.75rem] leading-none text-[var(--sc-ink)]">{summary.approvedCount}</p>
            </Panel>
            <Panel>
              <p className="sc-tiny">Total commission</p>
              <p className="st-num mt-1 text-[1.75rem] leading-none text-[var(--sc-ink)]">
                {formatZar(summary.totalCommissionZar)}
              </p>
            </Panel>
            <Panel>
              <p className="sc-tiny">Avg commission</p>
              <p className="st-num mt-1 text-[1.75rem] leading-none text-[var(--sc-ink)]">
                {summary.avgCommissionPercent}%
              </p>
            </Panel>
          </>
        )}
      </div>

      <Toolbar>
        {STATUS_FILTERS.map((f) => (
          <Choice key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </Choice>
        ))}
        <Input
          type="search"
          placeholder="Search company, contact, email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search partners"
          className="md:ml-auto md:w-72"
        />
      </Toolbar>

      {loading ? (
        <div className="space-y-2">
          <Skeleton height="5rem" />
          <Skeleton height="5rem" />
          <Skeleton height="5rem" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={applications.length === 0 ? 'No partner applications yet.' : 'No matches for this filter.'}
          description="Adjust filters or add a new applicant."
        />
      ) : (
        <ul className="space-y-4">
          {filtered.map((a) => {
            const isSelected = a.id === selectedId
            return (
              <li key={a.id}>
                <Panel>
                  <button type="button" onClick={() => setSelectedId(isSelected ? null : a.id)} className="w-full text-left">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="sc-body truncate text-[var(--sc-ink)]">{a.companyName}</p>
                          <Status tone={statusTone(a.status)}>{a.status}</Status>
                        </div>
                        <p className="sc-tiny mt-1 truncate">
                          {a.contactName} · {a.email}
                        </p>
                        {a.expectedVolume ? (
                          <p className="sc-tiny mt-1">Expected volume: {a.expectedVolume}</p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        {a.status === 'approved' ? (
                          <p className="st-num sc-tiny">{a.commissionPercent}% commission</p>
                        ) : null}
                        <p className="sc-tiny">Applied {formatDate(tsToMillis(a.createdAt))}</p>
                      </div>
                    </div>
                  </button>

                  {isSelected && selected ? (
                    <div className="mt-4 space-y-4 border-t border-[var(--sc-line)] pt-4">
                      <DataList>
                        {selected.phone ? <DataItem label="Phone">{selected.phone}</DataItem> : null}
                        {selected.website ? <DataItem label="Website">{selected.website}</DataItem> : null}
                        {selected.pitch ? <DataItem label="Pitch">{selected.pitch}</DataItem> : null}
                        {selected.status === 'rejected' && selected.rejectionReason ? (
                          <DataItem label="Rejection reason">
                            <span className="text-[var(--st-danger)]">{selected.rejectionReason}</span>
                          </DataItem>
                        ) : null}
                      </DataList>

                      {panelError ? <Notice tone="danger">{panelError}</Notice> : null}

                      {(selected.status === 'pending' || selected.status === 'suspended') ? (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field id="partner-commission" label="Commission %">
                              <Input aria-label="Commission %" id="partner-commission"
                                type="number"
                                min={0}
                                max={100}
                                step="0.5"
                                value={commissionInput}
                                onChange={(e) => setCommissionInput(e.target.value)}
                                className="st-num"
                              />
                            </Field>
                            <Field id="partner-payout" label="Payout method">
                              <Select aria-label="Payout method" id="partner-payout"
                                value={payoutMethod}
                                onChange={(e) => setPayoutMethod(e.target.value as 'eft' | 'paypal')}
                              >
                                <option value="eft">EFT</option>
                                <option value="paypal">PayPal</option>
                              </Select>
                            </Field>
                          </div>
                          <Button type="button" disabled={busy} onClick={() => runAction('approve')}>
                            {busy ? 'Working...' : 'Approve'}
                          </Button>
                        </div>
                      ) : null}

                      {selected.status === 'approved' ? (
                        <Button type="button" variant="secondary" disabled={busy} onClick={() => runAction('suspend')}>
                          {busy ? 'Working...' : 'Suspend'}
                        </Button>
                      ) : null}

                      {selected.status !== 'rejected' ? (
                        <div className="space-y-2">
                          <Field id="partner-reject" label="Rejection reason">
                            <Input aria-label="Rejection reason" id="partner-reject"
                              value={rejectionReason}
                              onChange={(e) => setRejectionReason(e.target.value)}
                              placeholder="Why this application is declined"
                            />
                          </Field>
                          <Button type="button" variant="danger" disabled={busy} onClick={() => runAction('reject')}>
                            {busy ? 'Working...' : 'Reject'}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </Panel>
              </li>
            )
          })}
        </ul>
      )}

      {!loading && activePartners.length > 0 ? (
        <div className="space-y-4">
          <Title as="h2">Active partners.</Title>
          <Panel className="overflow-x-auto p-0">
            <Table>
              <THead>
                <TR>
                  <TH>Company</TH>
                  <TH>Commission</TH>
                  <TH className="text-right">Referrals</TH>
                  <TH className="text-right">Total commission</TH>
                </TR>
              </THead>
              <tbody>
                {activePartners.map((a) => (
                  <TR key={a.id}>
                    <TD>{a.companyName}</TD>
                    <TD className="st-num">{a.commissionPercent}%</TD>
                    <TD className="st-num text-right">{a.referralsCount ?? 0}</TD>
                    <TD className="st-num text-right">{formatZar(a.totalCommissionZar ?? 0)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Panel>
        </div>
      ) : null}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EmptyState, PageHeader, PageTabs } from '@/components/ui/AppFoundation'
import {
  ButtonLink,
  Panel,
  Skeleton,
  Status,
  Table,
  THead,
  TR,
  TH,
  TD,
  Toolbar,
} from '@/components/studio'

type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired' | 'converted'

interface Quote {
  id: string
  quoteNumber: string
  orgId: string
  status: QuoteStatus
  total: number
  currency: string
  issueDate?: DateLike
  validUntil?: DateLike
  convertedInvoiceId?: string
}

type DateLike = string | number | Date | { _seconds?: number; seconds?: number } | null | undefined

const STATUS_TONE: Record<QuoteStatus, 'info' | 'success' | 'danger' | 'warning' | undefined> = {
  draft: undefined,
  sent: 'info',
  accepted: 'success',
  declined: 'danger',
  expired: 'warning',
  converted: 'success',
}

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  converted: 'Converted',
}

function formatCurrency(amount: number, currency: string) {
  const locales: Record<string, string> = { USD: 'en-US', EUR: 'de-DE', ZAR: 'en-ZA' }
  return new Intl.NumberFormat(locales[currency] || 'en-US', { style: 'currency', currency }).format(amount)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function formatDate(ts: DateLike) {
  if (!ts) return '-'
  const seconds = isRecord(ts) && typeof ts._seconds === 'number'
    ? ts._seconds
    : isRecord(ts) && typeof ts.seconds === 'number'
      ? ts.seconds
      : null
  const d = seconds ? new Date(seconds * 1000) : new Date(ts as string | number | Date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function extractQuotes(body: unknown): Quote[] {
  const data = isRecord(body) ? body.data : undefined
  if (Array.isArray(data)) return data
  if (isRecord(data) && Array.isArray(data.quotes)) return data.quotes as Quote[]
  return []
}

function extractOrgs(body: unknown): Array<{ id: string; name: string }> {
  const data = isRecord(body) ? body.data : undefined
  if (Array.isArray(data)) return data
  if (isRecord(data) && Array.isArray(data.organizations)) return data.organizations as Array<{ id: string; name: string }>
  if (isRecord(data) && Array.isArray(data.orgs)) return data.orgs as Array<{ id: string; name: string }>
  return []
}

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [orgMap, setOrgMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<QuoteStatus | 'all'>('all')

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/quotes').then(r => r.json()),
      fetch('/api/v1/organizations').then(r => r.json()),
    ]).then(([quotesBody, orgsBody]) => {
      setQuotes(extractQuotes(quotesBody))
      const map: Record<string, string> = {}
      for (const org of extractOrgs(orgsBody)) map[org.id] = org.name
      setOrgMap(map)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = filter === 'all' ? quotes : quotes.filter(q => q.status === filter)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <PageHeader
        eyebrow="CRM"
        title="Quotes."
        description={loading ? 'Loading quotes.' : `${quotes.length} quotes in this workspace.`}
        actions={
          <ButtonLink href="/portal/quotes/new" size="sm">
            New quote
          </ButtonLink>
        }
      />

      <Toolbar>
        <PageTabs
          ariaLabel="Quote status filter"
          tabs={[
            { value: 'all', label: `All (${quotes.length})` },
            { value: 'draft', label: `Draft (${quotes.filter(q => q.status === 'draft').length})` },
            { value: 'sent', label: `Sent (${quotes.filter(q => q.status === 'sent').length})` },
            { value: 'accepted', label: `Accepted (${quotes.filter(q => q.status === 'accepted').length})` },
            { value: 'declined', label: `Declined (${quotes.filter(q => q.status === 'declined').length})` },
            { value: 'converted', label: `Converted (${quotes.filter(q => q.status === 'converted').length})` },
          ]}
          value={filter}
          onValueChange={(id) => setFilter(id as QuoteStatus | 'all')}
        />
      </Toolbar>

      {loading ? (
        <Panel flat className="space-y-4 p-5">
          <Skeleton height={20} width="12rem" />
          <Skeleton height={20} width="100%" />
          <Skeleton height={20} width="80%" />
        </Panel>
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No quotes found."
          description="Create a quote to send pricing to a client."
          action={<ButtonLink href="/portal/quotes/new" variant="secondary" size="sm">Create quote</ButtonLink>}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Client</TH>
                  <TH>Status</TH>
                  <TH>Amount</TH>
                  <TH>Valid until</TH>
                  <TH><span className="sr-only">Actions</span></TH>
                </TR>
              </THead>
              <tbody>
                {filtered.map((q) => (
                  <TR key={q.id}>
                    <TD><span className="st-num">{q.quoteNumber}</span></TD>
                    <TD>{orgMap[q.orgId] ?? q.orgId}</TD>
                    <TD>
                      <Status tone={STATUS_TONE[q.status]}>
                        {STATUS_LABEL[q.status] ?? q.status}
                      </Status>
                    </TD>
                    <TD>
                      <span className="st-num">{formatCurrency(q.total ?? 0, q.currency ?? 'USD')}</span>
                    </TD>
                    <TD>{formatDate(q.validUntil)}</TD>
                    <TD>
                      <Link href={`/portal/quotes/${q.id}`} className="sc-tiny">View</Link>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="flex flex-col gap-4 md:hidden">
            {filtered.map((q) => (
              <Panel flat key={q.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="st-num" style={{ color: 'var(--sc-ink)' }}>{q.quoteNumber}</p>
                    <p className="sc-body mt-1">{orgMap[q.orgId] ?? q.orgId}</p>
                  </div>
                  <Status tone={STATUS_TONE[q.status]}>
                    {STATUS_LABEL[q.status] ?? q.status}
                  </Status>
                </div>
                <p className="st-num mt-4">{formatCurrency(q.total ?? 0, q.currency ?? 'USD')}</p>
                <p className="sc-tiny mt-2">Valid until {formatDate(q.validUntil)}</p>
                <Link href={`/portal/quotes/${q.id}`} className="sc-tiny mt-4 inline-block">View</Link>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

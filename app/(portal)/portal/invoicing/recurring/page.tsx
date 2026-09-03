'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { EmptyState, PageHeader, PageTabs } from '@/components/ui/AppFoundation'
import {
  Button,
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
import { INTERVAL_LABELS, RecurrenceInterval } from '@/lib/invoices/recurring'

interface Schedule {
  id: string
  invoiceId: string
  orgId: string
  interval: RecurrenceInterval
  startDate: unknown
  endDate: unknown
  nextDueAt: unknown
  status: 'active' | 'paused' | 'cancelled' | 'completed'
  invoiceNumber?: string
}

type StatusTone = 'success' | 'warning' | 'danger' | 'info' | undefined

function formatDate(ts: unknown) {
  if (!ts) return '-'
  const candidate = ts as { _seconds?: number; seconds?: number }
  const d = candidate._seconds
    ? new Date(candidate._seconds * 1000)
    : candidate.seconds
      ? new Date(candidate.seconds * 1000)
      : new Date(ts as string)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'success',
  paused: 'warning',
  cancelled: undefined,
  completed: 'info',
}

export default function RecurringSchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'active' | 'all'>('active')
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/v1/recurring-schedules?status=${filter}`)
      .then(r => r.json())
      .then(body => { setSchedules(body.data ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [filter])

  async function updateScheduleStatus(id: string, status: 'active' | 'paused' | 'cancelled') {
    setUpdating(id)
    const res = await fetch(`/api/v1/recurring-schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setSchedules(prev => prev.map(s => s.id === id ? { ...s, status } : s))
    }
    setUpdating(null)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <PageHeader
        eyebrow="Invoicing"
        title="Recurring schedules."
        description="Manage repeating invoice schedules and next-due dates."
        actions={
          <ButtonLink href="/portal/invoicing" variant="ghost" size="sm">
            Back to invoicing
          </ButtonLink>
        }
      />

      <Toolbar>
        <PageTabs
          ariaLabel="Schedule filter"
          tabs={[
            { value: 'active', label: 'Active' },
            { value: 'all', label: 'All' },
          ]}
          value={filter}
          onValueChange={(id) => setFilter(id as 'active' | 'all')}
        />
      </Toolbar>

      {loading ? (
        <Panel flat className="space-y-4 p-5">
          <Skeleton height={20} width="12rem" />
          <Skeleton height={20} width="100%" />
          <Skeleton height={20} width="80%" />
        </Panel>
      ) : schedules.length === 0 ? (
        <EmptyState
          title="No recurring schedules found."
          description="Set up recurring billing from an invoice detail page."
          action={<ButtonLink href="/portal/invoicing" variant="secondary" size="sm">Open invoicing</ButtonLink>}
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Invoice</TH>
                  <TH>Status</TH>
                  <TH>Interval</TH>
                  <TH>Next due</TH>
                  <TH><span className="sr-only">Actions</span></TH>
                </TR>
              </THead>
              <tbody>
                {schedules.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <Link href={`/portal/invoicing/${s.invoiceId}`} className="sc-tiny">
                        {s.invoiceNumber ?? 'View invoice'}
                      </Link>
                    </TD>
                    <TD>
                      <Status tone={STATUS_TONE[s.status]}>{s.status}</Status>
                    </TD>
                    <TD>{INTERVAL_LABELS[s.interval] ?? s.interval}</TD>
                    <TD>{formatDate(s.nextDueAt)}</TD>
                    <TD>
                      <div className="flex flex-wrap justify-end gap-2">
                        {s.status === 'active' ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => updateScheduleStatus(s.id, 'paused')}
                            disabled={updating === s.id}
                          >
                            Pause
                          </Button>
                        ) : null}
                        {s.status === 'paused' ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => updateScheduleStatus(s.id, 'active')}
                            disabled={updating === s.id}
                          >
                            Resume
                          </Button>
                        ) : null}
                        {(s.status === 'active' || s.status === 'paused') ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateScheduleStatus(s.id, 'cancelled')}
                            disabled={updating === s.id}
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>

          <div className="flex flex-col gap-4 md:hidden">
            {schedules.map((s) => (
              <Panel flat key={s.id} className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Link href={`/portal/invoicing/${s.invoiceId}`} className="sc-tiny">
                      {s.invoiceNumber ?? 'View invoice'}
                    </Link>
                    <p className="sc-body mt-1">{INTERVAL_LABELS[s.interval] ?? s.interval}</p>
                  </div>
                  <Status tone={STATUS_TONE[s.status]}>{s.status}</Status>
                </div>
                <p className="sc-tiny">Next due {formatDate(s.nextDueAt)}</p>
                <div className="flex flex-wrap gap-2">
                  {s.status === 'active' ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => updateScheduleStatus(s.id, 'paused')} disabled={updating === s.id}>
                      Pause
                    </Button>
                  ) : null}
                  {s.status === 'paused' ? (
                    <Button type="button" size="sm" onClick={() => updateScheduleStatus(s.id, 'active')} disabled={updating === s.id}>
                      Resume
                    </Button>
                  ) : null}
                  {(s.status === 'active' || s.status === 'paused') ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => updateScheduleStatus(s.id, 'cancelled')} disabled={updating === s.id}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

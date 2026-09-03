'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { EmptyState, PageHeader } from '@/components/ui/AppFoundation'
import {
  Button,
  Field,
  Icon,
  Input,
  Notice,
  Panel,
  Select,
  Skeleton,
  Status,
  Table,
  TD,
  TH,
  THead,
  TR,
  Toolbar,
} from '@/components/studio'

type Severity = 'info' | 'warning' | 'error' | 'critical'

interface ErrorEvent {
  id: string
  message: string
  stack: string | null
  severity: Severity
  orgId: string | null
  source: string
  route: string | null
  resolvedAt: number | null
  assignedTo: string | null
  createdAt: number | null
}

const SEVERITY_TONE: Record<Severity, 'info' | 'warning' | 'danger'> = {
  info: 'info',
  warning: 'warning',
  error: 'danger',
  critical: 'danger',
}

function fmtTime(ms: number | null): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleString()
}

export default function LogsClient() {
  const [events, setEvents] = useState<ErrorEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [empty, setEmpty] = useState(false)
  const [sentryUrl, setSentryUrl] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const [severity, setSeverity] = useState('')
  const [orgId, setOrgId] = useState('')
  const [resolved, setResolved] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (severity) params.set('severity', severity)
    if (orgId) params.set('orgId', orgId)
    if (resolved) params.set('resolved', resolved)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    try {
      const res = await fetch(`/api/v1/admin/system/logs?${params.toString()}`)
      const body = await res.json()
      const data = body.data ?? body
      if (!res.ok) {
        setError(body?.error ?? 'Failed to load logs')
        return
      }
      setEvents(data.events ?? [])
      setEmpty(Boolean(data.empty))
      setSentryUrl(data.sentryConfigured ? data.sentryUrl : null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load logs')
    } finally {
      setLoading(false)
    }
  }, [severity, orgId, resolved, from, to])

  useEffect(() => {
    load()
    fetch('/api/auth/verify')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setIsSuperAdmin(Boolean(s?.isSuperAdmin)))
      .catch(() => setIsSuperAdmin(false))
  }, [load])

  async function patch(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/v1/admin/system/logs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) load()
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        eyebrow="System"
        title="Error logs."
        description="Captured error events from the error_events collection. Resolve and assign to track follow-up."
        actions={(
          <Toolbar>
            {sentryUrl ? (
              <a
                href={sentryUrl}
                target="_blank"
                rel="noreferrer"
                className="st-btn st-btn--ghost st-btn--sm"
              >
                <Icon name="open_in_new" />
                View in Sentry
              </a>
            ) : null}
            <Button variant="ghost" size="sm" onClick={load} aria-label="Refresh logs">
              <Icon name="refresh" />
              Refresh
            </Button>
          </Toolbar>
        )}
      />

      <Panel flat className="!p-4">
        <Toolbar className="flex-wrap items-end">
          <Field id="logs-severity" label="Severity">
            <Select id="logs-severity" aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">All</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="critical">Critical</option>
            </Select>
          </Field>
          <Field id="logs-resolved" label="Status">
            <Select id="logs-resolved" aria-label="Resolution status" value={resolved} onChange={(e) => setResolved(e.target.value)}>
              <option value="">All</option>
              <option value="false">Unresolved</option>
              <option value="true">Resolved</option>
            </Select>
          </Field>
          <Field id="logs-org" label="Org ID">
            <Input
              id="logs-org"
              aria-label="Organisation ID"
              className="w-40 font-mono"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="any"
            />
          </Field>
          <Field id="logs-from" label="From">
            <Input id="logs-from" aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field id="logs-to" label="To">
            <Input id="logs-to" aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button size="sm" onClick={load}>Apply</Button>
        </Toolbar>
      </Panel>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height="3rem" />)}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          title={empty ? 'No error events recorded yet.' : 'No events match these filters.'}
          description="Events appear here as logErrorEvent() writes them."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Severity</TH>
              <TH>Message</TH>
              <TH className="hidden md:table-cell" data-impeccable-disable="content-invisible-at-rest">Source / Route</TH>
              <TH className="hidden lg:table-cell" data-impeccable-disable="content-invisible-at-rest">Org</TH>
              <TH>When</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <tbody>
            {events.map((ev) => (
              <Fragment key={ev.id}>
                <tr
                  className="cursor-pointer"
                  onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                >
                  <TD>
                    <div className="flex flex-wrap gap-2">
                      <Status tone={SEVERITY_TONE[ev.severity]}>{ev.severity}</Status>
                      {ev.resolvedAt ? <Status tone="success">resolved</Status> : null}
                    </div>
                  </TD>
                  <TD className="max-w-xs truncate text-[var(--sc-ink)]">{ev.message}</TD>
                  <TD className="hidden md:table-cell text-[var(--sc-ink-soft)] text-xs" data-impeccable-disable="content-invisible-at-rest">
                    <div className="font-mono">{ev.source}</div>
                    {ev.route ? <div className="font-mono opacity-70">{ev.route}</div> : null}
                  </TD>
                  <TD className="hidden lg:table-cell font-mono text-xs text-[var(--sc-ink-soft)]" data-impeccable-disable="content-invisible-at-rest">
                    {ev.orgId ?? '-'}
                  </TD>
                  <TD className="st-num text-xs whitespace-nowrap text-[var(--sc-ink-soft)]">{fmtTime(ev.createdAt)}</TD>
                  <TD className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {isSuperAdmin ? (
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => patch(ev.id, { action: ev.resolvedAt ? 'unresolve' : 'resolve' })}
                        >
                          {ev.resolvedAt ? 'Reopen' : 'Resolve'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const uid = window.prompt('Assign to uid (blank to unassign):', ev.assignedTo ?? '')
                            if (uid !== null) patch(ev.id, { action: 'assign', assignedTo: uid || null })
                          }}
                        >
                          {ev.assignedTo ? 'Reassign' : 'Assign'}
                        </Button>
                      </div>
                    ) : (
                      <span className="sc-tiny font-mono">{ev.assignedTo ? ev.assignedTo : '-'}</span>
                    )}
                  </TD>
                </tr>
                {expanded === ev.id ? (
                  <TR>
                    <TD colSpan={6}>
                      {ev.assignedTo ? (
                        <p className="sc-tiny mb-2">Assigned to: <span className="font-mono">{ev.assignedTo}</span></p>
                      ) : null}
                      {ev.stack ? (
                        <pre className="text-xs font-mono text-[var(--sc-ink-soft)] whitespace-pre-wrap overflow-x-auto max-h-64">
                          {ev.stack}
                        </pre>
                      ) : (
                        <p className="sc-body text-[0.875rem]">No stack trace captured for this event.</p>
                      )}
                    </TD>
                  </TR>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

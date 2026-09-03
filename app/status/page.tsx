'use client'

import { useEffect, useMemo, useState } from 'react'
import { ButtonLink, Notice, Panel, Status } from '@/components/studio'

type ServiceStatus = 'ok' | 'degraded' | 'down' | 'not-configured'

type PublicStatus = {
  overall: 'ok' | 'degraded' | 'down'
  checkedAt: string
  services: Array<{
    key: string
    name: string
    status: ServiceStatus
    latencyMs: number | null
    latencyInstrumented: boolean
  }>
}

function formatLatency(latencyMs: number | null) {
  if (latencyMs == null) return 'Not instrumented'
  if (latencyMs >= 1000) return `${(latencyMs / 1000).toFixed(1)}s`
  return `${latencyMs}ms`
}

function statusTone(status: ServiceStatus | 'ok' | 'degraded' | 'down'): 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'ok') return 'success'
  if (status === 'degraded') return 'warning'
  if (status === 'down') return 'danger'
  return 'info'
}

function statusLabel(status: ServiceStatus | 'ok' | 'degraded' | 'down') {
  if (status === 'ok') return 'Operational'
  if (status === 'degraded') return 'Degraded'
  if (status === 'down') return 'Down'
  return 'Not configured'
}

export default function StatusPage() {
  const [status, setStatus] = useState<PublicStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/status')
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to load status')
        return response.json()
      })
      .then((body) => {
        if (cancelled) return
        setStatus((body?.data ?? null) as PublicStatus | null)
        setError(null)
      })
      .catch(() => {
        if (cancelled) return
        setStatus(null)
        setError('Status is unavailable right now.')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const headline = useMemo(() => {
    if (!status) return 'Checking.'
    if (status.overall === 'ok') return 'Operational.'
    return 'Investigating.'
  }, [status])

  return (
    <main className="mx-auto max-w-xl px-8 py-24">
      <p className="sc-tiny">Partners in Biz</p>
      <h1 className="sc-article__h2 mt-4">Platform status.</h1>
      <p className="sc-body mt-4">
        Public service availability for the core platform surfaces.
      </p>

      <div className="mt-8">
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <Panel flat>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="sc-tiny">Current state</p>
                <p className="st-title mt-2">{headline}</p>
              </div>
              {status?.checkedAt ? (
                <p className="sc-tiny">
                  Last checked {new Date(status.checkedAt).toLocaleString('en-ZA')}
                </p>
              ) : null}
            </div>
            {status ? (
              <Status tone={statusTone(status.overall)}>{statusLabel(status.overall)}</Status>
            ) : null}
          </Panel>
        )}
      </div>

      {(status?.services ?? []).length > 0 ? (
        <ul className="mt-8 border-t border-[color:var(--sc-line)]">
          {status!.services.map((service) => (
            <li
              key={service.key}
              className="flex flex-col gap-2 border-b border-[color:var(--sc-line)] py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h2 className="st-title">{service.name}</h2>
                <p className="sc-body mt-1 text-sm">{formatLatency(service.latencyMs)}</p>
              </div>
              <Status tone={statusTone(service.status)}>{statusLabel(service.status)}</Status>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-8">
        <ButtonLink href="/" variant="ghost">
          Back to home
        </ButtonLink>
      </div>
    </main>
  )
}

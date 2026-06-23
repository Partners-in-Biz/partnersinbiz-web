'use client'

import { useEffect, useMemo, useState } from 'react'

type PublicStatus = {
  overall: 'ok' | 'degraded' | 'down'
  checkedAt: string
  services: Array<{
    key: string
    name: string
    status: 'ok' | 'degraded' | 'down' | 'not-configured'
    latencyMs: number | null
    latencyInstrumented: boolean
  }>
}

function formatLatency(latencyMs: number | null) {
  if (latencyMs == null) return 'Not instrumented'
  if (latencyMs >= 1000) return `${(latencyMs / 1000).toFixed(1)}s`
  return `${latencyMs}ms`
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
    if (!status) return 'Checking'
    if (status.overall === 'ok') return 'Operational'
    return 'Investigating'
  }, [status])

  return (
    <main className="min-h-screen bg-[#0a0a0b] px-4 py-12 text-[#ededed]">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-white/55">Partners in Biz</p>
          <h1 className="text-4xl font-semibold">Platform status</h1>
          <p className="max-w-2xl text-sm text-white/70">
            Public service availability for the core platform surfaces.
          </p>
        </header>

        <section className="rounded-lg border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/55">Current state</p>
              <p className="mt-3 text-3xl font-semibold">{error ?? headline}</p>
            </div>
            {status?.checkedAt ? (
              <p className="text-sm text-white/55">Last checked {new Date(status.checkedAt).toLocaleString('en-ZA')}</p>
            ) : null}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {(status?.services ?? []).map((service) => (
            <article key={service.key} className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-medium">{service.name}</h2>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70">
                  {service.status}
                </span>
              </div>
              <p className="mt-4 text-sm text-white/60">{formatLatency(service.latencyMs)}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  )
}

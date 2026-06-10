'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'

type BookStudioPortalArtifact = {
  label?: string
  href?: string
}

type BookStudioPortalPacket = {
  id?: string
  title?: string
  status?: string
  summary?: string
  artifacts?: BookStudioPortalArtifact[]
}

type BookStudioPortalGate = {
  id?: string
  label?: string
  status?: string
}

type BookStudioPortalProject = {
  id?: string
  title?: string
  status?: string
  stage?: string
  reviewStatus?: string
  nextAction?: string
  safeSummary?: string
  reviewPackets?: BookStudioPortalPacket[]
  gates?: BookStudioPortalGate[]
}

interface BookStudioPortalWorkspaceProps {
  orgId?: string | null
}

const disabledActions = [
  'Generate book',
  'Publish to stores',
  'Connect marketplace credentials',
]

function humanize(value?: string) {
  if (!value) return 'Not started'
  return value.replace(/_/g, ' ')
}

function gateTone(status?: string) {
  if (status === 'passed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
  if (status === 'blocked') return 'border-rose-500/30 bg-rose-500/10 text-rose-100'
  if (status === 'warning' || status === 'missing_evidence') return 'border-amber-500/30 bg-amber-500/10 text-amber-100'
  return 'border-[var(--color-pib-line)] bg-white/[0.03] text-[var(--color-pib-muted)]'
}

export function BookStudioPortalWorkspace({ orgId }: BookStudioPortalWorkspaceProps = {}) {
  const [projects, setProjects] = useState<BookStudioPortalProject[]>([])
  const [loading, setLoading] = useState(true)
  const [moduleDisabled, setModuleDisabled] = useState(false)
  const [notice, setNotice] = useState('')

  const apiPath = useMemo(() => scopedApiPath('/api/v1/portal/book-studio', { orgId }), [orgId])

  const load = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const res = await fetch(apiPath)
      const body = await res.json().catch(() => ({}))
      if (!res.ok && body.moduleDisabled === true) {
        setModuleDisabled(true)
        setProjects([])
        return
      }
      setModuleDisabled(false)
      setProjects(Array.isArray(body.data?.projects) ? body.data.projects : [])
      if (!res.ok) setNotice(body.error ?? 'Could not load Book Studio review material.')
    } catch {
      setModuleDisabled(false)
      setProjects([])
      setNotice('Could not load Book Studio review material.')
    } finally {
      setLoading(false)
    }
  }, [apiPath])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <section className="rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="eyebrow">Book Studio</p>
            <h1 className="text-2xl font-semibold text-[var(--color-pib-text)] sm:text-3xl">Book Studio review</h1>
            <p className="text-sm leading-6 text-[var(--color-pib-muted)]">
              Review client-safe packets prepared by the PiB team. This portal surface is deliberately review-only: no self-serve generation, no marketplace credential custody and no direct store publishing.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            Manual release posture: PiB must complete rights, evidence, checksum and human release gates before anything leaves the workspace.
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {disabledActions.map((label) => (
            <button
              key={label}
              type="button"
              disabled
              className="cursor-not-allowed rounded-2xl border border-[var(--color-pib-line)] bg-white/[0.03] px-4 py-3 text-left text-sm font-medium text-[var(--color-pib-muted)] opacity-80"
            >
              {label}
              <span className="mt-1 block text-xs font-normal">Disabled in Book Studio V1</span>
            </button>
          ))}
        </div>
      </section>

      {moduleDisabled ? (
        <section className="mt-6 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-text)]">
          <h2 className="text-lg font-semibold">Book Studio is not enabled for this portal.</h2>
          <p className="mt-2 text-[var(--color-pib-muted)]">Your PiB team controls when a client-safe book review packet becomes available.</p>
        </section>
      ) : (
        <section className="mt-6 space-y-4">
          {notice && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">{notice}</div>}
          {loading ? (
            <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-muted)]">Loading Book Studio review material…</div>
          ) : projects.length === 0 ? (
            <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6">
              <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">No review packets yet</h2>
              <p className="mt-2 text-sm text-[var(--color-pib-muted)]">When the PiB team prepares a client-safe book packet, it will appear here for review. Generation and publishing remain operator-controlled.</p>
            </div>
          ) : (
            projects.map((project) => {
              const packets = Array.isArray(project.reviewPackets) ? project.reviewPackets : []
              const gates = Array.isArray(project.gates) ? project.gates : []
              return (
                <article key={project.id ?? project.title} className="rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-5 sm:p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="eyebrow">{humanize(project.stage)}</p>
                      <h2 className="text-xl font-semibold text-[var(--color-pib-text)]">{project.title ?? 'Untitled book project'}</h2>
                      {project.safeSummary && <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-pib-muted)]">{project.safeSummary}</p>}
                    </div>
                    <span className="rounded-full border border-[var(--color-pib-line)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-muted)]">{humanize(project.status)}</span>
                  </div>

                  {project.nextAction && <p className="mt-4 rounded-2xl bg-white/[0.04] p-4 text-sm text-[var(--color-pib-text)]">Next: {project.nextAction}</p>}

                  {gates.length > 0 && (
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {gates.map((gate) => (
                        <div key={gate.id ?? gate.label} className={`rounded-2xl border p-3 text-sm ${gateTone(gate.status)}`}>
                          <p className="font-medium">{gate.label ?? 'Quality gate'}</p>
                          <p className="mt-1 text-xs uppercase tracking-wide opacity-80">{humanize(gate.status)}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-5 space-y-3">
                    {packets.length === 0 ? (
                      <div className="rounded-2xl border border-[var(--color-pib-line)] p-4 text-sm text-[var(--color-pib-muted)]">No client review packet has been requested yet.</div>
                    ) : (
                      packets.map((packet) => (
                        <div key={packet.id ?? packet.title} className="rounded-2xl border border-[var(--color-pib-line)] p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="font-semibold text-[var(--color-pib-text)]">{packet.title ?? 'Review packet'}</h3>
                              {packet.summary && <p className="mt-2 text-sm leading-6 text-[var(--color-pib-muted)]">{packet.summary}</p>}
                            </div>
                            <button type="button" disabled className="cursor-not-allowed rounded-xl border border-[var(--color-pib-line)] px-4 py-2 text-sm text-[var(--color-pib-muted)] opacity-75">
                              Approve packet
                            </button>
                          </div>
                          <p className="mt-3 text-xs text-[var(--color-pib-muted)]">Approval opens only after PiB requests review for a client-safe packet.</p>
                          {Array.isArray(packet.artifacts) && packet.artifacts.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {packet.artifacts.map((artifact) => (
                                artifact.href ? (
                                  <a key={`${artifact.label}-${artifact.href}`} href={artifact.href} target="_blank" rel="noreferrer" className="pib-btn-ghost text-sm">
                                    {artifact.label ?? 'Open artifact'}
                                  </a>
                                ) : null
                              ))}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </article>
              )
            })
          )}
        </section>
      )}
    </main>
  )
}

'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { NewBookDialog } from './NewBookDialog'
import type { BookStudioCapabilities } from '@/lib/book-studio/capabilities'

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
  id: string
  title?: string
  status?: string
  stage?: string
  format?: string
  coverImageUrl?: string
  reviewPackets?: BookStudioPortalPacket[]
  gates?: BookStudioPortalGate[]
}

interface BookStudioPortalWorkspaceProps {
  orgId?: string | null
}

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
  const router = useRouter()
  const [projects, setProjects] = useState<BookStudioPortalProject[]>([])
  const [capabilities, setCapabilities] = useState<BookStudioCapabilities | null>(null)
  const [resolvedOrgId, setResolvedOrgId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [moduleDisabled, setModuleDisabled] = useState(false)
  const [notice, setNotice] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)

  const apiPath = useMemo(() => scopedApiPath('/api/v1/portal/book-studio/projects', { orgId }), [orgId])

  const load = useCallback(async () => {
    setLoading(true)
    setNotice('')
    try {
      const res = await fetch(apiPath)
      const body = await res.json().catch(() => ({}))
      if (!res.ok && body.moduleDisabled === true) {
        setModuleDisabled(true)
        setProjects([])
        setCapabilities(null)
        return
      }
      setModuleDisabled(false)
      if (!res.ok) {
        setNotice(body.error ?? 'Could not load Book Studio review material.')
        setProjects([])
        setCapabilities(null)
        return
      }
      const data = body.data ?? body
      setProjects(Array.isArray(data.records) ? data.records : [])
      setCapabilities(data.capabilities ?? null)
      setResolvedOrgId(typeof data.orgId === 'string' ? data.orgId : orgId ?? '')
    } catch {
      setModuleDisabled(false)
      setProjects([])
      setCapabilities(null)
      setNotice('Could not load Book Studio review material.')
    } finally {
      setLoading(false)
    }
  }, [apiPath, orgId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="p-4 sm:p-6 lg:p-8">
      <section className="rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="eyebrow">Book Studio</p>
            <h1 className="text-2xl font-semibold text-[var(--color-pib-text)] sm:text-3xl">Book Studio</h1>
            <p className="text-sm leading-6 text-[var(--color-pib-muted)]">
              Review and continue writing books prepared for your organisation. Publishing and marketplace credentials remain operator-controlled.
            </p>
          </div>
          {capabilities?.canCreate ? (
            <button type="button" className="pib-btn-primary" onClick={() => setDialogOpen(true)}>
              New book
            </button>
          ) : null}
        </div>
      </section>

      {moduleDisabled ? (
        <section className="mt-6 rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-text)]">
          <h2 className="text-lg font-semibold">Book Studio is not enabled for this portal.</h2>
          <p className="mt-2 text-[var(--color-pib-muted)]">Your PiB team controls when a client-safe book review packet becomes available.</p>
        </section>
      ) : (
        <>
          <section className="mt-6 space-y-4">
            {notice && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">{notice}</div>}
            {loading ? (
              <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6 text-sm text-[var(--color-pib-muted)]">Loading Book Studio review material…</div>
            ) : projects.length === 0 ? (
              <div className="rounded-2xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-6">
                <h2 className="text-lg font-semibold text-[var(--color-pib-text)]">No books yet</h2>
                <p className="mt-2 text-sm text-[var(--color-pib-muted)]">
                  {capabilities?.canCreate
                    ? 'Create your first book to get started.'
                    : 'When the PiB team prepares a book project, it will appear here for review.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {projects.map((project) => {
                  const format = project.format ? getBookFormat(project.format) : null
                  const packets = Array.isArray(project.reviewPackets) ? project.reviewPackets : []
                  const gates = Array.isArray(project.gates) ? project.gates : []
                  return (
                    <Link
                      key={project.id}
                      href={`/portal/book-studio/${project.id}`}
                      className="block rounded-3xl border border-[var(--color-pib-line)] bg-[var(--color-pib-card)] p-5 transition hover:border-[var(--color-pib-accent,theme(colors.indigo.400))] sm:p-6"
                    >
                      {project.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={project.coverImageUrl} alt="" className="mb-3 h-32 w-full rounded-lg object-cover" />
                      ) : null}
                      <p className="eyebrow">{humanize(project.stage)}</p>
                      <h2 className="text-xl font-semibold text-[var(--color-pib-text)]">{project.title ?? 'Untitled book project'}</h2>
                      <p className="mt-1 text-xs text-[var(--color-pib-muted)]">
                        {format?.label ?? project.format ?? 'No format'}
                        {project.status ? ` · ${humanize(project.status)}` : ''}
                      </p>
                      {capabilities?.canEdit ? (
                        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-pib-accent,theme(colors.indigo.400))]">Continue writing →</p>
                      ) : null}

                      {gates.length > 0 && (
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {gates.map((gate) => (
                            <div key={gate.id ?? gate.label} className={`rounded-2xl border px-3 py-2 text-xs ${gateTone(gate.status)}`}>
                              <p className="font-medium">{gate.label ?? 'Quality gate'}</p>
                              <p className="mt-0.5 uppercase tracking-wide opacity-80">{humanize(gate.status)}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {packets.length > 0 && (
                        <div className="mt-4 space-y-2">
                          {packets.map((packet) => (
                            <div key={packet.id ?? packet.title} className="rounded-2xl border border-[var(--color-pib-line)] p-3 text-xs text-[var(--color-pib-muted)]">
                              <p className="font-semibold text-[var(--color-pib-text)]">{packet.title ?? 'Review packet'}</p>
                              {packet.summary ? <p className="mt-1">{packet.summary}</p> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </Link>
                  )
                })}
              </div>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            Manual release posture: PiB must complete rights, evidence, checksum and human release gates before anything leaves the workspace.
          </section>
        </>
      )}

      {capabilities?.canCreate ? (
        <NewBookDialog
          orgId={resolvedOrgId || orgId || ''}
          surface="portal"
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={(projectId) => {
            setDialogOpen(false)
            router.push(`/portal/book-studio/${projectId}`)
          }}
        />
      ) : null}
    </main>
  )
}

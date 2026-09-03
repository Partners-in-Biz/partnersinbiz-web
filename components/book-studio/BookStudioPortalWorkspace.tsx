'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import { getBookFormat } from '@/lib/book-studio/format-registry'
import { NewBookDialog } from './NewBookDialog'
import type { BookStudioCapabilities } from '@/lib/book-studio/capabilities'
import { PageHeader, Surface } from '@/components/ui/AppFoundation'
import { HudChip } from '@/components/ui/HudChip'

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
  if (status === 'warning' || status === 'missing_evidence') return 'border-amber-500/30 bg-[var(--sc-surface)]/10 text-[var(--sc-ink-soft)]'
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
    <main className="space-y-4 p-4 sm:p-6 lg:p-8" data-module-accent="rose">
      <PageHeader
        accent="rose"
        eyebrow="Book Studio"
        title="Book Studio"
        description="Review and continue writing books prepared for your organisation. Publishing and marketplace credentials remain operator-controlled."
        actions={capabilities?.canCreate ? (
          <button type="button" className="btn-pib-primary btn-pib-sm font-label" onClick={() => setDialogOpen(true)}>
            New book
          </button>
        ) : undefined}
      />

      {moduleDisabled ? (
        <Surface className="p-4 text-sm text-[var(--color-pib-text)]">
          <h2 className="text-sm">Book Studio is not enabled for this portal.</h2>
          <p className="mt-1 text-[var(--color-pib-text-muted)]">Your PiB team controls when a client-safe book review packet becomes available.</p>
        </Surface>
      ) : (
        <>
          <section className="space-y-3">
            {notice ? <Surface className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100">{notice}</Surface> : null}
            {loading ? (
              <Surface className="p-4 text-sm text-[var(--color-pib-text-muted)]">Loading Book Studio review material…</Surface>
            ) : projects.length === 0 ? (
              <Surface className="p-4">
                <h2 className="text-sm text-[var(--color-pib-text)]">No books yet</h2>
                <p className="mt-1 text-sm text-[var(--color-pib-text-muted)]">
                  {capabilities?.canCreate
                    ? 'Create your first book to get started.'
                    : 'When the PiB team prepares a book project, it will appear here for review.'}
                </p>
              </Surface>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {projects.map((project) => {
                  const format = project.format ? getBookFormat(project.format) : null
                  const packets = Array.isArray(project.reviewPackets) ? project.reviewPackets : []
                  const gates = Array.isArray(project.gates) ? project.gates : []
                  return (
                    <Link
                      key={project.id}
                      href={`/portal/book-studio/${project.id}`}
                      className="pib-card block p-4 transition-colors hover:border-rose-400/40"
                    >
                      {project.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={project.coverImageUrl} alt="" className="mb-2 h-28 w-full rounded-md object-cover" />
                      ) : null}
                      <p className="sc-tiny !text-[10px]">{humanize(project.stage)}</p>
                      <h2 className="text-base text-[var(--color-pib-text)]">{project.title ?? 'Untitled book project'}</h2>
                      <p className="mt-0.5 text-xs text-[var(--color-pib-text-muted)]">
                        {format?.label ?? project.format ?? 'No format'}
                        {project.status ? ` · ${humanize(project.status)}` : ''}
                      </p>
                      {capabilities?.canEdit ? (
                        <p className="mt-2 text-[10px] font-label uppercase tracking-wide text-rose-300">Continue writing →</p>
                      ) : null}

                      {gates.length > 0 && (
                        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                          {gates.map((gate) => (
                            <HudChip key={gate.id ?? gate.label} className={gateTone(gate.status)}>
                              {gate.label ?? 'Quality gate'} · {humanize(gate.status)}
                            </HudChip>
                          ))}
                        </div>
                      )}

                      {packets.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {packets.map((packet) => (
                            <div key={packet.id ?? packet.title} className="rounded-md border border-[var(--color-pib-line)] p-2 text-xs text-[var(--color-pib-text-muted)]">
                              <p className="text-[var(--color-pib-text)]">{packet.title ?? 'Review packet'}</p>
                              {packet.summary ? <p className="mt-0.5">{packet.summary}</p> : null}
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

          <Surface className="border-amber-500/30 bg-[var(--sc-surface)]/10 p-3 text-sm text-[var(--sc-ink-soft)]">
            Manual release posture: PiB must complete rights, evidence, checksum and human release gates before anything leaves the workspace.
          </Surface>
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

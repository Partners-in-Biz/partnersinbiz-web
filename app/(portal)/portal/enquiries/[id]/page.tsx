'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/config'
import MessageThread from '@/components/portal/MessageThread'
import { scopedPortalPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

const STATUS_LABELS: Record<string, string> = {
  new: 'Under Review',
  reviewing: 'In Discussion',
  active: 'In Progress',
  closed: 'Completed',
}

const STATUS_PILL: Record<string, string> = {
  new: 'pib-pill',
  reviewing: 'pib-pill pib-pill-info',
  active: 'pib-pill pib-pill-success',
  closed: 'pib-pill',
}

interface Message {
  id: string
  text: string
  direction: 'inbound' | 'outbound'
  authorName: string
  createdAt: unknown
}

interface PortalEnquiry {
  id: string
  projectType?: string | null
  status?: string | null
  details?: string | null
  company?: string | null
}

export default function EnquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [id, setId] = useState<string | null>(null)
  const [enquiry, setEnquiry] = useState<PortalEnquiry | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const orgScope = scopeFromSearchParams(searchParams)

  useEffect(() => {
    params.then((p) => setId(p.id))
  }, [params])

  useEffect(() => {
    if (!id) return
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push('/login'); return }
      const [enqRes, msgRes] = await Promise.all([
        fetch(`/api/v1/portal/enquiries/${id}`),
        fetch(`/api/v1/portal/messages?enquiryId=${id}`),
      ])
      if (!enqRes.ok) { router.push('/portal/dashboard'); return }
      const enqBody = await enqRes.json()
      const msgBody = await msgRes.json()
      setEnquiry(enqBody.data as PortalEnquiry)
      setMessages(msgBody.data ?? [])
      setLoading(false)
    })
  }, [id, router])

  if (loading)
    return (
      <div className="space-y-6">
        <div className="pib-skeleton h-8 w-48" />
        <div className="pib-skeleton h-40" />
        <div className="pib-skeleton h-64" />
      </div>
    )

  if (!enquiry) return null

  const projectTypeLabel = enquiry.projectType?.replace(/_/g, ' ') ?? 'Project'
  const workspaceLabel = orgScope.sourceCompanyName
    ? `${orgScope.sourceCompanyName} workspace`
    : enquiry.company
      ? `${enquiry.company} workspace`
      : 'Active workspace'
  const projectsHref = scopedPortalPath('/portal/projects', orgScope)
  const statusKey = enquiry.status ?? 'unknown'
  const statusLabel = STATUS_LABELS[statusKey] ?? statusKey

  return (
    <div className="space-y-8">
      <Link
        href={projectsHref}
        className="inline-flex items-center gap-1 text-sm text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] transition-colors"
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">arrow_back</span>
        Back to projects
      </Link>

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Project brief</p>
          <h1 className="pib-page-title mt-2">Project intake command center</h1>
          <p className="pib-page-sub mt-2 max-w-3xl">
            Turn this enquiry into a scoped delivery plan, visible team handoff, and auditable client conversation.
          </p>
        </div>
        <span className={STATUS_PILL[statusKey] ?? 'pib-pill'}>
          {statusLabel}
        </span>
      </header>

      <section className="grid gap-3 md:grid-cols-3" aria-label="Project intake command summary">
        {[
          ['Workspace', workspaceLabel, enquiry.company ? `Company · ${enquiry.company}` : 'Client workspace context', 'business_center'],
          ['Intake status', statusLabel, projectTypeLabel, 'fact_check'],
          [
            'Team next step',
            messages.length > 0 ? `${messages.length} message${messages.length === 1 ? '' : 's'} logged` : 'No messages yet',
            messages.length > 0 ? 'Conversation history' : 'Awaiting first reply',
            'groups',
          ],
        ].map(([label, value, sub, icon]) => (
          <div key={label} className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-surface)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">{label}</p>
                <p className="mt-2 text-lg font-semibold text-[var(--color-pib-text)]">{value}</p>
              </div>
              <span className="material-symbols-outlined text-lg text-[var(--color-pib-accent)]" aria-hidden="true">{icon}</span>
            </div>
            <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{sub}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="bento-card !p-7 space-y-3">
          <p className="eyebrow">Brief</p>
          <h2 className="text-xl font-semibold capitalize text-[var(--color-pib-text)]">{projectTypeLabel}</h2>
          <p className="text-[var(--color-pib-text)] leading-relaxed text-pretty">{enquiry.details}</p>
          {enquiry.company && (
            <p className="text-xs text-[var(--color-pib-text-muted)] font-mono pt-3 border-t border-[var(--color-pib-line)]">
              Company · {enquiry.company}
            </p>
          )}
        </section>

        <section className="bento-card !p-7 space-y-4">
          <p className="eyebrow">Conversation</p>
          <MessageThread
            messages={messages}
            enquiryId={enquiry.id}
            onSent={(msg) => setMessages((prev) => [...prev, msg])}
          />
        </section>
      </div>
    </div>
  )
}

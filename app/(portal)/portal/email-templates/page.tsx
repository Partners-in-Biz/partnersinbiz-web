'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { EmailTemplate, TemplateCategory } from '@/lib/email-builder/templates'

const CATEGORIES: { value: TemplateCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'welcome', label: 'Welcome' },
  { value: 'product-launch', label: 'Product launch' },
  { value: 'reengagement', label: 'Re-engagement' },
  { value: 'transactional', label: 'Transactional' },
  { value: 'custom', label: 'Custom' },
]

const CATEGORY_COLORS: Record<string, string> = {
  newsletter: 'pib-pill pib-pill-blue',
  welcome: 'pib-pill pib-pill-accent',
  'product-launch': 'pib-pill pib-pill-violet',
  reengagement: 'pib-pill pib-pill-rose',
  transactional: 'pib-pill pib-pill-success',
  custom: 'pib-pill',
}

export default function EmailTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<TemplateCategory | 'all'>('all')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/v1/email-templates')
      .then((r) => r.json())
      .then((b) => setTemplates(b.data ?? []))
      .finally(() => setLoading(false))
  }, [])

  // Render small previews for each template
  useEffect(() => {
    let cancelled = false
    async function renderPreviews() {
      for (const t of templates) {
        if (previews[t.id]) continue
        try {
          const res = await fetch('/api/v1/email-builder/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              document: t.document,
              vars: { firstName: 'Friend', orgName: 'Your Brand', unsubscribeUrl: '#', invoiceNumber: '1234', itemDescription: 'Pro plan', quantity: '1', subtotal: 'R 499.00', vat: 'R 74.85', total: 'R 573.85', invoiceUrl: '#' },
            }),
          })
          const json = await res.json()
          if (cancelled) return
          if (json?.data?.html) {
            setPreviews((prev) => ({ ...prev, [t.id]: json.data.html }))
          }
        } catch {
          /* ignore */
        }
      }
    }
    if (templates.length > 0) renderPreviews()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates])

  const filtered = useMemo(() => {
    if (filter === 'all') return templates
    return templates.filter((t) => t.category === filter)
  }, [filter, templates])

  async function createBlank() {
    if (creating) return
    setCreating(true)
    try {
      const blank = {
        name: 'Untitled template',
        description: '',
        category: 'custom' as TemplateCategory,
        document: {
          subject: 'New email',
          preheader: 'Preview text shown in the inbox',
          blocks: [
            {
              id: 'b_init_1',
              type: 'heading',
              props: { text: 'Hello {{firstName}}', level: 1, align: 'left' },
            },
            {
              id: 'b_init_2',
              type: 'paragraph',
              props: { html: 'Start writing here...', align: 'left' },
            },
            {
              id: 'b_init_3',
              type: 'footer',
              props: { orgName: '{{orgName}}', address: 'Pretoria, Gauteng, South Africa', unsubscribeUrl: '{{unsubscribeUrl}}' },
            },
          ],
          theme: {
            primaryColor: '#F5A623',
            textColor: '#0A0A0B',
            backgroundColor: '#F4F4F5',
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            contentWidth: 600,
          },
        },
      }
      const res = await fetch('/api/v1/email-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blank),
      })
      const body = await res.json()
      if (res.ok && body?.data?.id) {
        router.push(`/portal/email-templates/${body.data.id}`)
      }
    } finally {
      setCreating(false)
    }
  }

  async function duplicate(id: string) {
    const res = await fetch(`/api/v1/email-templates/${id}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const body = await res.json()
    if (res.ok && body?.data?.id) {
      router.push(`/portal/email-templates/${body.data.id}`)
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Email · Templates</p>
          <h1 className="pib-page-title mt-2">Email templates</h1>
          <p className="pib-page-sub">Drag-drop email composer with Outlook-safe rendering.</p>
        </div>
        <button onClick={createBlank} disabled={creating} className="btn-pib-primary">
          {creating ? 'Creating...' : 'New from scratch'}
        </button>
      </header>

      <div role="tablist" aria-label="Template categories" className="pib-tabs pib-tabs-segmented min-w-0 max-w-full overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="tab"
            aria-selected={filter === c.value}
            onClick={() => setFilter(c.value)}
            className={`pib-tab ${filter === c.value ? 'pib-tab-active' : ''}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="pib-skeleton h-80" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="pib-empty-state">
          <span aria-hidden="true" className="material-symbols-outlined pib-empty-state-icon">mail</span>
          <h2 className="pib-empty-state-title">No templates in this category.</h2>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <div key={t.id} className="pib-card flex flex-col overflow-hidden p-0">
              <div className="relative bg-white" style={{ height: 220, overflow: 'hidden' }}>
                {previews[t.id] ? (
                  <div
                    style={{
                      width: 600,
                      transform: 'scale(0.55)',
                      transformOrigin: 'top left',
                      pointerEvents: 'none',
                    }}
                    dangerouslySetInnerHTML={{ __html: previews[t.id] }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-[var(--color-pib-text-muted)]">Loading preview...</div>
                )}
              </div>
              <div className="flex flex-1 flex-col border-t border-[var(--color-pib-line)] p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-tight">{t.name}</h3>
                  {t.isStarter && <span className="pib-pill">Starter</span>}
                </div>
                <p className="mb-3 flex-1 text-xs text-[var(--color-pib-text-muted)] line-clamp-2">{t.description}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className={CATEGORY_COLORS[t.category] ?? CATEGORY_COLORS.custom}>
                    {t.category}
                  </span>
                  <div className="flex gap-2">
                    {t.isStarter ? (
                      <button onClick={() => duplicate(t.id)} className="btn-pib-secondary">
                        Duplicate
                      </button>
                    ) : (
                      <Link href={`/portal/email-templates/${t.id}`} className="btn-pib-secondary">
                        Edit
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

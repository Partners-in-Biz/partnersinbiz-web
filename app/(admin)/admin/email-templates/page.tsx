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
  newsletter: 'bg-blue-900/40 text-blue-200 border border-blue-800',
  welcome: 'bg-amber-900/40 text-amber-200 border border-amber-800',
  'product-launch': 'bg-violet-900/40 text-violet-200 border border-violet-800',
  reengagement: 'bg-rose-900/40 text-rose-200 border border-rose-800',
  transactional: 'bg-emerald-900/40 text-emerald-200 border border-emerald-800',
  custom: 'bg-zinc-800 text-zinc-200 border border-zinc-700',
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
        router.push(`/admin/email-templates/${body.data.id}`)
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
      router.push(`/admin/email-templates/${body.data.id}`)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Email templates</h1>
          <p className="text-sm text-on-surface-variant mt-1">Drag-drop email composer with Outlook-safe rendering.</p>
        </div>
        <button
          onClick={createBlank}
          disabled={creating}
          className="px-4 py-2 rounded-lg bg-primary text-on-primary text-sm font-medium disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'New from scratch'}
        </button>
      </div>

      <div className="mb-6 flex gap-2 flex-wrap">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            onClick={() => setFilter(c.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === c.value
                ? 'bg-primary text-on-primary'
                : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-80 rounded-xl bg-surface-container animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-on-surface-variant">No templates in this category.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <div key={t.id} className="rounded-xl bg-surface-container border border-outline-variant overflow-hidden flex flex-col">
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
                  <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">Loading preview...</div>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-on-surface text-sm leading-tight">{t.name}</h3>
                  {t.isStarter && (
                    <span className="text-[10px] uppercase tracking-wide bg-zinc-700 text-zinc-200 px-2 py-0.5 rounded">Starter</span>
                  )}
                </div>
                <p className="text-xs text-on-surface-variant flex-1 mb-3 line-clamp-2">{t.description}</p>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide ${CATEGORY_COLORS[t.category] ?? CATEGORY_COLORS.custom}`}>
                    {t.category}
                  </span>
                  <div className="flex gap-2">
                    {t.isStarter ? (
                      <button
                        onClick={() => duplicate(t.id)}
                        className="px-3 py-1.5 text-xs rounded-md bg-primary text-on-primary font-medium"
                      >
                        Duplicate
                      </button>
                    ) : (
                      <Link
                        href={`/admin/email-templates/${t.id}`}
                        className="px-3 py-1.5 text-xs rounded-md bg-primary text-on-primary font-medium"
                      >
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

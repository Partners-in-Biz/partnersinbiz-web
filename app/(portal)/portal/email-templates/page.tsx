'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, EmptyState, PageTabs } from '@/components/ui/AppFoundation'
import { Button, ButtonLink, Status, Skeleton, Panel } from '@/components/studio'
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

const CATEGORY_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | undefined> = {
  newsletter: 'info',
  welcome: undefined,
  'product-launch': 'info',
  reengagement: 'warning',
  transactional: 'success',
  custom: undefined,
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
              vars: {
                firstName: 'Friend',
                orgName: 'Your Brand',
                unsubscribeUrl: '#',
                invoiceNumber: '1234',
                itemDescription: 'Pro plan',
                quantity: '1',
                subtotal: 'R 499.00',
                vat: 'R 74.85',
                total: 'R 573.85',
                invoiceUrl: '#',
              },
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
              props: {
                orgName: '{{orgName}}',
                address: 'Pretoria, Gauteng, South Africa',
                unsubscribeUrl: '{{unsubscribeUrl}}',
              },
            },
          ],
          theme: {
            primaryColor: '#e4572e',
            textColor: '#1a1714',
            backgroundColor: '#f3efe6',
            fontFamily: 'var(--sc-font)',
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
      <PageHeader
        eyebrow="Email"
        title="Email templates."
        description="Drag-drop email composer with Outlook-safe rendering."
        actions={
          <Button onClick={createBlank} disabled={creating} loading={creating}>
            {creating ? 'Creating...' : 'New from scratch'}
          </Button>
        }
      />

      <PageTabs
        ariaLabel="Template categories"
        value={filter}
        onValueChange={(v) => setFilter(v as TemplateCategory | 'all')}
        tabs={CATEGORIES.map((c) => ({ value: c.value, label: c.label }))}
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} height={320} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No templates in this category." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <Panel key={t.id} className="flex flex-col overflow-hidden !p-0">
              <div className="relative bg-[var(--sc-canvas)]" style={{ height: 220, overflow: 'hidden' }}>
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
                  <div className="sc-body flex h-full w-full items-center justify-center text-xs text-[var(--sc-ink-soft)]">
                    Loading preview...
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col border-t border-[var(--sc-line)] p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="st-title text-sm leading-tight">{t.name}</h3>
                  {t.isStarter && <Status>Starter</Status>}
                </div>
                <p className="sc-body mb-3 flex-1 text-xs text-[var(--sc-ink-soft)] line-clamp-2">{t.description}</p>
                <div className="flex items-center justify-between gap-2">
                  <Status tone={CATEGORY_TONE[t.category]}>{t.category}</Status>
                  <div className="flex gap-2">
                    {t.isStarter ? (
                      <Button variant="secondary" size="sm" onClick={() => duplicate(t.id)}>
                        Duplicate
                      </Button>
                    ) : (
                      <ButtonLink href={`/portal/email-templates/${t.id}`} variant="secondary" size="sm">
                        Edit
                      </ButtonLink>
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  )
}

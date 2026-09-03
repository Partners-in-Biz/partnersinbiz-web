'use client'

import { useEffect, useMemo, useState } from 'react'
import { scopedApiPath } from '@/lib/portal/scoped-routing'
import {
  VIDEO_EDITOR_TEMPLATE_CATEGORIES,
  PLATFORM_TEMPLATE_ORG,
  type VideoEditorTemplate,
  type VideoEditorTemplateCategory,
} from '@/lib/video-editor/templates'
import type { EditorTimeline } from '@/lib/video-editor/types'

type TemplateOption = VideoEditorTemplate & { id: string }

function categoryLabel(category: VideoEditorTemplateCategory): string {
  return category.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ')
}

export function TemplateBrowserPanel({
  orgId,
  channelWorkspaceId,
  canSaveSelection,
  onInsert,
  onSaveSelection,
}: {
  orgId?: string
  channelWorkspaceId?: string
  canSaveSelection: boolean
  onInsert: (fragment: EditorTimeline) => void | Promise<void>
  onSaveSelection: () => void | Promise<void>
}) {
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [category, setCategory] = useState<VideoEditorTemplateCategory | ''>('')
  const [busyTemplateId, setBusyTemplateId] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!orgId) {
      setTemplates([])
      setLoading(false)
      return
    }
    const activeOrgId: string = orgId
    let cancelled = false
    async function loadTemplates() {
      setMessage('')
      setLoading(true)
      setTemplates([])
      try {
        const suffix = category ? `?category=${encodeURIComponent(category)}` : ''
        const res = await fetch(scopedApiPath(`/api/v1/video-editor/templates${suffix}`, { orgId: activeOrgId }))
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error ?? 'Could not load templates')
        if (!cancelled) setTemplates((body.data?.templates ?? []) as TemplateOption[])
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Could not load templates')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadTemplates()
    return () => {
      cancelled = true
    }
  }, [category, orgId])

  const visibleTemplates = useMemo(
    () => templates.filter((template) => !category || template.category === category),
    [category, templates],
  )

  async function insertTemplate(template: TemplateOption) {
    if (!orgId) return
    const activeOrgId = orgId
    setBusyTemplateId(template.id)
    setMessage('')
    try {
      const res = await fetch(scopedApiPath(`/api/v1/video-editor/templates/${template.id}/resolve`, { orgId: activeOrgId }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelWorkspaceId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Could not resolve template')
      const fragment = body.data?.fragment as EditorTimeline | undefined
      if (!fragment) throw new Error('Template did not return a timeline fragment')
      await onInsert(fragment)
      setMessage(`Inserted ${template.title}.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not insert template')
    } finally {
      setBusyTemplateId('')
    }
  }

  async function saveSelection() {
    setMessage('')
    try {
      await onSaveSelection()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save template')
    }
  }

  return (
    <section className="pib-card-section space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-headline text-lg text-[var(--color-pib-text)]">Templates</h2>
        {canSaveSelection ? (
          <button type="button" className="pib-btn-ghost text-sm" onClick={() => void saveSelection()}>
            Save selection
          </button>
        ) : null}
      </div>
      <label className="block text-xs uppercase tracking-wide text-[var(--color-pib-text-muted)]">
        Category
        <select
          className="mt-1 w-full rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-surface)] px-2 py-2 text-sm normal-case text-[var(--color-pib-text)]"
          value={category}
          onChange={(event) => setCategory(event.target.value as VideoEditorTemplateCategory | '')}
          disabled={!orgId}
         aria-label="Input">
          <option value="">All templates</option>
          {VIDEO_EDITOR_TEMPLATE_CATEGORIES.map((item) => (
            <option key={item} value={item}>{categoryLabel(item)}</option>
          ))}
        </select>
      </label>
      {!orgId ? <p className="text-sm text-[var(--color-pib-text-muted)]">Choose an organisation to load templates.</p> : null}
      <div className="space-y-2">
        {loading ? <p className="text-sm text-[var(--color-pib-text-muted)]">Loading templates...</p> : null}
        {visibleTemplates.map((template) => (
          <article key={template.id} className="rounded-lg border border-[var(--color-pib-line)] p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm text-[var(--color-pib-text)]">{template.title}</h3>
                <p className="text-xs text-[var(--color-pib-text-muted)]">
                  {categoryLabel(template.category)}
                  {template.orgId === PLATFORM_TEMPLATE_ORG ? ' - platform' : ''}
                </p>
              </div>
              <button
                type="button"
                className="pib-btn-ghost text-xs"
                disabled={busyTemplateId === template.id}
                onClick={() => void insertTemplate(template)}
              >
                {busyTemplateId === template.id ? 'Inserting...' : 'Insert at playhead'}
              </button>
            </div>
            {template.description ? <p className="mt-2 text-xs text-[var(--color-pib-text-muted)]">{template.description}</p> : null}
          </article>
        ))}
        {orgId && !loading && !visibleTemplates.length ? <p className="text-sm text-[var(--color-pib-text-muted)]">No templates found.</p> : null}
      </div>
      {message ? <p role="status" className="text-xs text-[var(--color-pib-text-muted)]">{message}</p> : null}
    </section>
  )
}

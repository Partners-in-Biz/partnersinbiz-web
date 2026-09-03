'use client'

import React from 'react'
import Link from 'next/link'
import type { PreviewBlog, PreviewBrand } from './types'
import { PreviewImage } from './utils'

export interface BlogPreviewCardProps {
  blog: PreviewBlog
  brand?: PreviewBrand
  href: string
  status?: string
  excerptLength?: number
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function deriveExcerpt(body: string, max: number): string {
  if (!body) return ''
  // Strip markdown headings, code fences, and image tags
  const cleaned = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s+.*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= max) return cleaned
  const cut = cleaned.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  idea:             { label: 'Idea',          color: 'rgba(148,163,184,0.18)' },
  draft:            { label: 'Draft',         color: 'rgba(148,163,184,0.18)' },
  review:           { label: 'Needs Review',  color: 'rgba(245,166,35,0.22)' },
  pending_approval: { label: 'Needs Review',  color: 'rgba(245,166,35,0.22)' },
  client_approved:  { label: 'Approved ✓',   color: 'rgba(74,222,128,0.20)' },
  approved:         { label: 'Approved',      color: 'rgba(96,165,250,0.20)' },
  live:             { label: 'Published',     color: 'rgba(74,222,128,0.20)' },
  published:        { label: 'Published',     color: 'rgba(74,222,128,0.20)' },
}

export function BlogPreviewCard({
  blog,
  brand: _brand,
  href,
  status,
  excerptLength = 220,
}: BlogPreviewCardProps) {
  const date = formatDate(blog.publishDate)
  const readTime =
    blog.readTimeMinutes ??
    (blog.draft?.wordCount ? Math.max(1, Math.round(blog.draft.wordCount / 220)) : null)
  const excerpt =
    blog.draft?.metaDescription?.trim() ||
    deriveExcerpt(blog.draft?.body ?? '', excerptLength)
  const statusKey = (status ?? blog.status ?? 'draft').toString()
  const meta = STATUS_LABEL[statusKey] ?? { label: statusKey, color: 'rgba(148,163,184,0.18)' }

  return (
    <Link
      href={href}
      className="pib-card overflow-hidden flex flex-col group hover:border-[var(--org-accent,var(--color-pib-accent))] transition-colors"
      style={{ padding: 0 }}
    >
      {/* Hero */}
      <div
        className="aspect-[16/9] w-full relative"
        style={{
          background: blog.heroImageUrl
            ? undefined
            : 'linear-gradient(135deg, var(--org-surface, var(--color-pib-surface)) 0%, var(--org-bg, var(--color-pib-bg)) 100%)',
        }}
      >
        {blog.heroImageUrl ? (
          <PreviewImage
            src={blog.heroImageUrl}
            alt={blog.title}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              display: 'block',
            }}
          />
        ) : null}
        <span
          className="absolute top-3 left-3 text-[10px] font-label uppercase tracking-wide px-2 py-1 rounded"
          style={{ background: meta.color, color: 'var(--color-pib-text)' }}
        >
          {meta.label}
        </span>
      </div>

      {/* Body */}
      <div className="p-5 space-y-3 flex-1 flex flex-col">
        <div className="pib-label flex items-center gap-2">
          <span>{date || ' - '}</span>
          {readTime ? (
            <>
              <span aria-hidden>·</span>
              <span>{readTime} min read</span>
            </>
          ) : null}
        </div>
        <h3 className="text-lg md:text-xl font-headline leading-tight line-clamp-2">
          {blog.title}
        </h3>
        {excerpt && (
          <p className="text-sm leading-relaxed text-[var(--color-pib-text-muted)] line-clamp-3">
            {excerpt}
          </p>
        )}
        <p
          className="mt-auto text-xs font-label uppercase tracking-widest pt-1 group-hover:translate-x-0.5 transition-transform"
          style={{ color: 'var(--org-accent, var(--color-pib-accent))' }}
        >
          Read & approve →
        </p>
      </div>
    </Link>
  )
}

export default BlogPreviewCard

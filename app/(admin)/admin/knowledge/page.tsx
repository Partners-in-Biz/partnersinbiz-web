'use client'

import { KnowledgeBrowser } from '@/components/knowledge/KnowledgeBrowser'

export const dynamic = 'force-dynamic'

function AdminStubCard({ icon, title, desc, cta }: { icon: string; title: string; desc: string; cta: string }) {
  return (
    <div className="flex items-start justify-between p-4 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-card)]/70">
      <div className="flex items-start gap-3">
        <span className="material-symbols-outlined text-[20px] mt-0.5 shrink-0" style={{ color: 'var(--color-accent-v2)' }}>{icon}</span>
        <div>
          <p className="text-sm font-medium text-on-surface">{title}</p>
          <p className="text-xs text-on-surface-variant mt-0.5">{desc}</p>
        </div>
      </div>
      <button
        type="button"
        className="shrink-0 ml-4 text-xs text-on-surface-variant hover:text-on-surface px-2 py-1 rounded hover:bg-[var(--color-surface-container)] transition-colors"
      >
        {cta} →
      </button>
    </div>
  )
}

export default function AdminKnowledgePage() {
  return (
    <div className="space-y-8">
      <KnowledgeBrowser
        scope="shared"
        eyebrow="Admin workspace"
        title="Shared Knowledge"
        description="Internal Markdown knowledge shared across Pip and the wider agent team. These notes are backed by the synced Obsidian vault on the Hermes VPS."
      />

      {/* SEO & Content Management */}
      <section className="space-y-3">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">SEO &amp; Content</p>
          <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">Content Management</h2>
        </div>
        <div className="space-y-2">
          <AdminStubCard
            icon="article"
            title="SEO Content Management"
            desc="Manage SEO articles, keyword targets, and content calendar."
            cta="Open content hub"
          />
          <AdminStubCard
            icon="edit_note"
            title="SEO Article Editor"
            desc="Rich text editor for SEO blog content. Create and publish keyword-optimised articles."
            cta="New article"
          />
          <AdminStubCard
            icon="bar_chart"
            title="Content Analytics"
            desc="Traffic and engagement for platform content pages."
            cta="View analytics"
          />
          <AdminStubCard
            icon="map"
            title="Sitemap Management"
            desc="XML sitemap configuration and submission status."
            cta="Configure"
          />
        </div>
      </section>

      {/* API & Developer Docs */}
      <section className="space-y-3">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant">Developer resources</p>
          <h2 className="mt-1 text-lg font-headline font-bold text-on-surface">API Documentation</h2>
        </div>
        <AdminStubCard
          icon="api"
          title="API Documentation"
          desc="Internal API reference and endpoint documentation for /api/v1/* routes."
          cta="View docs"
        />
      </section>
    </div>
  )
}

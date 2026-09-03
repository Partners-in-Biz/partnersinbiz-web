'use client'

import { KnowledgeBrowser } from '@/components/knowledge/KnowledgeBrowser'
import { Icon } from '@/components/studio'

export const dynamic = 'force-dynamic'

function AdminStubCard({ icon, title, desc, cta }: { icon: string; title: string; desc: string; cta: string }) {
  return (
    <div className="flex items-start justify-between p-4 rounded-md border border-[var(--color-pib-line)] bg-[var(--color-pib-card)]/70">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="shrink-0 text-[var(--sc-ink-soft)]">
          <Icon name={icon} />
        </span>
        <div>
          <p className="text-sm font-medium text-[var(--color-pib-text)]">{title}</p>
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-0.5">{desc}</p>
        </div>
      </div>
      <button
        type="button"
        className="shrink-0 ml-4 text-xs text-[var(--color-pib-text-muted)] hover:text-[var(--color-pib-text)] px-2 py-1 rounded-md hover:bg-[var(--color-pib-surface-2)] transition-colors"
        aria-label={cta}
      >
        {cta}
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

      <section className="space-y-3">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">SEO and Content</p>
          <h2 className="mt-1 text-lg font-headline font-medium text-[var(--color-pib-text)]">Content Management.</h2>
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

      <section className="space-y-3">
        <div>
          <p className="text-[10px] font-label uppercase tracking-widest text-[var(--color-pib-text-muted)]">Developer resources</p>
          <h2 className="mt-1 text-lg font-headline font-medium text-[var(--color-pib-text)]">API Documentation.</h2>
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

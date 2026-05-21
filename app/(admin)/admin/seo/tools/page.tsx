'use client'

import { useState } from 'react'

const TOOLS = [
  { key: 'metadata-check', label: 'Metadata Check', input: 'url', desc: 'Audit page title, description, OG, Twitter cards', icon: 'description', tag: 'SERP' },
  { key: 'robots-check', label: 'Robots.txt Check', input: 'domain', desc: 'Validate robots.txt, flag accidental blocks', icon: 'shield', tag: 'Crawl' },
  { key: 'sitemap-check', label: 'Sitemap Check', input: 'sitemapUrl', desc: 'Count URLs, spot-check for 404s', icon: 'account_tree', tag: 'Index' },
  { key: 'canonical-check', label: 'Canonical Check', input: 'url', desc: 'Audit canonical tags', icon: 'link', tag: 'Technical' },
  { key: 'crawler-sim', label: 'Crawler Simulator', input: 'url', desc: 'See what Googlebot can render', icon: 'travel_explore', tag: 'Crawl' },
  { key: 'schema-validate', label: 'Schema Validator', input: 'url', desc: 'Validate JSON-LD against schema.org', icon: 'data_object', tag: 'Schema' },
  { key: 'keyword-density', label: 'Keyword Density', input: 'urlKeyword', desc: 'Term frequency on a page', icon: 'percent', tag: 'Content' },
  { key: 'internal-link-audit', label: 'Internal Link Audit', input: 'sitemapUrl', desc: 'Find orphan pages, score link equity', icon: 'hub', tag: 'Links' },
  { key: 'seo-roi', label: 'SEO ROI Calculator', input: 'roi', desc: 'Project organic value', icon: 'monitoring', tag: 'Value' },
  { key: 'title-generate', label: 'AI Title Generator', input: 'topicKeyword', desc: '5 SEO title options', icon: 'title', tag: 'AI' },
  { key: 'meta-generate', label: 'AI Meta Description', input: 'topicKeyword', desc: '3 meta description options', icon: 'auto_awesome', tag: 'AI' },
  { key: 'slug-generate', label: 'Slug Generator', input: 'title', desc: 'URL-safe slug from title', icon: 'tag', tag: 'URL' },
  { key: 'keyword-discover', label: 'Keyword Discovery', input: 'seedKeyword', desc: 'GSC + Autocomplete + Wikipedia', icon: 'manage_search', tag: 'Research' },
]

export default function ToolsPage() {
  const [openKey, setOpenKey] = useState<string | null>(null)
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <p className="eyebrow !text-[10px]">Admin toolkit</p>
        <h1 className="font-display text-3xl leading-tight">SEO Tools</h1>
        <p className="max-w-2xl text-sm text-[var(--color-pib-text-muted)]">
          In-house SEO toolkit. Pip uses these via the skill, but you can run them ad-hoc here too.
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {TOOLS.map((t) => (
          <ToolCard key={t.key} tool={t} expanded={openKey === t.key} onToggle={() => setOpenKey(openKey === t.key ? null : t.key)} />
        ))}
      </div>
    </div>
  )
}

interface ToolDef {
  key: string
  label: string
  input: string
  desc: string
  icon: string
  tag: string
}

function ToolCard({ tool, expanded, onToggle }: { tool: ToolDef; expanded: boolean; onToggle: () => void }) {
  const [busy, setBusy] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null)
  const [fields, setFields] = useState<Record<string, string>>({})

  async function run() {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`/api/v1/seo/tools/${tool.key}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const json = await res.json()
      setResult(json)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pib-card group p-5 space-y-4 transition-colors hover:border-[var(--color-pib-accent)] hover:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--color-pib-line)] bg-[rgba(245,166,35,0.12)] text-[var(--color-pib-accent)]">
            <span className="material-symbols-outlined text-[20px]">{tool.icon}</span>
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold leading-tight">{tool.label}</h3>
              <span className="pib-pill !px-2 !py-0.5">
                {tool.tag}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-pib-text-muted)]">{tool.desc}</p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-pib-line)] text-[var(--color-pib-text-muted)] transition-colors hover:border-[var(--color-pib-accent)] hover:text-[var(--color-pib-accent)]"
          aria-label={expanded ? `Close ${tool.label}` : `Open ${tool.label}`}
        >
          <span className="material-symbols-outlined text-[18px]">{expanded ? 'close' : 'arrow_forward'}</span>
        </button>
      </div>
      {expanded && (
        <div className="space-y-3 border-t border-[var(--color-pib-line)] pt-4">
          {fieldsFor(tool.input).map((f) => (
            <label key={f.name} className="block">
              <span className="pib-label">{f.label}</span>
              <input
                type={f.type ?? 'text'}
                value={fields[f.name] ?? ''}
                onChange={(e) => setFields({ ...fields, [f.name]: e.target.value })}
                className="pib-input text-sm"
              />
            </label>
          ))}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={run}
              disabled={busy}
              className="pib-btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin">autorenew</span>
                  Running
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                  Run tool
                </>
              )}
            </button>
          </div>
          {result && (
            <pre className="max-h-60 overflow-x-auto rounded-lg border border-[var(--color-pib-line)] bg-black/40 p-3 font-mono text-xs leading-relaxed text-[var(--color-pib-text-muted)]">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

function fieldsFor(kind: string): { name: string; label: string; type?: string }[] {
  switch (kind) {
    case 'url':
      return [{ name: 'url', label: 'Page URL' }]
    case 'domain':
      return [{ name: 'domain', label: 'Domain (no protocol)' }]
    case 'sitemapUrl':
      return [{ name: 'sitemapUrl', label: 'Sitemap URL' }]
    case 'urlKeyword':
      return [
        { name: 'url', label: 'Page URL' },
        { name: 'keyword', label: 'Keyword' },
      ]
    case 'topicKeyword':
      return [
        { name: 'topic', label: 'Topic' },
        { name: 'keyword', label: 'Keyword' },
      ]
    case 'title':
      return [{ name: 'title', label: 'Title' }]
    case 'seedKeyword':
      return [
        { name: 'seedKeywords', label: 'Seed keywords (comma-sep)' },
        { name: 'siteUrl', label: 'Your site URL' },
      ]
    case 'roi':
      return [
        { name: 'keywords', label: 'Keywords (comma)' },
        { name: 'conversionRate', label: 'Conversion rate (0.05 for 5%)' },
        { name: 'avgValue', label: 'Avg conversion value (ZAR)' },
      ]
    default:
      return [{ name: 'input', label: 'Input' }]
  }
}

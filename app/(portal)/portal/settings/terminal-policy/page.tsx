'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/AppFoundation'
import { scopedApiPath, scopeFromSearchParams } from '@/lib/portal/scoped-routing'

const DEFAULTS = ['node --version', 'npm --version', 'npm test', 'npm run lint', 'pnpm --version', 'pnpm test', 'pnpm lint', 'yarn --version', 'python3 --version', 'python --version', 'uname -a', 'which node', 'ls -la', 'git log --oneline -n 20', 'git branch --show-current']

export default function TerminalPolicyPage() {
  const params = useSearchParams(); const scope = useMemo(() => scopeFromSearchParams(params), [params])
  const api = useCallback((path: string) => scopedApiPath(path, scope), [scope])
  const [lines, setLines] = useState(DEFAULTS.join('\n')); const [message, setMessage] = useState('Loading policy…'); const [saving, setSaving] = useState(false)
  const load = useCallback(async () => {
    try {
      const response = await fetch(api('/api/v1/portal/settings/terminal-policy')); const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error ?? 'Unable to load terminal policy')
      setLines((body.data.allowedShellArgv as string[][]).map((argv) => argv.join(' ')).join('\n')); setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load terminal policy') }
  }, [api])
  useEffect(() => { void load() }, [load])
  async function save() {
    setSaving(true); setMessage('')
    try {
      const allowedShellArgv = lines.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/))
      const response = await fetch(api('/api/v1/portal/settings/terminal-policy'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowedShellArgv }) })
      const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error ?? 'Unable to save terminal policy')
      setMessage('Saved. New Workbench jobs use this policy on updated linked computers.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save terminal policy') } finally { setSaving(false) }
  }
  return <div className="mx-auto max-w-3xl space-y-6" data-module-accent="cyan">
    <PageHeader accent="cyan" eyebrow="Workspace · Security" title="Terminal command policy" description="Owner-only exact commands for the Messages Workbench on linked Macs and VPSs." />
    <section className="pib-card space-y-4 p-5"><p className="text-sm text-[var(--color-pib-text-muted)]">One exact command per line. Shells, pipes, redirects, quotes, and wildcard syntax are rejected.</p>
      <label className="block space-y-1"><span className="pib-label">Allowed commands</span><textarea aria-label="Allowed commands" value={lines} onChange={(event) => setLines(event.target.value)} className="pib-input min-h-80 w-full font-mono text-sm" spellCheck={false} /></label>
      <div className="flex justify-between gap-3"><button type="button" className="btn-pib-ghost btn-pib-sm" onClick={() => setLines(DEFAULTS.join('\n'))}>Restore safe defaults</button><button type="button" disabled={saving} className="btn-pib-primary btn-pib-sm disabled:opacity-50" onClick={() => void save()}>{saving ? 'Saving…' : 'Save policy'}</button></div>
      {message && <p role="status" className="text-sm text-[var(--color-pib-text-muted)]">{message}</p>}
    </section>
  </div>
}

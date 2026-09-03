'use client'

import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Button, Field, Notice, Panel, Textarea, Toolbar } from '@/components/studio'

const defaults = ['node --version', 'npm --version', 'npm test', 'npm run lint', 'pnpm --version', 'pnpm test', 'pnpm lint', 'yarn --version', 'python3 --version', 'python --version', 'uname -a', 'which node', 'ls -la', 'git log --oneline -n 20', 'git branch --show-current']

export default function TerminalPolicyPage() {
  const [commands, setCommands] = useState(defaults.join('\n'))
  const [message, setMessage] = useState('Loading policy…')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/v1/portal/settings/terminal-policy')
        const body = await response.json()
        if (!response.ok) throw new Error(body.error ?? 'Unable to load terminal policy')
        setCommands(body.data.allowedShellArgv.map((argv: string[]) => argv.join(' ')).join('\n'))
        setMessage('')
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load terminal policy')
        setMessage('')
      }
    })()
  }, [])

  async function save() {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const allowedShellArgv = commands.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => line.split(/\s+/))
      const response = await fetch('/api/v1/portal/settings/terminal-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedShellArgv }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'Unable to save terminal policy')
      setMessage('Saved. New Workbench jobs use this policy on updated linked computers.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save terminal policy')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title="Terminal command policy."
        description="Owner-only exact commands for the Messages Workbench on linked Macs and VPSs."
      />
      <Panel as="section" className="space-y-4">
        <p className="sc-body text-[var(--sc-ink-soft)]">
          One exact command per line. Shells, pipes, redirects, quotes, and wildcard syntax are rejected.
        </p>
        <Field id="terminal-allowed-commands" label="Allowed commands">
          <Textarea
            id="terminal-allowed-commands"
            aria-label="Allowed commands"
            value={commands}
            onChange={(event) => setCommands(event.target.value)}
            className="min-h-80 w-full font-mono text-sm"
            spellCheck={false}
          />
        </Field>
        <Toolbar className="sticky bottom-4 z-10 border border-[var(--sc-line)] bg-[var(--sc-surface)] p-4">
          <Button type="button" variant="ghost" size="sm" onClick={() => setCommands(defaults.join('\n'))}>
            Restore safe defaults
          </Button>
          <Button type="button" size="sm" loading={saving} onClick={() => void save()}>
            Save policy
          </Button>
        </Toolbar>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {message ? <Notice tone="info">{message}</Notice> : null}
      </Panel>
    </div>
  )
}

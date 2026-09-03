'use client'

import { useState } from 'react'
import { Button, Field, Input, Notice, Panel } from '@/components/studio'

export function AccessCodeForm({
  editShareToken,
  onSuccess,
}: {
  editShareToken: string
  onSuccess: () => void
}) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/public/client-documents/edit/${editShareToken}/verify-code`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code.toUpperCase() }),
        },
      )
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? 'Invalid code')
      onSuccess()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <form onSubmit={submit} className="st-stack">
        <h1 className="sc-article__h2">Enter access code.</h1>
        <p className="sc-body">Your code is in the email or message that linked you here.</p>
        <Field id="access-code" label="Access code">
          <Input
            id="access-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="XXXXXX"
            className="text-center tracking-[0.4em]"
            style={{ fontSize: '1.25rem' }}
            aria-label="Access code"
          />
        </Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" block loading={busy} disabled={busy || code.length < 6}>
          Continue
        </Button>
      </form>
    </Panel>
  )
}

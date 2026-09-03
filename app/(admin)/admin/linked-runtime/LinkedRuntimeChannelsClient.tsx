'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '@/components/ui/AppFoundation'
import { Button, Field, Input, Notice, Panel, Title } from '@/components/studio'
import type { RuntimeChannelConfig, RuntimeChannelsDocument } from '@/lib/linked-computers/runtime-config'

const EMPTY_CHANNEL: RuntimeChannelConfig = {
  hermes: { targetVersion: '', minVersion: '', targetTag: '' },
  runtimeMinVersion: '',
}

export default function LinkedRuntimeChannelsClient() {
  const [channels, setChannels] = useState<RuntimeChannelsDocument>({
    internal: EMPTY_CHANNEL,
    stable: EMPTY_CHANNEL,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/linked-runtime/channels')
      const body = await res.json() as { success?: boolean; data?: RuntimeChannelsDocument; error?: string }
      if (!res.ok || !body.data) throw new Error(body.error || 'Load failed')
      setChannels(body.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load runtime channels.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function patch(channel: 'internal' | 'stable', next: RuntimeChannelConfig) {
    setChannels((current) => ({ ...current, [channel]: next }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await fetch('/api/v1/admin/linked-runtime/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(channels),
      })
      const body = await res.json() as { success?: boolean; data?: RuntimeChannelsDocument; error?: string }
      if (!res.ok) throw new Error(body.error || 'Save failed')
      if (body.data) setChannels(body.data)
      setFeedback('Saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save runtime channels.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        eyebrow="Platform"
        title="Linked runtime channels."
        description="Hermes and runtime pins for internal staff machines and the stable public channel."
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {feedback ? <Notice tone="success">{feedback}</Notice> : null}

      <form onSubmit={save} className="space-y-6">
        <ChannelFields
          label="Internal"
          channelKey="internal"
          channel={channels.internal}
          disabled={loading || saving}
          onChange={(next) => patch('internal', next)}
        />
        <ChannelFields
          label="Stable"
          channelKey="stable"
          channel={channels.stable}
          disabled={loading || saving}
          onChange={(next) => patch('stable', next)}
        />
        <Button type="submit" disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save channels'}
        </Button>
      </form>
    </div>
  )
}

function ChannelFields({
  label,
  channelKey,
  channel,
  disabled,
  onChange,
}: {
  label: string
  channelKey: 'internal' | 'stable'
  channel: RuntimeChannelConfig
  disabled: boolean
  onChange: (next: RuntimeChannelConfig) => void
}) {
  return (
    <Panel as="section">
      <Title>{label}</Title>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id={`${channelKey}-hermes-target`} label="Hermes target version">
          <Input
            id={`${channelKey}-hermes-target`}
            aria-label="Hermes target version"
            value={channel.hermes.targetVersion}
            disabled={disabled}
            onChange={(event) => onChange({ ...channel, hermes: { ...channel.hermes, targetVersion: event.target.value } })}
          />
        </Field>
        <Field id={`${channelKey}-hermes-min`} label="Hermes min version">
          <Input
            id={`${channelKey}-hermes-min`}
            aria-label="Hermes min version"
            value={channel.hermes.minVersion}
            disabled={disabled}
            onChange={(event) => onChange({ ...channel, hermes: { ...channel.hermes, minVersion: event.target.value } })}
          />
        </Field>
        <Field id={`${channelKey}-hermes-tag`} label="Hermes target tag">
          <Input
            id={`${channelKey}-hermes-tag`}
            aria-label="Hermes target tag"
            value={channel.hermes.targetTag}
            disabled={disabled}
            onChange={(event) => onChange({ ...channel, hermes: { ...channel.hermes, targetTag: event.target.value } })}
          />
        </Field>
        <Field id={`${channelKey}-runtime-min`} label="Runtime min version">
          <Input
            id={`${channelKey}-runtime-min`}
            aria-label="Runtime min version"
            value={channel.runtimeMinVersion}
            disabled={disabled}
            onChange={(event) => onChange({ ...channel, runtimeMinVersion: event.target.value })}
          />
        </Field>
      </div>
    </Panel>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'

interface CredentialSummary {
  hasCredentials?: boolean
  accountSidMasked?: string | null
  messagingServiceSidMasked?: string | null
  apiKeySidMasked?: string | null
  twimlAppSidMasked?: string | null
  verifyServiceSidMasked?: string | null
  whatsappFrom?: string | null
  defaultFromNumber?: string | null
  voiceCallerId?: string | null
  recordCallsByDefault?: boolean
  inboundNumbers?: string[]
  capabilities?: {
    account?: boolean
    sms?: boolean
    whatsapp?: boolean
    voice?: boolean
    verify?: boolean
    lookup?: boolean
  }
  verifiedAt?: string | null
}

interface SettingsResponse {
  credential: CredentialSummary | null
  webhooks: {
    voiceUrl: string
    statusUrl: string
    recordingUrl: string
  }
  messagingWebhook: string
  smsStatusWebhook: string
  numbers: Array<{
    sid: string
    phoneNumber: string
    friendlyName: string
    capabilities: { voice?: boolean; sms?: boolean; mms?: boolean }
  }>
  setup: {
    voiceTwimlAppHint: string
    apiKeyHint: string
    verifyHint: string
  }
}

interface TwilioSettingsPanelProps {
  orgId: string
}

const EMPTY_FORM = {
  accountSid: '',
  authToken: '',
  messagingServiceSid: '',
  whatsappFrom: '',
  defaultFromNumber: '',
  voiceCallerId: '',
  apiKeySid: '',
  apiKeySecret: '',
  twimlAppSid: '',
  verifyServiceSid: '',
  recordCallsByDefault: true,
  inboundNumbers: '',
}

export function TwilioSettingsPanel({ orgId }: TwilioSettingsPanelProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/twilio/settings?orgId=${encodeURIComponent(orgId)}`)
      const body = await res.json().catch(() => ({})) as { success?: boolean; data?: SettingsResponse; error?: string }
      if (!res.ok || body.success === false) throw new Error(body.error || 'Failed to load Twilio settings')
      setData(body.data ?? null)
      const cred = body.data?.credential
      setForm((prev) => ({
        ...prev,
        whatsappFrom: cred?.whatsappFrom || '',
        defaultFromNumber: cred?.defaultFromNumber || '',
        voiceCallerId: cred?.voiceCallerId || '',
        recordCallsByDefault: cred?.recordCallsByDefault !== false,
        inboundNumbers: (cred?.inboundNumbers ?? []).join(', '),
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Twilio settings')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!orgId) return
    setSaving(true)
    setError(null)
    setFeedback(null)
    try {
      const credentials: Record<string, string> = {}
      for (const [key, value] of Object.entries(form)) {
        if (key === 'recordCallsByDefault' || key === 'inboundNumbers') continue
        if (typeof value === 'string' && value.trim()) credentials[key] = value.trim()
      }
      const res = await fetch('/api/v1/twilio/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          credentials,
          config: {
            recordCallsByDefault: form.recordCallsByDefault,
            inboundNumbers: form.inboundNumbers
              .split(/[,\n]/)
              .map((n) => n.trim())
              .filter(Boolean),
          },
        }),
      })
      const body = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
      if (!res.ok || body.success === false) throw new Error(body.error || 'Save failed')
      setFeedback('Twilio connection saved. Secrets stay encrypted for this organisation only.')
      setForm((prev) => ({
        ...prev,
        accountSid: '',
        authToken: '',
        apiKeySecret: '',
      }))
      setOpen(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const caps = data?.credential?.capabilities
  const connected = Boolean(data?.credential?.hasCredentials)

  return (
    <div className="rounded-lg border border-[var(--color-pib-line)] bg-[var(--color-pib-surface-2)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-pib-text)]">Organisation Twilio (BYOK)</p>
          <p className="mt-1 text-xs text-[var(--color-pib-text-muted)]">
            Each organisation stores its own Account SID, Auth Token, numbers, Voice API keys, and Verify service.
            Platform keys are not required once this is connected.
          </p>
        </div>
        <span className={`pill !text-[10px] !py-0.5 !px-2 ${connected ? '' : '!border-yellow-500/30 !text-yellow-300'}`}>
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">Loading…</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Account', caps?.account],
            ['SMS', caps?.sms],
            ['WhatsApp', caps?.whatsapp],
            ['Voice', caps?.voice],
            ['Verify OTP', caps?.verify],
            ['Lookup', caps?.lookup],
          ].map(([label, ready]) => (
            <div key={String(label)} className="rounded-md border border-[var(--color-pib-line)] px-3 py-2 text-xs">
              <p className="text-[var(--color-pib-text-muted)]">{label}</p>
              <p className="font-medium text-[var(--color-pib-text)]">{ready ? 'Ready' : 'Needs setup'}</p>
            </div>
          ))}
        </div>
      )}

      {data?.credential?.accountSidMasked && (
        <p className="mt-3 text-xs text-[var(--color-pib-text-muted)]">
          Account {data.credential.accountSidMasked}
          {data.credential.defaultFromNumber ? ` · SMS from ${data.credential.defaultFromNumber}` : ''}
          {data.credential.voiceCallerId ? ` · Voice from ${data.credential.voiceCallerId}` : ''}
          {data.credential.whatsappFrom ? ` · WhatsApp ${data.credential.whatsappFrom}` : ''}
        </p>
      )}

      {data?.webhooks && (
        <div className="mt-3 space-y-1 text-[11px] text-[var(--color-pib-text-muted)]">
          <p className="font-medium text-[var(--color-pib-text)]">Webhook URLs (paste into Twilio Console)</p>
          <p>Voice: <code className="break-all">{data.webhooks.voiceUrl}</code></p>
          <p>Status: <code className="break-all">{data.webhooks.statusUrl}</code></p>
          <p>Recording: <code className="break-all">{data.webhooks.recordingUrl}</code></p>
          <p>Messaging: <code className="break-all">{data.messagingWebhook}</code></p>
        </div>
      )}

      {data?.numbers && data.numbers.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-[var(--color-pib-text)]">Numbers on this Twilio account</p>
          <ul className="mt-1 space-y-1 text-xs text-[var(--color-pib-text-muted)]">
            {data.numbers.map((n) => (
              <li key={n.sid}>
                {n.phoneNumber} {n.friendlyName ? `(${n.friendlyName})` : ''}
                {' · '}
                {[n.capabilities.voice && 'voice', n.capabilities.sms && 'sms', n.capabilities.mms && 'mms']
                  .filter(Boolean)
                  .join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-[var(--st-danger)]">{error}</p>}
      {feedback && <p className="mt-3 text-xs text-green-400">{feedback}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary !text-xs"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide form' : connected ? 'Update Twilio credentials' : 'Connect Twilio'}
        </button>
        <button type="button" className="btn-ghost !text-xs" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
      </div>

      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              ['accountSid', 'Account SID (AC…)', 'text'],
              ['authToken', 'Auth Token', 'password'],
              ['messagingServiceSid', 'Messaging Service SID (MG…)', 'text'],
              ['defaultFromNumber', 'Default SMS from (E.164)', 'text'],
              ['whatsappFrom', 'WhatsApp from (E.164)', 'text'],
              ['voiceCallerId', 'Voice caller ID (E.164)', 'text'],
              ['apiKeySid', 'API Key SID (SK…)  -  Voice softphone', 'text'],
              ['apiKeySecret', 'API Key Secret', 'password'],
              ['twimlAppSid', 'TwiML App SID (AP…)', 'text'],
              ['verifyServiceSid', 'Verify Service SID (VA…)', 'text'],
            ] as const
          ).map(([key, label, type]) => (
            <label key={key} className="block text-xs">
              <span className="text-[var(--color-pib-text-muted)]">{label}</span>
              <input
                type={type}
                autoComplete="off"
                className="mt-1 h-9 w-full rounded-md border border-[var(--color-pib-line)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)]"
                value={form[key]}
                onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={connected && (key === 'authToken' || key === 'apiKeySecret') ? 'Leave blank to keep existing' : undefined}
              />
            </label>
          ))}
          <label className="block text-xs sm:col-span-2">
            <span className="text-[var(--color-pib-text-muted)]">Inbound numbers (comma-separated E.164)</span>
            <input
              type="text"
              className="mt-1 h-9 w-full rounded-md border border-[var(--color-pib-line)] bg-transparent px-2.5 text-sm text-[var(--color-pib-text)]"
              value={form.inboundNumbers}
              onChange={(e) => setForm((prev) => ({ ...prev, inboundNumbers: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input
              type="checkbox"
              checked={form.recordCallsByDefault}
              onChange={(e) => setForm((prev) => ({ ...prev, recordCallsByDefault: e.target.checked }))}
            />
            <span className="text-[var(--color-pib-text)]">Record calls by default (dual-channel) and queue transcription</span>
          </label>
          <div className="sm:col-span-2">
            <button
              type="button"
              className="btn-primary !text-xs"
              disabled={saving || (!connected && (!form.accountSid.trim() || !form.authToken.trim()))}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save Twilio connection'}
            </button>
            <p className="mt-2 text-[11px] text-[var(--color-pib-text-muted)]">
              {data?.setup.voiceTwimlAppHint} {data?.setup.apiKeyHint} {data?.setup.verifyHint}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

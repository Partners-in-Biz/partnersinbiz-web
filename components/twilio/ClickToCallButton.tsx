'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Device, Call } from '@twilio/voice-sdk'

import { Icon } from '@/components/studio'

interface ClickToCallButtonProps {
  orgId: string
  phone: string
  contactId?: string | null
  dealId?: string | null
  className?: string
  label?: string
}

type SoftphoneState = 'idle' | 'connecting' | 'open' | 'ringing' | 'open-error'

export function ClickToCallButton({
  orgId,
  phone,
  contactId,
  dealId,
  className,
  label,
}: ClickToCallButtonProps) {
  const [state, setState] = useState<SoftphoneState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const deviceRef = useRef<Device | null>(null)
  const callRef = useRef<Call | null>(null)

  const cleanup = useCallback(() => {
    try {
      callRef.current?.disconnect()
    } catch {
      // ignore
    }
    callRef.current = null
    try {
      deviceRef.current?.destroy()
    } catch {
      // ignore
    }
    deviceRef.current = null
    setState('idle')
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  async function startCall() {
    if (!orgId || !phone.trim()) return
    setError(null)
    setStatus(null)
    setState('connecting')
    try {
      const res = await fetch('/api/v1/twilio/voice/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          to: phone.trim(),
          contactId: contactId || undefined,
          dealId: dealId || undefined,
        }),
      })
      const body = await res.json().catch(() => ({})) as {
        success?: boolean
        error?: string
        data?: { token: string; callerId?: string; callId?: string }
      }
      if (!res.ok || body.success === false || !body.data?.token) {
        throw new Error(body.error || 'Could not start softphone')
      }

      const device = new Device(body.data.token, { logLevel: 1 })
      deviceRef.current = device
      await device.register()

      device.on('error', (err) => {
        setError(err.message || 'Softphone error')
        setState('open-error')
      })

      const call = await device.connect({
        params: {
          To: phone.trim(),
          to: phone.trim(),
        },
      })
      callRef.current = call
      setState('ringing')
      setStatus(`Calling ${phone.trim()} from ${body.data.callerId || 'Twilio'}…`)

      call.on('accept', () => {
        setState('open')
        setStatus('Connected')
      })
      call.on('disconnect', () => {
        setStatus('Call ended')
        cleanup()
      })
      call.on('cancel', () => {
        setStatus('Call cancelled')
        cleanup()
      })
      call.on('reject', () => {
        setStatus('Call rejected')
        cleanup()
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Call failed')
      setState('open-error')
      cleanup()
    }
  }

  function hangUp() {
    cleanup()
    setStatus('Call ended')
  }

  const busy = state === 'connecting' || state === 'ringing' || state === 'open'

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className ?? ''}`}>
      <span className="inline-flex items-center gap-2">
        {!busy ? (
          <button
            type="button"
            onClick={() => void startCall()}
            aria-label={`Call ${phone} via Twilio`}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--color-pib-text-muted)] transition hover:text-[var(--color-pib-text)]"
          >
            <span className="!h-5 !w-5 rounded-md" aria-hidden="true">
              <Icon name="ring_volume" className="text-[12px]" />
            </span>
            <span className="truncate">{label || phone}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={hangUp}
            className="inline-flex items-center gap-1 text-[11px] text-red-300 transition hover:text-red-200"
          >
            <Icon name="call_end" className="text-[14px]" />
            Hang up
          </button>
        )}
        <a
          href={`tel:${phone}`}
          aria-label={`Call ${phone} on device`}
          className="text-[10px] text-[var(--color-pib-text-muted)] underline-offset-2 hover:underline"
        >
          device
        </a>
      </span>
      {status && <span className="text-[10px] text-[var(--color-pib-text-muted)]">{status}</span>}
      {error && <span className="text-[10px] text-[var(--st-danger)]">{error}</span>}
    </span>
  )
}

'use client'

import { useEffect, useState } from 'react'
import {
  disablePush,
  getCachedPushToken,
  getPushSupport,
  requestPushPermission,
} from '@/lib/firebase/messaging'

type State =
  | { kind: 'loading' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'idle'; permission: NotificationPermission; enabled: boolean }
  | { kind: 'working' }
  | { kind: 'error'; message: string; enabled: boolean }

/**
 * Toggle for opting in/out of push notifications. Drop this anywhere a user
 * manages their preferences  -  e.g. account settings, portal sidebar.
 *
 * Note that browsers gate `Notification.requestPermission()` to user gestures,
 * so this MUST be rendered as a button the user clicks; we never auto-prompt.
 */
export function PushNotificationsToggle({ className }: { className?: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const support = await getPushSupport()
      if (cancelled) return
      if (!support.supported) {
        setState({ kind: 'unsupported', reason: support.reason })
        return
      }
      const permission =
        typeof Notification !== 'undefined' ? Notification.permission : 'default'
      const enabled = permission === 'granted' && !!getCachedPushToken()
      setState({ kind: 'idle', permission, enabled })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onEnable = async () => {
    setState({ kind: 'working' })
    const result = await requestPushPermission()
    if (result.ok) {
      setState({ kind: 'idle', permission: 'granted', enabled: true })
    } else {
      const messages: Record<string, string> = {
        denied: 'Permission denied. Enable notifications for this site in your browser settings.',
        dismissed: 'Notification permission was dismissed.',
        unsupported: 'This browser does not support web push.',
        'no-vapid': 'Push is not configured on this site (missing VAPID key).',
        error: result.error ?? 'Something went wrong enabling push.',
      }
      const enabled = false
      setState({ kind: 'error', message: messages[result.reason] ?? 'Push setup failed.', enabled })
    }
  }

  const onDisable = async () => {
    setState({ kind: 'working' })
    await disablePush()
    setState({ kind: 'idle', permission: 'default', enabled: false })
  }

  if (state.kind === 'loading') {
    return (
      <div className={className}>
        <div className="text-xs text-[var(--color-pib-text-muted)]">Checking push support...</div>
      </div>
    )
  }

  if (state.kind === 'unsupported') {
    return (
      <div className={className}>
        <p className="text-sm font-medium">Push notifications</p>
        <p className="text-xs text-[var(--pib-muted)] mt-1">
          {state.reason === 'no-vapid'
            ? 'Push is not configured for this environment yet.'
            : 'Your current browser does not support push notifications. Try Chrome, Edge, Firefox, or Safari 16.4+.'}
        </p>
      </div>
    )
  }

  const enabled =
    state.kind === 'working' ? false : state.kind === 'error' ? state.enabled : state.enabled
  const working = state.kind === 'working'

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Push notifications</p>
          <p className="text-xs text-[var(--color-pib-text-muted)] mt-1">
            Get notified about new messages, approvals and invoices on this device.
          </p>
        </div>
        <button
          type="button"
          onClick={enabled ? onDisable : onEnable}
          disabled={working}
          className={[
            enabled ? 'pib-btn-secondary' : 'pib-btn-primary',
            'shrink-0 !px-3 !py-1.5 !text-xs disabled:opacity-50',
          ].join(' ')}
        >
          {working ? '...' : enabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      {state.kind === 'error' && (
        <p className="text-xs text-[var(--st-danger)] mt-2">{state.message}</p>
      )}
    </div>
  )
}

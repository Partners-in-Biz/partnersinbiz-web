'use client'

import { useState } from 'react'
import { appendQueryParams } from '@/lib/portal/scoped-routing'

interface SendToYouTubeStudioButtonProps {
  orgId?: string | null
  title: string
  sourceUrl?: string
  fileId?: string
  mediaFormat?: 'horizontal' | 'vertical' | 'square'
  origin: { type: 'campaign' | 'social_post'; id: string }
  className?: string
}

type SendState = 'idle' | 'sending' | 'sent' | 'no_channel' | 'error'

/**
 * Looks up the org's linked channel workspaces and imports campaign/social video
 * media into the first connected YouTube Studio channel.
 */
export function SendToYouTubeStudioButton({
  orgId,
  title,
  sourceUrl,
  fileId,
  mediaFormat,
  origin,
  className = '',
}: SendToYouTubeStudioButtonProps) {
  const [state, setState] = useState<SendState>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  async function send() {
    if (state === 'sending' || state === 'sent') return
    setState('sending')
    setErrorMessage('')
    try {
      const linksRes = await fetch(appendQueryParams('/api/v1/youtube-studio/channels/links', { orgId }))
      const linksBody = await linksRes.json().catch(() => ({}))
      const links: Array<{ channelWorkspaceId: string; accountStatus: string }> =
        Array.isArray(linksBody.data?.links) ? linksBody.data.links : []
      const target = links.find((link) => link.accountStatus === 'connected') ?? links[0]
      if (!target) {
        setState('no_channel')
        return
      }

      const res = await fetch(appendQueryParams('/api/v1/youtube-studio/videos/import', { orgId }), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelWorkspaceId: target.channelWorkspaceId,
          title,
          sourceUrl,
          fileId,
          mediaFormat,
          origin,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMessage(body.error ?? 'Could not send to YouTube Studio')
        setState('error')
        return
      }
      setState('sent')
    } catch {
      setErrorMessage('Could not send to YouTube Studio')
      setState('error')
    }
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === 'sending' || state === 'sent'}
        className="pib-btn-ghost text-xs"
      >
        {state === 'sending' ? 'Sending...' : '-> YouTube Studio'}
      </button>
      {state === 'sent' ? <span className="text-xs text-emerald-300">Sent to YouTube Studio</span> : null}
      {state === 'no_channel' ? (
        <span className="text-xs text-[var(--sc-ink-soft)]">No YouTube channel connected - link one in YouTube Studio first.</span>
      ) : null}
      {state === 'error' ? <span className="text-xs text-red-300">{errorMessage}</span> : null}
    </span>
  )
}

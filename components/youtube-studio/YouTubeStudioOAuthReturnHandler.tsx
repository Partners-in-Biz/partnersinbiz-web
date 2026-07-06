'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'

const OAUTH_RETURN_PARAMS = ['status', 'platform', 'account', 'message', 'provision'] as const

interface YouTubeStudioOAuthReturnHandlerProps {
  /** Reload the workspace data after a connection result lands. */
  onRefresh: () => void
  /** Called with the connected social account id when provisioning failed
   *  (account saved, channel workspace missing) so the UI can offer a retry
   *  via POST /api/v1/youtube-studio/channels/adopt. */
  onProvisionFailed: (accountId: string) => void
}

/**
 * Reads the OAuth return params the social callback appends to the redirect
 * (status/platform/account/provision/message), fires a toast, strips the
 * params from the URL, and refreshes the studio data. Render inside
 * <Suspense> -- useSearchParams requires a suspense boundary.
 */
export function YouTubeStudioOAuthReturnHandler({ onRefresh, onProvisionFailed }: YouTubeStudioOAuthReturnHandlerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { success, error } = useToast()
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    const status = searchParams?.get('status')
    if (status !== 'success' && status !== 'error') return
    handledRef.current = true

    if (status === 'success') {
      if (searchParams?.get('provision') === 'failed') {
        error('YouTube account connected, but channel setup is incomplete. Retry the channel setup from the sidebar.')
        const accountId = searchParams?.get('account')
        if (accountId) onProvisionFailed(accountId)
      } else {
        success('YouTube channel linked. It now appears in your channel list.')
      }
    } else {
      error(searchParams?.get('message') ?? 'YouTube connection failed. Please try again.')
    }

    const next = new URLSearchParams(searchParams?.toString() ?? '')
    for (const key of OAUTH_RETURN_PARAMS) next.delete(key)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    onRefresh()
  }, [searchParams, pathname, router, success, error, onRefresh, onProvisionFailed])

  return null
}

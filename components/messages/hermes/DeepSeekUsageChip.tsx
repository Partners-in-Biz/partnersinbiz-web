'use client'

import { useCallback, useEffect, useState } from 'react'
import { HudChip } from '@/components/ui/HudChip'
import {
  buildDeepSeekUsageAdvisory,
  type DeepSeekUsageAdvisory,
} from '@/lib/llm-providers/deepseek-usage'
import { listLlmProviderCatalog } from '@/lib/llm-providers/client'

/**
 * Compact DeepSeek peak/off-peak chip for the Messages topbar constellation
 * (beside Live / Panes / Tabs). Only renders when the org or current user has
 * a connected DeepSeek API key.
 */
export function DeepSeekUsageChip({ orgId }: { orgId: string }) {
  const [advisory, setAdvisory] = useState<DeepSeekUsageAdvisory | null>(null)
  const [visible, setVisible] = useState(false)

  const refresh = useCallback(async () => {
    if (!orgId) {
      setVisible(false)
      setAdvisory(null)
      return
    }
    try {
      const data = await listLlmProviderCatalog(orgId)
      const hasDeepseek = (data.connections || []).some(
        (connection) =>
          connection.status === 'connected'
          && connection.hasCredentials
          && (connection.provider === 'deepseek' || connection.hermesProvider === 'deepseek'),
      )
      if (!hasDeepseek) {
        setVisible(false)
        setAdvisory(null)
        return
      }
      setAdvisory(buildDeepSeekUsageAdvisory())
      setVisible(true)
    } catch {
      // Non-blocking HUD chip - stay quiet on catalogue failures.
      setVisible(false)
    }
  }, [orgId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      // Re-evaluate peak window every minute without re-fetching credentials.
      setAdvisory((current) => (current ? buildDeepSeekUsageAdvisory() : current))
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  if (!visible || !advisory) return null

  const peak = advisory.phase === 'peak'

  return (
    <HudChip
      data-testid="messages-deepseek-usage-chip"
      tone={peak ? 'warning' : 'success'}
      live={!peak}
      title={advisory.detail}
      className="max-w-[14rem] truncate"
    >
      <span className="truncate">
        {advisory.chipLabel}
        {' · '}
        <strong className="font-medium">{peak ? '2× window' : 'best time'}</strong>
      </span>
    </HudChip>
  )
}

export default DeepSeekUsageChip

// lib/analytics/attribution-compute.ts (US-146)
//
// Multi-touch attribution over real product_sessions. Each conversion
// (a session whose distinctId reached a goal event) is credited back across
// the ordered touchpoints (sessions) that preceded it, per the chosen model.

import type { AttributionModel, Touchpoint } from './types'

export interface ConversionJourney {
  distinctId: string
  userId: string | null
  touchpoints: Touchpoint[]
  convertedAt: number
  /** revenue/value credited to this conversion (>=1, defaults to 1 conversion) */
  value: number
}

export interface ChannelCredit {
  channel: string        // "source / medium"
  source: string
  medium: string
  conversions: number    // fractional credit summed
  value: number          // fractional value credited
}

export interface ConversionPath {
  path: string           // "a → b → c" of source/medium
  count: number
  value: number
}

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000 // 7-day half-life for time-decay

function channelKey(t: Touchpoint): string {
  return `${t.source || '(direct)'} / ${t.medium || '(none)'}`
}

/** Weight each touchpoint per the model. Weights sum to 1. */
function weights(model: AttributionModel, tps: Touchpoint[], convertedAt: number): number[] {
  const n = tps.length
  if (n === 0) return []
  if (n === 1) return [1]
  switch (model) {
    case 'first':
      return tps.map((_, i) => (i === 0 ? 1 : 0))
    case 'last':
      return tps.map((_, i) => (i === n - 1 ? 1 : 0))
    case 'linear':
      return tps.map(() => 1 / n)
    case 'time_decay': {
      const raw = tps.map(t => Math.pow(2, -(convertedAt - t.timestamp) / HALF_LIFE_MS))
      const sum = raw.reduce((a, b) => a + b, 0) || 1
      return raw.map(r => r / sum)
    }
  }
}

export function computeAttribution(
  journeys: ConversionJourney[],
  model: AttributionModel,
): { channels: ChannelCredit[]; paths: ConversionPath[] } {
  const channelMap = new Map<string, ChannelCredit>()
  const pathMap = new Map<string, ConversionPath>()

  for (const j of journeys) {
    if (j.touchpoints.length === 0) continue
    const w = weights(model, j.touchpoints, j.convertedAt)
    j.touchpoints.forEach((tp, i) => {
      const key = channelKey(tp)
      const c = channelMap.get(key) ?? {
        channel: key,
        source: tp.source || '(direct)',
        medium: tp.medium || '(none)',
        conversions: 0,
        value: 0,
      }
      c.conversions += w[i]
      c.value += w[i] * j.value
      channelMap.set(key, c)
    })

    const pathStr = j.touchpoints.map(channelKey).join(' → ')
    const p = pathMap.get(pathStr) ?? { path: pathStr, count: 0, value: 0 }
    p.count += 1
    p.value += j.value
    pathMap.set(pathStr, p)
  }

  const channels = [...channelMap.values()]
    .map(c => ({ ...c, conversions: Math.round(c.conversions * 100) / 100, value: Math.round(c.value * 100) / 100 }))
    .sort((a, b) => b.conversions - a.conversions)

  const paths = [...pathMap.values()].sort((a, b) => b.count - a.count)

  return { channels, paths }
}

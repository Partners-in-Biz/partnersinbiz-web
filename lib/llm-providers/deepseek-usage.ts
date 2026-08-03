/**
 * DeepSeek peak / off-peak usage windows for Messages HUD.
 * Source: DeepSeek API pricing notice — peak hours UTC 01:00–04:00 and 06:00–10:00
 * (UTC+8: 09:00–12:00 and 14:00–18:00). Peak rates are twice regular when the
 * policy is active; effective date is subject to DeepSeek official notice.
 */

export const DEEPSEEK_PEAK_WINDOWS_UTC: ReadonlyArray<{ startHour: number; endHour: number }> = [
  { startHour: 1, endHour: 4 },
  { startHour: 6, endHour: 10 },
]

export const DEEPSEEK_USAGE_DOCS_URL = 'https://api-docs.deepseek.com/quick_start/pricing/'

export type DeepSeekUsagePhase = 'peak' | 'off_peak'

export interface DeepSeekUsageAdvisory {
  provider: 'deepseek'
  phase: DeepSeekUsagePhase
  /** Short chip label for the Messages topbar. */
  chipLabel: string
  /** One-line HUD summary next to Live / Panes / Tabs. */
  summary: string
  /** Longer tooltip / title text. */
  detail: string
  /** UTC windows as human text. */
  peakWindowsUtcLabel: string
  /** Local-friendly note for South Africa / Europe operators reading UTC+8 map. */
  peakWindowsUtcPlus8Label: string
  /** ISO timestamp used for the phase evaluation. */
  evaluatedAt: string
  docsUrl: string
  /** True when DeepSeek says peak pricing multiplies all billing items by ~2×. */
  peakMultiplier: number
  /** Policy may not be live yet — always surface as advisory, not a hard block. */
  policyNote: string
}

function hourInUtc(date: Date): number {
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
}

/** True when `date` falls inside any official DeepSeek peak window (UTC). End hour is exclusive. */
export function isDeepSeekPeakUtc(date: Date = new Date()): boolean {
  const hour = hourInUtc(date)
  return DEEPSEEK_PEAK_WINDOWS_UTC.some(({ startHour, endHour }) => hour >= startHour && hour < endHour)
}

export function deepSeekPeakWindowsUtcLabel(): string {
  return 'UTC 01:00–04:00 and 06:00–10:00'
}

export function deepSeekPeakWindowsUtcPlus8Label(): string {
  return 'UTC+8 09:00–12:00 and 14:00–18:00'
}

export function buildDeepSeekUsageAdvisory(now: Date = new Date()): DeepSeekUsageAdvisory {
  const peak = isDeepSeekPeakUtc(now)
  const peakWindowsUtcLabel = deepSeekPeakWindowsUtcLabel()
  const peakWindowsUtcPlus8Label = deepSeekPeakWindowsUtcPlus8Label()
  const policyNote =
    'DeepSeek peak-valley pricing (peak ≈ 2× regular on all billing items) applies when their official notice is in effect. Prefer Flash off-peak for bulk work.'

  if (peak) {
    return {
      provider: 'deepseek',
      phase: 'peak',
      chipLabel: 'DeepSeek peak',
      summary: 'Peak window · prefer off-peak for bulk',
      detail: `DeepSeek is in a peak pricing window now (${peakWindowsUtcLabel}). Peak rates can be twice regular. Prefer deepseek-v4-flash for routine work, or wait for off-peak. ${policyNote}`,
      peakWindowsUtcLabel,
      peakWindowsUtcPlus8Label,
      evaluatedAt: now.toISOString(),
      docsUrl: DEEPSEEK_USAGE_DOCS_URL,
      peakMultiplier: 2,
      policyNote,
    }
  }

  return {
    provider: 'deepseek',
    phase: 'off_peak',
    chipLabel: 'DeepSeek off-peak',
    summary: 'Off-peak · best time to run',
    detail: `DeepSeek is off-peak right now. Best window for heavier Flash/Pro usage. Peak hours: ${peakWindowsUtcLabel} (${peakWindowsUtcPlus8Label}). ${policyNote}`,
    peakWindowsUtcLabel,
    peakWindowsUtcPlus8Label,
    evaluatedAt: now.toISOString(),
    docsUrl: DEEPSEEK_USAGE_DOCS_URL,
    peakMultiplier: 2,
    policyNote,
  }
}

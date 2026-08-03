import {
  buildDeepSeekUsageAdvisory,
  isDeepSeekPeakUtc,
} from '@/lib/llm-providers/deepseek-usage'
import { getLlmProvider, listLlmProviders } from '@/lib/llm-providers/providers'
import { inferHermesProviderFromModel } from '@/lib/projects/task-llm'

describe('DeepSeek LLM provider catalogue', () => {
  it('registers DeepSeek with Flash first and DEEPSEEK_API_KEY', () => {
    const keys = listLlmProviders().map((p) => p.key)
    expect(keys).toContain('deepseek')
    const deepseek = getLlmProvider('deepseek')
    expect(deepseek?.envVar).toBe('DEEPSEEK_API_KEY')
    expect(deepseek?.hermesProvider).toBe('deepseek')
    expect(deepseek?.authKind).toBe('api_key')
    expect(deepseek?.curatedModels[0]).toBe('deepseek-v4-flash')
    expect(deepseek?.curatedModels).toEqual(expect.arrayContaining([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-chat',
      'deepseek-reasoner',
    ]))
  })

  it('infers deepseek provider from model ids', () => {
    expect(inferHermesProviderFromModel('deepseek-v4-flash')).toBe('deepseek')
    expect(inferHermesProviderFromModel('deepseek-v4-pro')).toBe('deepseek')
  })
})

describe('DeepSeek peak/off-peak usage windows', () => {
  it('marks UTC peak windows (01-04 and 06-10) as peak', () => {
    expect(isDeepSeekPeakUtc(new Date('2026-08-03T02:30:00.000Z'))).toBe(true)
    expect(isDeepSeekPeakUtc(new Date('2026-08-03T07:00:00.000Z'))).toBe(true)
    expect(isDeepSeekPeakUtc(new Date('2026-08-03T05:30:00.000Z'))).toBe(false)
    expect(isDeepSeekPeakUtc(new Date('2026-08-03T12:00:00.000Z'))).toBe(false)
  })

  it('builds advisory copy for peak and off-peak', () => {
    const peak = buildDeepSeekUsageAdvisory(new Date('2026-08-03T03:00:00.000Z'))
    expect(peak.phase).toBe('peak')
    expect(peak.chipLabel).toMatch(/peak/i)
    expect(peak.peakMultiplier).toBe(2)
    expect(peak.detail).toMatch(/01:00/)

    const off = buildDeepSeekUsageAdvisory(new Date('2026-08-03T15:00:00.000Z'))
    expect(off.phase).toBe('off_peak')
    expect(off.chipLabel).toMatch(/off-peak/i)
    expect(off.summary.toLowerCase()).toContain('off-peak')
  })
})

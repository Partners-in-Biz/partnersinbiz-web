import { YOUTUBE_PRODUCTION_SKILLS, getYouTubeSkillContract } from '@/lib/youtube-studio/skills'

describe('youtube studio production skill registry', () => {
  it('keeps the Hermes production skills unique and review gated', () => {
    const keys = YOUTUBE_PRODUCTION_SKILLS.map((skill) => skill.key)

    expect(keys).toHaveLength(16)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('youtube-publish-readiness')
    expect(keys).toContain('youtube-ai-disclosure-check')
    expect(keys).toContain('youtube-retention-review')
    expect(YOUTUBE_PRODUCTION_SKILLS.every((skill) => skill.defaultReviewRequired)).toBe(true)
  })

  it('documents the requested YouTube AI production workflow outputs', () => {
    const labels = YOUTUBE_PRODUCTION_SKILLS.map((skill) => skill.label)

    expect(labels).toEqual(expect.arrayContaining([
      'Channel strategy',
      'Video ideation',
      'Research brief',
      'Script drafting',
      'Clipping plan',
      'Caption generation',
      'Thumbnail brief',
      'Title/description/tags',
      'Chapters',
      'Compliance/readiness',
      'Analytics diagnosis',
      'Next-series planning',
    ]))
    expect(YOUTUBE_PRODUCTION_SKILLS.every((skill) => skill.outputArtifacts.length > 0)).toBe(true)
    expect(YOUTUBE_PRODUCTION_SKILLS.every((skill) => skill.outputPersistence.match(/artifacts.*comments.*actor metadata/i))).toBe(true)
    expect(YOUTUBE_PRODUCTION_SKILLS.every((skill) => skill.mutationPolicy.match(/Review-only/i))).toBe(true)
  })

  it('anchors risky publishing and disclosure skills to explicit guardrails', () => {
    const readiness = getYouTubeSkillContract('youtube-publish-readiness')
    const disclosure = getYouTubeSkillContract('youtube-ai-disclosure-check')

    expect(readiness?.guardrails.join(' ')).toMatch(/No autonomous public publishing/i)
    expect(readiness?.guardrails.join(' ')).toMatch(/Private-first/i)
    expect(readiness?.policySourceKeys).toContain('youtube_data_api_upload_private_first')
    expect(readiness?.policySourceKeys).toContain('youtube_api_quota_compliance')
    expect(disclosure?.policySourceKeys).toContain('youtube_altered_synthetic_disclosure')
    expect(disclosure?.guardrails.join(' ')).toMatch(/Never suppress/i)
  })
})

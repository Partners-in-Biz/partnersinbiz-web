import {
  buildDesignContextRecord,
  hasDesignContextFacts,
  normalizeDesignContextPayload,
} from '@/lib/research/design-context'

describe('design-context normalization', () => {
  it('cleans and shapes a questionnaire payload', () => {
    const payload = normalizeDesignContextPayload({
      audience: '  Small law firms  ',
      positioning: 'Modern trust',
      brandVoice: 'Clear, calm, confident.',
      antiReferences: [' purple gradients ', 'glassmorphism', 'purple gradients'],
      palette: [
        { name: 'primary', value: '#0F172A' },
        { name: 'accent', value: '#F59E0B', usage: 'CTA buttons' },
      ],
      typeStack: [
        { role: 'heading', family: 'Fraunces' },
        { role: 'body', family: 'Inter' },
      ],
      componentRules: ['Sharp corners', 'Dense tables'],
      radiusScale: [{ name: 'sm', value: '4px' }],
      elevationScale: [{ name: 'md', value: '0 1px 3px rgba(0,0,0,0.1)' }],
      surfaceModes: [{ surface: 'landing', mode: 'persuade' }],
    })

    expect(payload.audience).toBe('Small law firms')
    expect(payload.antiReferences).toEqual(['purple gradients', 'glassmorphism'])
    expect(payload.palette).toHaveLength(2)
    expect(payload.palette[0]).toMatchObject({ name: 'primary', value: '#0F172A' })
    expect(payload.surfaceModes[0]).toMatchObject({ surface: 'landing', mode: 'persuade' })
    expect(hasDesignContextFacts(payload)).toBe(true)
  })

  it('rejects unknown surface modes and type roles', () => {
    const payload = normalizeDesignContextPayload({
      audience: 'x',
      surfaceModes: [{ surface: 'landing', mode: 'bogus' }],
      typeStack: [{ role: 'fancy', family: 'X' }],
    })
    expect(payload.surfaceModes).toHaveLength(0)
    expect(payload.typeStack).toHaveLength(0)
    expect(hasDesignContextFacts(payload)).toBe(true)
  })

  it('reports empty payload as no facts', () => {
    expect(hasDesignContextFacts(normalizeDesignContextPayload({}))).toBe(false)
  })
})

describe('design-context versioning', () => {
  it('starts at version 1 with empty history', () => {
    const record = buildDesignContextRecord({
      payload: normalizeDesignContextPayload({ audience: 'First' }),
      source: 'questionnaire',
    })
    expect(record.version).toBe(1)
    expect(record.history).toEqual([])
    expect(record.source).toBe('questionnaire')
  })

  it('bumps version and pushes previous payload into history', () => {
    const first = buildDesignContextRecord({
      payload: normalizeDesignContextPayload({ audience: 'First', palette: [{ name: 'primary', value: '#111' }] }),
      source: 'questionnaire',
      updatedBy: 'user-1',
    })
    const second = buildDesignContextRecord({
      payload: normalizeDesignContextPayload({ audience: 'Second', palette: [{ name: 'primary', value: '#222' }] }),
      source: 'style-scan',
      sourceUrl: 'https://example.com',
      previous: first,
      updatedBy: 'agent-1',
    })
    expect(second.version).toBe(2)
    expect(second.source).toBe('style-scan')
    expect(second.sourceUrl).toBe('https://example.com')
    expect(second.history).toHaveLength(1)
    expect(second.history[0]).toMatchObject({ version: 1, source: 'questionnaire' })
    expect(second.history[0]?.payload).toMatchObject({ audience: 'First' })
  })

  it('caps history at DESIGN_HISTORY_CAP entries', () => {
    let previous: ReturnType<typeof buildDesignContextRecord> | null = null
    for (let i = 1; i <= 15; i += 1) {
      previous = buildDesignContextRecord({
        payload: normalizeDesignContextPayload({ audience: `v${i}` }),
        source: 'manual',
        previous,
      })
    }
    expect(previous!.version).toBe(15)
    expect(previous!.history).toHaveLength(10)
  })
})

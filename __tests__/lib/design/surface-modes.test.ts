import {
  SURFACE_MODES,
  SURFACE_MODE_STANDARDS,
  buildSurfaceModePromptBlock,
  isSurfaceMode,
  surfaceModeLabel,
} from '@/lib/design/surface-modes'

describe('lib/design/surface-modes', () => {
  it('defines exactly the four Impeccable surface modes', () => {
    expect(SURFACE_MODES).toEqual(['persuade', 'operate', 'read', 'experience'])
  })

  it('validates surface mode values', () => {
    expect(isSurfaceMode('persuade')).toBe(true)
    expect(isSurfaceMode('operate')).toBe(true)
    expect(isSurfaceMode('read')).toBe(true)
    expect(isSurfaceMode('experience')).toBe(true)
    expect(isSurfaceMode('landing')).toBe(false)
    expect(isSurfaceMode(undefined)).toBe(false)
    expect(isSurfaceMode(null)).toBe(false)
    expect(isSurfaceMode('')).toBe(false)
  })

  it('has a complete standards catalog with labels, priorities and anti-patterns', () => {
    for (const mode of SURFACE_MODES) {
      const standard = SURFACE_MODE_STANDARDS[mode]
      expect(standard.label.length).toBeGreaterThan(0)
      expect(standard.mission.length).toBeGreaterThan(0)
      expect(standard.priorities.length).toBeGreaterThanOrEqual(3)
      expect(standard.antiPatterns.length).toBeGreaterThanOrEqual(1)
    }
    expect(surfaceModeLabel('persuade')).toBe('Persuade')
    expect(surfaceModeLabel('operate')).toBe('Operate')
    expect(surfaceModeLabel('read')).toBe('Read')
    expect(surfaceModeLabel('experience')).toBe('Experience')
  })

  it('builds a mode-standard prompt block for valid modes', () => {
    const block = buildSurfaceModePromptBlock('operate')
    expect(block).toContain('## Surface mode: Operate')
    expect(block).toContain('disappears into the task')
    expect(block).toContain('Priorities:')
    expect(block).toContain('Avoid:')
  })

  it('builds a persuade block that mentions earning attention', () => {
    const block = buildSurfaceModePromptBlock('persuade')
    expect(block).toContain('## Surface mode: Persuade')
    expect(block).toContain('earns attention')
  })

  it('returns empty string for unknown modes', () => {
    expect(buildSurfaceModePromptBlock('bogus')).toBe('')
    expect(buildSurfaceModePromptBlock(undefined)).toBe('')
    expect(buildSurfaceModePromptBlock(null)).toBe('')
    expect(buildSurfaceModePromptBlock('')).toBe('')
  })
})

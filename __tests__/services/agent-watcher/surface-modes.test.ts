import {
  SURFACE_MODES,
  buildSurfaceModePromptBlock,
  isSurfaceMode,
} from '../../../services/agent-watcher/src/surface-modes'

describe('agent-watcher surface-modes prompt block', () => {
  it('defines the four modes and validates', () => {
    expect(SURFACE_MODES).toEqual(['persuade', 'operate', 'read', 'experience'])
    expect(isSurfaceMode('experience')).toBe(true)
    expect(isSurfaceMode('bogus')).toBe(false)
    expect(isSurfaceMode(undefined)).toBe(false)
  })

  it('builds a prompt block for each valid mode', () => {
    for (const mode of SURFACE_MODES) {
      const block = buildSurfaceModePromptBlock(mode)
      expect(block).toContain(`## Surface mode:`)
      expect(block).toContain('Priorities:')
      expect(block).toContain('Avoid:')
    }
  })

  it('returns empty string for unknown modes', () => {
    expect(buildSurfaceModePromptBlock('landing')).toBe('')
    expect(buildSurfaceModePromptBlock(null)).toBe('')
    expect(buildSurfaceModePromptBlock('')).toBe('')
  })
})

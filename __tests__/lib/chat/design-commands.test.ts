import {
  DESIGN_COMMANDS,
  DESIGN_COMMAND_IDS,
  buildDesignCommandGuidance,
  getDesignCommandById,
  getDesignCommandByToken,
  isDesignCommandId,
  renderDesignContextPayload,
  type DesignCommandDefinition,
} from '@/lib/chat/design-commands'
import { SLASH_COMMANDS, getSlashCommandByToken, slashCommandInstruction, type SlashCommandPayload } from '@/lib/chat/slash-commands'
import { slashCommandAccessTier } from '@/lib/chat/slash-command-access'

describe('design-commands vocabulary', () => {
  it('exposes all 11 named commands', () => {
    expect(DESIGN_COMMAND_IDS).toEqual([
      'polish',
      'typeset',
      'layout',
      'colorize',
      'bolder',
      'quieter',
      'distill',
      'clarify',
      'harden',
      'audit',
      'critique',
    ])
  })

  it('every command has a token, scope, prompt template, and icon', () => {
    for (const command of DESIGN_COMMANDS) {
      expect(command.token.startsWith('/')).toBe(true)
      expect(['type', 'layout', 'all']).toContain(command.scope)
      expect(command.promptTemplate.length).toBeGreaterThan(0)
      expect(command.icon).toBeTruthy()
      expect(command.label).toBeTruthy()
    }
  })

  it('resolves commands by id and token (including aliases)', () => {
    expect(getDesignCommandById('polish')?.token).toBe('/polish')
    expect(getDesignCommandById('nope')).toBeNull()
    expect(getDesignCommandByToken('/typeset')?.id).toBe('typeset')
    expect(getDesignCommandByToken('/typography')?.id).toBe('typeset')
    expect(getDesignCommandByToken('/layout')?.id).toBe('layout')
    expect(getDesignCommandByToken('/spacing')?.id).toBe('layout')
    expect(getDesignCommandByToken('polish')).toBeNull()
    expect(isDesignCommandId('audit')).toBe(true)
    expect(isDesignCommandId('goal')).toBe(false)
  })

  it('maps every command into the Messages slash registry as design_command', () => {
    for (const command of DESIGN_COMMANDS) {
      const def = getSlashCommandByToken(command.token)
      expect(def).not.toBeNull()
      expect(def?.executorKind).toBe('design_command')
    }
    const slashIds = SLASH_COMMANDS.map((c) => c.id)
    for (const id of DESIGN_COMMAND_IDS) expect(slashIds).toContain(id)
  })

  it('design commands are public-tier access (no operator gate)', () => {
    for (const command of DESIGN_COMMANDS) {
      expect(slashCommandAccessTier(command.id)).toBe('public')
    }
  })
})

describe('buildDesignCommandGuidance', () => {
  it('emits discipline, T1 scope, and T3 design-context requirements', () => {
    const lines = buildDesignCommandGuidance({
      id: 'polish',
      token: '/polish',
      label: 'Polish',
      args: 'the pricing page',
    })
    const block = lines.join('\n')
    expect(block).toContain('[Design command]')
    expect(block).toContain('command: Polish (/polish)')
    expect(block).toContain('detector scope: all')
    expect(block).toContain('Design Context (T3)')
    expect(block).toContain('Detector (T1) BEFORE')
    expect(block).toContain('Detector (T1) AFTER')
    expect(block).toContain('target: the pricing page')
  })

  it('typeset narrows to type scope, layout to layout scope', () => {
    const typeset = buildDesignCommandGuidance({ id: 'typeset', token: '/typeset', label: 'Typeset' })
    expect(typeset.join('\n')).toContain('detector scope: type (--scope type')
    const layout = buildDesignCommandGuidance({ id: 'layout', token: '/layout', label: 'Layout' })
    expect(layout.join('\n')).toContain('detector scope: layout (--scope layout')
  })

  it('returns empty for unknown command', () => {
    expect(buildDesignCommandGuidance({ id: 'bogus', token: '/bogus', label: 'Bogus' })).toEqual([])
  })

  it('is wired through slashCommandInstruction for design_command payloads', () => {
    const payload: SlashCommandPayload = {
      id: 'audit',
      token: '/audit',
      label: 'Audit',
      executorKind: 'design_command',
      args: 'the dashboard',
    }
    const instruction = slashCommandInstruction(payload)
    expect(instruction).toContain('[Design command]')
    expect(instruction).toContain('Detector (T1) BEFORE')
    expect(instruction).toContain('target: the dashboard')
    // The generic agent_intent prose must not appear for design commands
    expect(instruction).not.toContain('Treat this as structured command intent')
  })
})

describe('renderDesignContextPayload', () => {
  it('renders a T3 payload into a compact prompt block', () => {
    const block = renderDesignContextPayload({
      audience: 'Small business owners',
      positioning: 'Friendly, fast accounting',
      brandVoice: 'Direct and warm',
      palette: [{ name: 'Primary', value: '#0F172A' }],
      typeStack: [{ role: 'display', family: 'Space Grotesk' }],
      version: 3,
    })
    expect(block).toContain('[Client Design Context (T3)]')
    expect(block).toContain('audience: Small business owners')
    expect(block).toContain('palette: Primary · #0F172A')
    expect(block).toContain('version: 3')
  })

  it('returns fallback for empty or missing payloads', () => {
    expect(renderDesignContextPayload(null)).toBe('')
    expect(renderDesignContextPayload({})).toBe('')
    expect(renderDesignContextPayload({ audience: '' })).toBe('')
    expect(renderDesignContextPayload(undefined, 'FALLBACK')).toBe('FALLBACK')
  })

  it('never throws on weird shapes', () => {
    expect(() => renderDesignContextPayload({ palette: 'not-an-array' })).not.toThrow()
    expect(() => renderDesignContextPayload({ typeStack: [{ role: 42 }] })).not.toThrow()
    expect(() => renderDesignContextPayload('string')).not.toThrow()
  })
})

describe('design command definitions shape', () => {
  it('each definition matches the SlashCommandDefinition-compatible surface', () => {
    const sample: DesignCommandDefinition = DESIGN_COMMANDS[0]!
    expect(sample.id).toBeTruthy()
    expect(sample.aliases).toBeInstanceOf(Array)
    expect(sample.category).toBeTruthy()
    expect(['evaluate', 'refine', 'simplify', 'harden']).toContain(sample.category)
  })
})

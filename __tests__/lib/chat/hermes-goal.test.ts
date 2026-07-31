import {
  advanceGoalAfterTurn,
  applyGoalControl,
  applySubgoalControl,
  buildHermesGoalWorkPrompt,
  judgeGoalFromAssistantText,
  parseGoalControl,
  parseInlineGoalContract,
  parseSubgoalControl,
} from '@/lib/chat/hermes-goal'
import { filterSlashCommands, getSlashCommandByToken, hermesGoalCommandLine, parseLeadingSlashCommand } from '@/lib/chat/slash-commands'

describe('Hermes /goal slash integration', () => {
  it('registers /goal and /subgoal in the slash menu', () => {
    expect(getSlashCommandByToken('/goal')?.id).toBe('goal')
    expect(getSlashCommandByToken('/ralph')?.id).toBe('goal')
    expect(getSlashCommandByToken('/subgoal')?.id).toBe('subgoal')
    expect(filterSlashCommands('goal').some((c) => c.id === 'goal')).toBe(true)
    expect(parseLeadingSlashCommand('/goal Fix the finance tests')?.args).toBe('Fix the finance tests')
    expect(hermesGoalCommandLine({
      id: 'goal',
      token: '/goal',
      label: 'Standing goal',
      executorKind: 'hermes_goal',
      args: 'ship it',
    })).toBe('/goal ship it')
  })

  it('parses control and set forms', () => {
    expect(parseGoalControl('')).toEqual({ kind: 'status' })
    expect(parseGoalControl('status')).toEqual({ kind: 'status' })
    expect(parseGoalControl('pause')).toEqual({ kind: 'pause' })
    expect(parseGoalControl('draft Migrate auth')).toEqual({ kind: 'draft', objective: 'Migrate auth' })
    expect(parseGoalControl('Fix the lint errors').kind).toBe('set')
  })

  it('parses inline completion contracts', () => {
    const parsed = parseInlineGoalContract(
      'Migrate auth to JWT\nverify: pytest tests/auth passes\nconstraints: keep /login response shape',
    )
    expect(parsed.goal).toContain('Migrate auth')
    expect(parsed.contract?.verification).toContain('pytest')
    expect(parsed.contract?.constraints).toContain('/login')
  })

  it('sets, pauses, resumes, and clears goals', () => {
    const set = applyGoalControl(null, { kind: 'set', goal: 'Make finance tests green' }, { uid: 'u1' })
    expect(set.shouldDispatch).toBe(true)
    expect(set.state?.status).toBe('active')
    expect(set.state?.goal).toBe('Make finance tests green')

    const paused = applyGoalControl(set.state, { kind: 'pause' })
    expect(paused.state?.status).toBe('paused')
    expect(paused.shouldDispatch).toBe(false)

    const resumed = applyGoalControl(paused.state, { kind: 'resume' })
    expect(resumed.state?.status).toBe('active')
    expect(resumed.state?.turnsUsed).toBe(0)
    expect(resumed.shouldDispatch).toBe(true)

    const cleared = applyGoalControl(resumed.state, { kind: 'clear' })
    expect(cleared.state?.status).toBe('cleared')
  })

  it('adds subgoals without clearing the main goal', () => {
    const set = applyGoalControl(null, { kind: 'set', goal: 'Fix tests' })
    const added = applySubgoalControl(set.state, parseSubgoalControl('add a regression test'))
    expect(added.state?.subgoals).toEqual(['a regression test'])
    expect(added.state?.goal).toBe('Fix tests')
    expect(added.shouldDispatch).toBe(true)
  })

  it('judges GOAL_STATUS markers conservatively', () => {
    expect(judgeGoalFromAssistantText(
      { status: 'active', goal: 'x', maxTurns: 20, turnsUsed: 1, subgoals: [], createdAt: '', updatedAt: '' },
      'All good.\nGOAL_STATUS: done — tests pass',
    ).verdict).toBe('done')
    expect(judgeGoalFromAssistantText(
      { status: 'active', goal: 'x', maxTurns: 20, turnsUsed: 1, subgoals: [], createdAt: '', updatedAt: '' },
      'Still working\nGOAL_STATUS: continue — two files left',
    ).verdict).toBe('continue')
  })

  it('advances turn budget and pauses at max turns', () => {
    const state = {
      status: 'active' as const,
      goal: 'Ship foundation',
      maxTurns: 2,
      turnsUsed: 1,
      subgoals: [] as string[],
      createdAt: 't0',
      updatedAt: 't0',
    }
    const advanced = advanceGoalAfterTurn(state, 'Working...\nGOAL_STATUS: continue — more left')
    expect(advanced.shouldContinue).toBe(false)
    expect(advanced.state.status).toBe('paused')
    expect(advanced.notice).toContain('2/2')
  })

  it('builds work prompts that include the native /goal line', () => {
    const prompt = buildHermesGoalWorkPrompt({
      status: 'active',
      goal: 'Fix finance tests',
      maxTurns: 20,
      turnsUsed: 0,
      subgoals: ['keep typecheck green'],
      createdAt: 't0',
      updatedAt: 't0',
    }, 'start')
    expect(prompt).toContain('/goal Fix finance tests')
    expect(prompt).toContain('keep typecheck green')
    expect(prompt).toContain('GOAL_STATUS:')
  })
})

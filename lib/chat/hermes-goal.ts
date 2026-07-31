/**
 * Hermes Persistent Goals (/goal) — PiB Messages integration.
 *
 * Native Hermes goals are gateway slash commands (Ralph loop). PiB Messages
 * uses /v1/runs, so we:
 * 1. Surface /goal and /subgoal in the composer slash menu
 * 2. Store standing goal state on the conversation
 * 3. Dispatch Hermes with a goal-oriented prompt (native /goal line + work)
 * 4. Auto-continue runs until achieved, paused, cleared, or turn budget hits
 *
 * @see https://hermes-agent.nousresearch.com/docs/user-guide/features/goals
 */

export const HERMES_GOAL_DEFAULT_MAX_TURNS = 20

export type HermesGoalStatus = 'active' | 'paused' | 'done' | 'cleared'

export interface HermesGoalState {
  status: HermesGoalStatus
  goal: string
  maxTurns: number
  turnsUsed: number
  subgoals: string[]
  contract?: {
    outcome?: string
    verification?: string
    constraints?: string
    boundaries?: string
    stopWhen?: string
  }
  lastReason?: string
  updatedAt: string
  createdAt: string
  createdByUid?: string
  lastRunId?: string
  lastAssistantMessageId?: string
}

export type HermesGoalControl =
  | { kind: 'status' }
  | { kind: 'show' }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'clear' }
  | { kind: 'unwait' }
  | { kind: 'wait'; pid: number; reason?: string }
  | { kind: 'draft'; objective: string }
  | { kind: 'set'; goal: string; contract?: HermesGoalState['contract'] }
  | { kind: 'noop_help' }

export type HermesSubgoalControl =
  | { kind: 'list' }
  | { kind: 'clear' }
  | { kind: 'remove'; index: number }
  | { kind: 'add'; text: string }
  | { kind: 'noop_help' }

const CONTRACT_FIELD_PREFIXES: Array<{ re: RegExp; key: keyof NonNullable<HermesGoalState['contract']> }> = [
  { re: /^(?:verify|verified by|verification)\s*:\s*/i, key: 'verification' },
  { re: /^(?:constraints?|preserve)\s*:\s*/i, key: 'constraints' },
  { re: /^(?:boundaries|scope)\s*:\s*/i, key: 'boundaries' },
  { re: /^(?:stop when|stop_when|blocked)\s*:\s*/i, key: 'stopWhen' },
  { re: /^(?:outcome|done when)\s*:\s*/i, key: 'outcome' },
]

function nowIso(): string {
  return new Date().toISOString()
}

export function parseInlineGoalContract(text: string): {
  goal: string
  contract?: HermesGoalState['contract']
} {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return { goal: text.trim() }

  const contract: NonNullable<HermesGoalState['contract']> = {}
  const headline: string[] = []
  for (const line of lines) {
    let matched = false
    for (const field of CONTRACT_FIELD_PREFIXES) {
      if (field.re.test(line)) {
        const value = line.replace(field.re, '').trim()
        if (value) contract[field.key] = value
        matched = true
        break
      }
    }
    if (!matched) headline.push(line)
  }

  // Also support single-line "goal  verify: ... constraints: ..."
  if (headline.length === 1 && Object.keys(contract).length === 0) {
    const parts = headline[0].split(/\s{2,}|(?=\b(?:verify|verified by|constraints?|preserve|boundaries|scope|stop when|blocked|outcome|done when)\s*:)/i)
    const rebuilt: string[] = []
    for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
      let matched = false
      for (const field of CONTRACT_FIELD_PREFIXES) {
        if (field.re.test(part)) {
          const value = part.replace(field.re, '').trim()
          if (value) contract[field.key] = value
          matched = true
          break
        }
      }
      if (!matched) rebuilt.push(part)
    }
    return {
      goal: rebuilt.join(' ').trim() || headline[0],
      ...(Object.keys(contract).length > 0 ? { contract } : {}),
    }
  }

  return {
    goal: headline.join(' ').trim() || text.trim(),
    ...(Object.keys(contract).length > 0 ? { contract } : {}),
  }
}

export function parseGoalControl(args: string): HermesGoalControl {
  const trimmed = args.trim()
  if (!trimmed) return { kind: 'status' }

  const [head, ...rest] = trimmed.split(/\s+/)
  const cmd = (head || '').toLowerCase()
  const tail = rest.join(' ').trim()

  if (cmd === 'status' || cmd === 'st') return { kind: 'status' }
  if (cmd === 'show' || cmd === 'contract') return { kind: 'show' }
  if (cmd === 'pause' || cmd === 'stop') return { kind: 'pause' }
  if (cmd === 'resume' || cmd === 'continue') return { kind: 'resume' }
  if (cmd === 'clear' || cmd === 'reset' || cmd === 'off') return { kind: 'clear' }
  if (cmd === 'unwait') return { kind: 'unwait' }
  if (cmd === 'help' || cmd === '?') return { kind: 'noop_help' }
  if (cmd === 'wait') {
    const pid = Number(rest[0])
    if (!Number.isFinite(pid) || pid <= 0) return { kind: 'noop_help' }
    return { kind: 'wait', pid: Math.floor(pid), reason: rest.slice(1).join(' ').trim() || undefined }
  }
  if (cmd === 'draft') {
    if (!tail) return { kind: 'noop_help' }
    return { kind: 'draft', objective: tail }
  }

  const parsed = parseInlineGoalContract(trimmed)
  if (!parsed.goal) return { kind: 'noop_help' }
  return { kind: 'set', goal: parsed.goal, contract: parsed.contract }
}

export function parseSubgoalControl(args: string): HermesSubgoalControl {
  const trimmed = args.trim()
  if (!trimmed) return { kind: 'list' }
  const [head, ...rest] = trimmed.split(/\s+/)
  const cmd = (head || '').toLowerCase()
  const tail = rest.join(' ').trim()
  if (cmd === 'list' || cmd === 'show' || cmd === 'status') return { kind: 'list' }
  if (cmd === 'clear') return { kind: 'clear' }
  if (cmd === 'remove' || cmd === 'rm' || cmd === 'delete') {
    const index = Number(tail)
    if (!Number.isFinite(index) || index < 1) return { kind: 'noop_help' }
    return { kind: 'remove', index: Math.floor(index) }
  }
  if (cmd === 'help' || cmd === '?') return { kind: 'noop_help' }
  if (cmd === 'add') {
    if (!tail) return { kind: 'noop_help' }
    return { kind: 'add', text: tail }
  }
  return { kind: 'add', text: trimmed }
}

export function formatGoalStatus(state: HermesGoalState | null | undefined): string {
  if (!state || state.status === 'cleared' || !state.goal) {
    return 'No active Hermes goal. Set one with `/goal <objective>`.\n\nExamples:\n- `/goal Fix failing tests in __tests__/finance and get the suite green`\n- `/goal draft Migrate auth to JWT`\n- `/goal status` · `/goal pause` · `/goal resume` · `/goal clear`'
  }
  const statusIcon =
    state.status === 'active' ? '⊙'
      : state.status === 'paused' ? '⏸'
        : state.status === 'done' ? '✓'
          : '·'
  const lines = [
    `${statusIcon} Goal (${state.status}) — ${state.turnsUsed}/${state.maxTurns} turns used`,
    state.goal,
  ]
  if (state.subgoals.length > 0) {
    lines.push('', 'Additional criteria:')
    state.subgoals.forEach((item, i) => lines.push(`${i + 1}. ${item}`))
  }
  if (state.contract) {
    lines.push('', 'Completion contract:')
    if (state.contract.outcome) lines.push(`- outcome: ${state.contract.outcome}`)
    if (state.contract.verification) lines.push(`- verification: ${state.contract.verification}`)
    if (state.contract.constraints) lines.push(`- constraints: ${state.contract.constraints}`)
    if (state.contract.boundaries) lines.push(`- boundaries: ${state.contract.boundaries}`)
    if (state.contract.stopWhen) lines.push(`- stop when: ${state.contract.stopWhen}`)
  }
  if (state.lastReason) lines.push('', `Last judge/note: ${state.lastReason}`)
  lines.push('', 'Controls: `/goal status` · `/goal pause` · `/goal resume` · `/goal clear` · `/subgoal <criterion>`')
  return lines.join('\n')
}

export function applyGoalControl(
  current: HermesGoalState | null | undefined,
  control: HermesGoalControl,
  opts: { uid?: string; maxTurns?: number } = {},
): { state: HermesGoalState | null; reply: string; shouldDispatch: boolean; dispatchGoal?: string } {
  const maxTurns = opts.maxTurns ?? HERMES_GOAL_DEFAULT_MAX_TURNS
  const ts = nowIso()

  if (control.kind === 'noop_help') {
    return {
      state: current ?? null,
      reply: [
        'Hermes Persistent Goals (`/goal`) keep working across turns until the objective is met.',
        '',
        'Set: `/goal <objective>`',
        'Draft contract: `/goal draft <objective>`',
        'Status: `/goal` or `/goal status` · Show contract: `/goal show`',
        'Pause/resume/clear: `/goal pause` · `/goal resume` · `/goal clear`',
        'Extra criteria: `/subgoal <criterion>`',
        '',
        'Docs: https://hermes-agent.nousresearch.com/docs/user-guide/features/goals',
      ].join('\n'),
      shouldDispatch: false,
    }
  }

  if (control.kind === 'status' || control.kind === 'show') {
    return { state: current ?? null, reply: formatGoalStatus(current), shouldDispatch: false }
  }

  if (control.kind === 'pause') {
    if (!current || !current.goal || current.status === 'cleared') {
      return { state: current ?? null, reply: 'No active goal to pause. Set one with `/goal <text>`.', shouldDispatch: false }
    }
    const next: HermesGoalState = { ...current, status: 'paused', updatedAt: ts, lastReason: 'Paused by user' }
    return { state: next, reply: `⏸ Goal paused — ${next.turnsUsed}/${next.maxTurns} turns used.\n${next.goal}`, shouldDispatch: false }
  }

  if (control.kind === 'resume') {
    if (!current || !current.goal || current.status === 'cleared') {
      return { state: current ?? null, reply: 'No goal to resume. Set one with `/goal <text>`.', shouldDispatch: false }
    }
    const next: HermesGoalState = {
      ...current,
      status: 'active',
      turnsUsed: 0,
      updatedAt: ts,
      lastReason: 'Resumed by user (turn counter reset)',
    }
    return {
      state: next,
      reply: `▶ Goal resumed (turn budget reset to 0/${next.maxTurns}):\n${next.goal}`,
      shouldDispatch: true,
      dispatchGoal: next.goal,
    }
  }

  if (control.kind === 'clear') {
    if (!current || current.status === 'cleared' || !current.goal) {
      return { state: current ?? null, reply: 'No active goal to clear.', shouldDispatch: false }
    }
    const next: HermesGoalState = {
      ...current,
      status: 'cleared',
      updatedAt: ts,
      lastReason: 'Cleared by user',
    }
    return { state: next, reply: 'Goal cleared.', shouldDispatch: false }
  }

  if (control.kind === 'wait' || control.kind === 'unwait') {
    // Full PID wait barriers require Hermes gateway process registry.
    // Surface status honestly and keep the goal active.
    if (!current?.goal || current.status === 'cleared') {
      return { state: current ?? null, reply: 'No active goal. Set one with `/goal <text>` first.', shouldDispatch: false }
    }
    if (control.kind === 'wait') {
      return {
        state: { ...current, updatedAt: ts, lastReason: `Wait requested on pid ${control.pid}${control.reason ? `: ${control.reason}` : ''}` },
        reply: `⏳ Wait barrier noted for pid ${control.pid}. PiB will keep the goal active; use \`/goal status\` to inspect. Full mid-process parking is handled inside Hermes when the agent starts background tools.`,
        shouldDispatch: false,
      }
    }
    return {
      state: { ...current, updatedAt: ts, lastReason: 'Wait barrier cleared by user' },
      reply: '▶ Wait barrier cleared — goal remains active.',
      shouldDispatch: false,
    }
  }

  if (control.kind === 'draft' || control.kind === 'set') {
    const goalText = control.kind === 'draft' ? control.objective : control.goal
    const contract = control.kind === 'set' ? control.contract : {
      outcome: control.objective,
      verification: 'Concrete evidence in the agent response (command output, file change, or test result) proving the outcome.',
      stopWhen: 'Blocked on human approval, missing credentials, or irreversible external side effects.',
    }
    const next: HermesGoalState = {
      status: 'active',
      goal: goalText,
      maxTurns,
      turnsUsed: 0,
      subgoals: [],
      ...(contract ? { contract } : {}),
      createdAt: current?.createdAt && current.goal === goalText ? current.createdAt : ts,
      updatedAt: ts,
      ...(opts.uid ? { createdByUid: opts.uid } : {}),
      lastReason: control.kind === 'draft' ? 'Drafted completion contract from objective' : 'Goal set',
    }
    const prefix = control.kind === 'draft'
      ? `⊙ Goal set with drafted contract (${maxTurns}-turn budget):`
      : `⊙ Goal set (${maxTurns}-turn budget):`
    return {
      state: next,
      reply: `${prefix}\n${goalText}\n\nWorking with the assigned Hermes agent until this is achieved. Use \`/goal status\`, \`/goal pause\`, or \`/subgoal <criterion>\` anytime.`,
      shouldDispatch: true,
      dispatchGoal: goalText,
    }
  }

  return { state: current ?? null, reply: formatGoalStatus(current), shouldDispatch: false }
}

export function applySubgoalControl(
  current: HermesGoalState | null | undefined,
  control: HermesSubgoalControl,
): { state: HermesGoalState | null; reply: string; shouldDispatch: boolean } {
  if (!current || !current.goal || current.status === 'cleared') {
    return {
      state: current ?? null,
      reply: 'No active goal. Set one with `/goal <text>` before using `/subgoal`.',
      shouldDispatch: false,
    }
  }
  const ts = nowIso()
  if (control.kind === 'noop_help') {
    return {
      state: current,
      reply: 'Usage:\n- `/subgoal <criterion>` add\n- `/subgoal list`\n- `/subgoal remove <N>`\n- `/subgoal clear`',
      shouldDispatch: false,
    }
  }
  if (control.kind === 'list') {
    if (current.subgoals.length === 0) {
      return { state: current, reply: 'No subgoals yet. Add one with `/subgoal <criterion>`.', shouldDispatch: false }
    }
    return {
      state: current,
      reply: ['Additional criteria:', ...current.subgoals.map((s, i) => `${i + 1}. ${s}`)].join('\n'),
      shouldDispatch: false,
    }
  }
  if (control.kind === 'clear') {
    const next = { ...current, subgoals: [], updatedAt: ts, lastReason: 'Subgoals cleared' }
    return { state: next, reply: 'All subgoals cleared. Original goal kept.', shouldDispatch: false }
  }
  if (control.kind === 'remove') {
    if (control.index < 1 || control.index > current.subgoals.length) {
      return { state: current, reply: `No subgoal #${control.index}.`, shouldDispatch: false }
    }
    const subgoals = current.subgoals.filter((_, i) => i !== control.index - 1)
    const next = { ...current, subgoals, updatedAt: ts, lastReason: `Removed subgoal #${control.index}` }
    return { state: next, reply: `Removed subgoal #${control.index}.`, shouldDispatch: false }
  }
  // add
  const text = control.text.trim()
  if (!text) {
    return { state: current, reply: 'Usage: `/subgoal <criterion>`', shouldDispatch: false }
  }
  const subgoals = [...current.subgoals, text].slice(0, 20)
  const next = {
    ...current,
    subgoals,
    status: current.status === 'paused' ? current.status : 'active' as HermesGoalStatus,
    updatedAt: ts,
    lastReason: `Added subgoal: ${text}`,
  }
  return {
    state: next,
    reply: `Added criterion #${subgoals.length}: ${text}\n\nThe goal is not done until the original objective and every subgoal are met.`,
    shouldDispatch: next.status === 'active',
  }
}

export function buildHermesGoalWorkPrompt(state: HermesGoalState, mode: 'start' | 'continue'): string {
  const header = mode === 'start'
    ? `[Hermes Persistent Goal — start]\nExecute as if the user ran the native Hermes command:\n/goal ${state.goal}`
    : `[Hermes Persistent Goal — continue ${state.turnsUsed + 1}/${state.maxTurns}]\nStanding goal (keep working; do not stop early):\n${state.goal}`

  const lines = [
    header,
    '',
    'This is a standing Ralph-style objective across turns. Keep working until the goal is verifiably complete.',
    'Prefer concrete tool evidence (commands, tests, file diffs). Do not claim done without proof.',
    'If blocked on human approval, credentials, or irreversible external side effects, say so clearly and stop.',
  ]
  if (state.subgoals.length > 0) {
    lines.push('', 'Additional criteria the user added mid-loop:')
    state.subgoals.forEach((s, i) => lines.push(`${i + 1}. ${s}`))
  }
  if (state.contract) {
    lines.push('', 'Completion contract:')
    if (state.contract.outcome) lines.push(`- outcome: ${state.contract.outcome}`)
    if (state.contract.verification) lines.push(`- verification: ${state.contract.verification}`)
    if (state.contract.constraints) lines.push(`- constraints: ${state.contract.constraints}`)
    if (state.contract.boundaries) lines.push(`- boundaries: ${state.contract.boundaries}`)
    if (state.contract.stopWhen) lines.push(`- stop when: ${state.contract.stopWhen}`)
  }
  lines.push(
    '',
    'End your final response with exactly one of these lines so the platform can judge progress:',
    'GOAL_STATUS: done — <one-sentence reason with evidence>',
    'GOAL_STATUS: continue — <what remains>',
    'GOAL_STATUS: blocked — <what is needed from the human>',
  )
  return lines.join('\n')
}

export function judgeGoalFromAssistantText(
  state: HermesGoalState,
  assistantText: string,
): { verdict: 'done' | 'continue' | 'blocked'; reason: string } {
  const text = (assistantText || '').trim()
  const marker = text.match(/GOAL_STATUS:\s*(done|continue|blocked)\s*[—:-]?\s*(.*)$/im)
  if (marker) {
    const verdict = marker[1].toLowerCase() as 'done' | 'continue' | 'blocked'
    const reason = (marker[2] || '').trim() || (verdict === 'done' ? 'Agent marked goal complete' : 'Agent requested continuation')
    return { verdict, reason }
  }

  // Conservative fallback: only mark done on strong explicit completion language.
  const lower = text.toLowerCase()
  if (
    /\b(goal (is )?complete|all (tests|checks) pass|fully (done|complete)|✓ goal achieved)\b/i.test(text)
    && !/\b(still need|remaining|todo|not yet|partially)\b/i.test(lower)
  ) {
    return { verdict: 'done', reason: 'Assistant response indicates completion' }
  }
  if (/\b(blocked on|need(s)? (your|human) (approval|input)|cannot proceed without)\b/i.test(lower)) {
    return { verdict: 'blocked', reason: 'Assistant reports a human/approval blocker' }
  }
  return {
    verdict: 'continue',
    reason: state.subgoals.length
      ? 'No explicit GOAL_STATUS done marker; continuing with remaining subgoals in mind'
      : 'No explicit GOAL_STATUS done marker; continuing toward the standing goal',
  }
}

export function advanceGoalAfterTurn(
  state: HermesGoalState,
  assistantText: string,
  meta: { runId?: string; assistantMessageId?: string } = {},
): { state: HermesGoalState; shouldContinue: boolean; notice: string } {
  const ts = nowIso()
  const turnsUsed = state.turnsUsed + 1
  const judgment = judgeGoalFromAssistantText(state, assistantText)

  if (judgment.verdict === 'done') {
    const next: HermesGoalState = {
      ...state,
      status: 'done',
      turnsUsed,
      updatedAt: ts,
      lastReason: judgment.reason,
      ...(meta.runId ? { lastRunId: meta.runId } : {}),
      ...(meta.assistantMessageId ? { lastAssistantMessageId: meta.assistantMessageId } : {}),
    }
    return {
      state: next,
      shouldContinue: false,
      notice: `✓ Goal achieved: ${judgment.reason}`,
    }
  }

  if (judgment.verdict === 'blocked') {
    const next: HermesGoalState = {
      ...state,
      status: 'paused',
      turnsUsed,
      updatedAt: ts,
      lastReason: judgment.reason,
      ...(meta.runId ? { lastRunId: meta.runId } : {}),
      ...(meta.assistantMessageId ? { lastAssistantMessageId: meta.assistantMessageId } : {}),
    }
    return {
      state: next,
      shouldContinue: false,
      notice: `⏸ Goal paused — blocked: ${judgment.reason}. Use \`/goal resume\` after resolving the blocker.`,
    }
  }

  if (turnsUsed >= state.maxTurns) {
    const next: HermesGoalState = {
      ...state,
      status: 'paused',
      turnsUsed,
      updatedAt: ts,
      lastReason: `Turn budget exhausted (${turnsUsed}/${state.maxTurns})`,
      ...(meta.runId ? { lastRunId: meta.runId } : {}),
      ...(meta.assistantMessageId ? { lastAssistantMessageId: meta.assistantMessageId } : {}),
    }
    return {
      state: next,
      shouldContinue: false,
      notice: `⏸ Goal paused — ${turnsUsed}/${state.maxTurns} turns used. Use \`/goal resume\` to keep going, or \`/goal clear\` to stop.`,
    }
  }

  const next: HermesGoalState = {
    ...state,
    status: 'active',
    turnsUsed,
    updatedAt: ts,
    lastReason: judgment.reason,
    ...(meta.runId ? { lastRunId: meta.runId } : {}),
    ...(meta.assistantMessageId ? { lastAssistantMessageId: meta.assistantMessageId } : {}),
  }
  return {
    state: next,
    shouldContinue: true,
    notice: `↻ Continuing toward goal (${turnsUsed}/${state.maxTurns}): ${judgment.reason}`,
  }
}

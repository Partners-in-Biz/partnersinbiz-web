import {
  applyPlanningDiscoveryAction,
  isPlanningReady,
  planningDiscoveryDigest,
  planningMutationBlocker,
  type PlanningDecisionBrief,
  type PlanningDiscoveryState,
} from '@/lib/projects/planningDiscovery'

const brief: PlanningDecisionBrief = {
  outcome: 'Ship a reliable planning workflow',
  user: 'Project managers and their delivery agents',
  whyNow: 'Project plans are stale and agents lack context',
  successCriteria: ['Plan refreshes safely', 'Agents receive filtered Plan context'],
  constraints: ['Development only'],
  outOfScope: ['Production release'],
  assumptions: ['Legacy projects migrate on their next planning cycle'],
  risks: ['Tenant leakage'],
  approvalGates: ['production-deploy'],
}

const inspection = {
  brief: ['Read project brief revision 4'],
  docs: ['Inspected linked requirements document doc-1'],
  files: ['Inspected repository planning files'],
  plan: ['Inspected current Project Plan and milestones'],
  tasks: ['Inspected todo, blocked, and completed tasks'],
  tools: ['Inspected available project and verification tools'],
  agents: ['Inspected assigned and available specialist agents'],
  skills: ['Inspected applicable planning and delivery skills'],
}

const actor = (uid: string, minute: number) => ({ uid, now: `2026-07-27T00:${String(minute).padStart(2, '0')}:00.000Z` })

function ok(result: ReturnType<typeof applyPlanningDiscoveryAction>): PlanningDiscoveryState {
  if (!result.ok) throw new Error(result.error)
  return result.state
}

function startAndInspect() {
  const started = ok(applyPlanningDiscoveryAction(null, { type: 'start' }, actor('pip', 0)))
  const inspected = ok(applyPlanningDiscoveryAction(started, {
    type: 'record_inspection',
    expectedRevision: started.revision,
    evidence: inspection,
  } as never, actor('pip', 1)))
  return inspected
}

function completeInterview() {
  const inspected = startAndInspect()
  const asked = ok(applyPlanningDiscoveryAction(inspected, {
    type: 'ask_question',
    expectedRevision: inspected.revision,
    question: 'Which measurable outcome matters most for the first release?',
    currentGuess: 'A safe planning gate that agents cannot bypass',
  } as never, actor('pip', 2)))
  const answered = ok(applyPlanningDiscoveryAction(asked, {
    type: 'answer_question',
    expectedRevision: asked.revision,
    expectedQuestionId: asked.pendingQuestionId,
    answer: 'Prevent unapproved planned work while preserving existing execution.',
  } as never, actor('peet', 3)))
  return answered
}

function submitReadyBrief(current = completeInterview()) {
  return ok(applyPlanningDiscoveryAction(current, {
    type: 'submit_brief',
    expectedRevision: current.revision,
    confidence: 96,
    predictedNextAnswers: ['Development only', 'No production release', 'Keep operational gates'],
    intentBlockingUnknowns: [],
    brief,
  } as never, actor('pip', 4)))
}

describe('planning discovery state machine', () => {
  it('requires durable evidence for every approved inspection surface', () => {
    const started = ok(applyPlanningDiscoveryAction(null, { type: 'start' }, actor('pip', 0)))
    const incomplete = applyPlanningDiscoveryAction(started, {
      type: 'record_inspection',
      expectedRevision: started.revision,
      evidence: { ...inspection, skills: [] },
    } as never, actor('pip', 1))

    expect(incomplete).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(started.revision).toBe(1)

    const inspected = ok(applyPlanningDiscoveryAction(started, {
      type: 'record_inspection',
      expectedRevision: started.revision,
      evidence: inspection,
    } as never, actor('pip', 1)))
    expect(inspected.inspection).toEqual(expect.objectContaining({
      ...inspection,
      inspectedBy: 'pip',
      inspectedAt: actor('pip', 1).now,
    }))
  })

  it('allows only one high-value question at a time and durably records the answered turn', () => {
    const inspected = startAndInspect()
    const asked = ok(applyPlanningDiscoveryAction(inspected, {
      type: 'ask_question',
      expectedRevision: inspected.revision,
      question: 'Which measurable outcome matters most for the first release?',
      currentGuess: 'A safe planning gate that agents cannot bypass',
    } as never, actor('pip', 2)))

    const overlapping = applyPlanningDiscoveryAction(asked, {
      type: 'ask_question',
      expectedRevision: asked.revision,
      question: 'What is the deadline?',
      currentGuess: 'This week',
    } as never, actor('pip', 3))
    expect(overlapping).toEqual(expect.objectContaining({ ok: false, status: 409 }))

    const answered = ok(applyPlanningDiscoveryAction(asked, {
      type: 'answer_question',
      expectedRevision: asked.revision,
      expectedQuestionId: asked.pendingQuestionId,
      answer: 'Prevent unapproved planned work while preserving existing execution.',
    } as never, actor('peet', 3)))
    expect(answered.pendingQuestionId).toBeUndefined()
    expect(answered.turns).toEqual([
      expect.objectContaining({
        question: 'Which measurable outcome matters most for the first release?',
        currentGuess: 'A safe planning gate that agents cannot bypass',
        answer: 'Prevent unapproved planned work while preserving existing execution.',
        askedBy: 'pip',
        answeredBy: 'peet',
      }),
    ])
  })

  it('requires confidence, three-answer predictability, zero blocking unknowns, and a complete brief before normal confirmation', () => {
    const interviewed = completeInterview()
    const lowConfidence = applyPlanningDiscoveryAction(interviewed, {
      type: 'submit_brief', expectedRevision: interviewed.revision, confidence: 94,
      predictedNextAnswers: ['one', 'two', 'three'], intentBlockingUnknowns: [], brief,
    } as never, actor('pip', 4))
    expect(lowConfidence).toEqual(expect.objectContaining({ ok: false, status: 400 }))

    const unpredictable = applyPlanningDiscoveryAction(interviewed, {
      type: 'submit_brief', expectedRevision: interviewed.revision, confidence: 96,
      predictedNextAnswers: ['one', 'two'], intentBlockingUnknowns: [], brief,
    } as never, actor('pip', 4))
    expect(unpredictable).toEqual(expect.objectContaining({ ok: false, status: 400 }))

    const blocked = applyPlanningDiscoveryAction(interviewed, {
      type: 'submit_brief', expectedRevision: interviewed.revision, confidence: 96,
      predictedNextAnswers: ['one', 'two', 'three'], intentBlockingUnknowns: ['Who approves scope?'], brief,
    } as never, actor('pip', 4))
    expect(blocked).toEqual(expect.objectContaining({ ok: false, status: 400 }))

    const submitted = submitReadyBrief(interviewed)
    expect(submitted.status).toBe('brief_ready')
    expect(isPlanningReady(submitted)).toBe(false)

    const staleDigest = applyPlanningDiscoveryAction(submitted, {
      type: 'confirm', expectedRevision: submitted.revision, expectedDigest: 'stale',
    }, actor('peet', 5))
    expect(staleDigest).toEqual(expect.objectContaining({ ok: false, status: 409 }))

    const confirmed = ok(applyPlanningDiscoveryAction(submitted, {
      type: 'confirm', expectedRevision: submitted.revision, expectedDigest: submitted.digest!,
    }, actor('peet', 5)))
    expect(isPlanningReady(confirmed)).toBe(true)
    expect(planningMutationBlocker({ planningDiscovery: confirmed })).toBeNull()
  })

  it('requires inspected, previously surfaced brief content and preserved-gate acknowledgement for assumption mode', () => {
    const inspected = startAndInspect()
    const surfaced = ok(applyPlanningDiscoveryAction(inspected, {
      type: 'surface_brief',
      expectedRevision: inspected.revision,
      brief,
    } as never, actor('pip', 2)))

    const replacement = applyPlanningDiscoveryAction(surfaced, {
      type: 'plan_with_assumptions',
      expectedRevision: surfaced.revision,
      attestation: 'PLAN WITH ASSUMPTIONS',
      reason: 'Move now while keeping every unknown explicit',
      acknowledgesPreservedOperationalGates: true,
      brief: { ...brief, outcome: 'Silently replaced outcome' },
    } as never, actor('peet', 3))
    expect(replacement).toEqual(expect.objectContaining({ ok: false, status: 409 }))

    const noGateAcknowledgement = applyPlanningDiscoveryAction(surfaced, {
      type: 'plan_with_assumptions', expectedRevision: surfaced.revision,
      attestation: 'PLAN WITH ASSUMPTIONS', reason: 'Move now while keeping every unknown explicit',
    } as never, actor('peet', 3))
    expect(noGateAcknowledgement).toEqual(expect.objectContaining({ ok: false, status: 400 }))

    const yolo = ok(applyPlanningDiscoveryAction(surfaced, {
      type: 'plan_with_assumptions', expectedRevision: surfaced.revision,
      attestation: 'PLAN WITH ASSUMPTIONS', reason: 'Move now while keeping every unknown explicit',
      acknowledgesPreservedOperationalGates: true,
    } as never, actor('peet', 3)))
    expect(yolo.status).toBe('assumptions_attested')
    expect(yolo.brief).toEqual(brief)
    expect(yolo.brief?.approvalGates).toEqual(['production-deploy'])
    expect(isPlanningReady(yolo)).toBe(true)
  })

  it('fails closed on unknown actions without changing the current state', () => {
    const inspected = startAndInspect()
    const before = structuredClone(inspected)
    const result = applyPlanningDiscoveryAction(inspected, {
      type: 'delete_everything',
      expectedRevision: inspected.revision,
    } as never, actor('attacker', 9))

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 400 }))
    expect(inspected).toEqual(before)
  })

  it('preserves the prior version and digest snapshot when discovery is reopened', () => {
    const submitted = submitReadyBrief()
    const confirmed = ok(applyPlanningDiscoveryAction(submitted, {
      type: 'confirm', expectedRevision: submitted.revision, expectedDigest: submitted.digest!,
    }, actor('peet', 5)))
    const reopened = ok(applyPlanningDiscoveryAction(confirmed, {
      type: 'reopen', expectedRevision: confirmed.revision, reason: 'Project brief materially changed',
    } as never, actor('peet', 6)))

    expect(reopened.status).toBe('interviewing')
    expect(reopened.brief).toBeUndefined()
    expect(reopened.digest).toBeUndefined()
    expect(reopened.snapshots).toEqual([
      expect.objectContaining({
        revision: confirmed.revision,
        status: 'confirmed',
        digest: confirmed.digest,
        brief,
        staleReason: 'Project brief materially changed',
      }),
    ])
  })

  it('requires discovery on a legacy project planning mutation without blocking already-running execution in this helper', () => {
    expect(planningMutationBlocker({})).toEqual(expect.objectContaining({
      code: 'planning_discovery_required',
      revision: 0,
    }))
    expect(planningMutationBlocker({
      planningDiscovery: { schemaVersion: 1, revision: 1, status: 'interviewing', mode: 'interview', enforced: true },
    })).toEqual(expect.objectContaining({ code: 'planning_discovery_required' }))
  })

  it('produces a stable digest and rejects incomplete Decision Brief sections', () => {
    expect(planningDiscoveryDigest(brief)).toBe(planningDiscoveryDigest({ ...brief }))
    const interviewed = completeInterview()
    const incomplete = applyPlanningDiscoveryAction(interviewed, {
      type: 'submit_brief', expectedRevision: interviewed.revision, confidence: 96,
      predictedNextAnswers: ['one', 'two', 'three'], intentBlockingUnknowns: [],
      brief: { ...brief, risks: [] },
    } as never, actor('pip', 4))
    expect(incomplete).toEqual(expect.objectContaining({ ok: false, status: 400 }))
  })
})

import {
  applyPlanningDiscoveryAction,
  isPlanningReady,
  planningDiscoveryDigest,
  planningMutationBlocker,
} from '@/lib/projects/planningDiscovery'

const brief = {
  outcome: 'Ship a reliable planning workflow',
  whyNow: 'Project plans are stale and agents lack context',
  successCriteria: ['Plan refreshes safely', 'Agents receive filtered Plan context'],
  constraints: ['Development only'],
  outOfScope: ['Production release'],
  assumptions: ['Legacy projects migrate on their next planning cycle'],
  risks: ['Tenant leakage'],
  approvalGates: ['production-deploy'],
}

describe('planning discovery state', () => {
  it('does not let a repeated start erase an existing discovery revision', () => {
    const started = applyPlanningDiscoveryAction(null, { type: 'start' }, { uid: 'peet', now: '2026-07-27T00:00:00.000Z' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const repeated = applyPlanningDiscoveryAction(started.state, { type: 'start' }, { uid: 'peet', now: '2026-07-27T00:01:00.000Z' })
    expect(repeated).toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })

  it('requires a confirmed brief before planning is ready', () => {
    const started = applyPlanningDiscoveryAction(null, { type: 'start' }, { uid: 'peet', now: '2026-07-27T00:00:00.000Z' })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(isPlanningReady(started.state)).toBe(false)

    const submitted = applyPlanningDiscoveryAction(started.state, {
      type: 'submit_brief',
      expectedRevision: started.state.revision,
      confidence: 96,
      brief,
    }, { uid: 'pip', now: '2026-07-27T00:01:00.000Z' })
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return

    const confirmed = applyPlanningDiscoveryAction(submitted.state, {
      type: 'confirm',
      expectedRevision: submitted.state.revision,
      expectedDigest: submitted.state.digest,
    }, { uid: 'peet', now: '2026-07-27T00:02:00.000Z' })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(isPlanningReady(confirmed.state)).toBe(true)
    expect(planningMutationBlocker({ planningDiscovery: confirmed.state })).toBeNull()
  })

  it('rejects stale confirmation and low-confidence normal mode', () => {
    const started = applyPlanningDiscoveryAction(null, { type: 'start' }, { uid: 'peet', now: '2026-07-27T00:00:00.000Z' })
    if (!started.ok) throw new Error(started.error)
    const submitted = applyPlanningDiscoveryAction(started.state, { type: 'submit_brief', expectedRevision: started.state.revision, confidence: 80, brief }, { uid: 'pip', now: '2026-07-27T00:01:00.000Z' })
    expect(submitted).toEqual(expect.objectContaining({ ok: false, status: 400 }))

    const good = applyPlanningDiscoveryAction(started.state, { type: 'submit_brief', expectedRevision: started.state.revision, confidence: 95, brief }, { uid: 'pip', now: '2026-07-27T00:01:00.000Z' })
    if (!good.ok) throw new Error(good.error)
    const stale = applyPlanningDiscoveryAction(good.state, { type: 'confirm', expectedRevision: started.state.revision, expectedDigest: good.state.digest }, { uid: 'peet', now: '2026-07-27T00:02:00.000Z' })
    expect(stale).toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })

  it('accepts exact project-scoped assumptions attestation without touching operational gates', () => {
    const started = applyPlanningDiscoveryAction(null, { type: 'start' }, { uid: 'peet', now: '2026-07-27T00:00:00.000Z' })
    if (!started.ok) throw new Error(started.error)
    const yolo = applyPlanningDiscoveryAction(started.state, {
      type: 'plan_with_assumptions',
      expectedRevision: started.state.revision,
      attestation: 'PLAN WITH ASSUMPTIONS',
      reason: 'Move now while keeping unknowns explicit',
      brief,
    }, { uid: 'peet', now: '2026-07-27T00:01:00.000Z' })
    expect(yolo.ok).toBe(true)
    if (!yolo.ok) return
    expect(yolo.state.status).toBe('assumptions_attested')
    expect(yolo.state.mode).toBe('assumptions')
    expect(yolo.state.brief?.approvalGates).toEqual(['production-deploy'])
    expect(isPlanningReady(yolo.state)).toBe(true)

    const invalid = applyPlanningDiscoveryAction(started.state, {
      type: 'plan_with_assumptions', expectedRevision: started.state.revision, attestation: 'YOLO', reason: 'fast', brief,
    }, { uid: 'peet', now: '2026-07-27T00:01:00.000Z' })
    expect(invalid).toEqual(expect.objectContaining({ ok: false, status: 400 }))
  })

  it('produces a stable digest for equivalent briefs', () => {
    expect(planningDiscoveryDigest(brief)).toBe(planningDiscoveryDigest({ ...brief }))
  })

  it('keeps legacy projects operable but blocks explicitly enforced incomplete discovery', () => {
    expect(planningMutationBlocker({})).toBeNull()
    expect(planningMutationBlocker({ planningDiscovery: { schemaVersion: 1, revision: 1, status: 'interviewing', mode: 'interview', enforced: true } })).toEqual(expect.objectContaining({ code: 'planning_discovery_required' }))
  })
})

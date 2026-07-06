import {
  LIFECYCLE_STATES,
  DEFAULT_LIFECYCLE_STATE,
  TRANSITIONS,
  isValidLifecycleState,
  resolveLifecycleState,
  isAllowedTransition,
  meetsMinState,
  assertMinState,
  LifecycleStateTooLowError,
  findLifecycleStateWriteAttempt,
  checkContentCompleteGuard,
  checkRightsClearedGuard,
  checkAssembledGuard,
  checkQaApprovedGuard,
  runLifecycleGuard,
  executeLifecycleTransition,
  LifecycleTransitionNotAllowedError,
  LifecycleReopenReasonRequiredError,
} from '@/lib/book-studio/lifecycle'

describe('lifecycle state graph', () => {
  it('exposes all 9 states in pipeline order', () => {
    expect(LIFECYCLE_STATES).toEqual([
      'draft', 'content_complete', 'rights_cleared', 'assembled',
      'qa_approved', 'submission_ready', 'submitted', 'live', 'archived',
    ])
  })

  it('defaults missing lifecycleState to draft (migration-free default)', () => {
    expect(resolveLifecycleState(undefined)).toBe('draft')
    expect(resolveLifecycleState(null)).toBe('draft')
    expect(resolveLifecycleState({})).toBe('draft')
    expect(resolveLifecycleState({ lifecycleState: 'not-a-real-state' })).toBe('draft')
    expect(DEFAULT_LIFECYCLE_STATE).toBe('draft')
  })

  it('resolves a valid stored lifecycleState as-is', () => {
    expect(resolveLifecycleState({ lifecycleState: 'rights_cleared' })).toBe('rights_cleared')
  })

  it('validates known states only', () => {
    expect(isValidLifecycleState('draft')).toBe(true)
    expect(isValidLifecycleState('live')).toBe(true)
    expect(isValidLifecycleState('nope')).toBe(false)
    expect(isValidLifecycleState(123)).toBe(false)
  })

  it('allows only the explicit forward transition plus reopen-to-draft', () => {
    expect(isAllowedTransition('draft', 'content_complete')).toBe(true)
    expect(isAllowedTransition('content_complete', 'rights_cleared')).toBe(true)
    expect(isAllowedTransition('content_complete', 'draft')).toBe(true)
    expect(isAllowedTransition('archived', 'draft')).toBe(true)
  })

  it('rejects skipping states or moving backwards to a non-draft state', () => {
    expect(isAllowedTransition('draft', 'rights_cleared')).toBe(false)
    expect(isAllowedTransition('draft', 'assembled')).toBe(false)
    expect(isAllowedTransition('assembled', 'content_complete')).toBe(false)
    expect(isAllowedTransition('live', 'submitted')).toBe(false)
  })

  it('every state (except archived, reopen-only) has at least one forward transition', () => {
    const forwardOnly = Object.entries(TRANSITIONS).filter(([state]) => state !== 'archived')
    forwardOnly.forEach(([, targets]) => {
      expect(targets.length).toBeGreaterThan(0)
    })
  })

  describe('meetsMinState / assertMinState', () => {
    it('treats draft as not meeting any forward minimum', () => {
      expect(meetsMinState('draft', 'rights_cleared')).toBe(false)
    })

    it('treats a state equal to or past the minimum as meeting it', () => {
      expect(meetsMinState('rights_cleared', 'rights_cleared')).toBe(true)
      expect(meetsMinState('assembled', 'rights_cleared')).toBe(true)
      expect(meetsMinState('live', 'rights_cleared')).toBe(true)
    })

    it('assertMinState throws LifecycleStateTooLowError with blockers when not met', () => {
      expect(() => assertMinState({ lifecycleState: 'content_complete', title: 'My Book' }, 'rights_cleared'))
        .toThrow(LifecycleStateTooLowError)
      try {
        assertMinState({ lifecycleState: 'content_complete', title: 'My Book' }, 'rights_cleared')
        throw new Error('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(LifecycleStateTooLowError)
        expect((err as InstanceType<typeof LifecycleStateTooLowError>).blockers).toEqual([
          'lifecycleState must be at least "rights_cleared" (currently "content_complete")',
        ])
        expect((err as Error).message).toContain('My Book')
      }
    })

    it('assertMinState does not throw when the minimum is met', () => {
      expect(() => assertMinState({ lifecycleState: 'rights_cleared' }, 'rights_cleared')).not.toThrow()
    })

    it('assertMinState treats a missing lifecycleState as draft (fails any forward minimum)', () => {
      expect(() => assertMinState({}, 'content_complete')).toThrow(LifecycleStateTooLowError)
    })
  })

  describe('findLifecycleStateWriteAttempt', () => {
    it('detects a direct lifecycleState key in a PATCH body', () => {
      expect(findLifecycleStateWriteAttempt({ lifecycleState: 'live' })).toBe(true)
    })

    it('ignores bodies without lifecycleState', () => {
      expect(findLifecycleStateWriteAttempt({ status: 'approved' })).toBe(false)
    })

    it('detects an explicit undefined value (still an attempted write)', () => {
      expect(findLifecycleStateWriteAttempt({ lifecycleState: undefined })).toBe(true)
    })
  })
})

describe('lifecycle guards', () => {
  describe('checkContentCompleteGuard', () => {
    it('passes when every chapter/page is edited or approved', () => {
      const result = checkContentCompleteGuard({
        chapters: [{ status: 'edited' }, { status: 'approved' }],
        pages: [{ status: 'edited' }],
      })
      expect(result).toEqual({ ok: true, blockers: [] })
    })

    it('blocks with an index-labeled reason for each draft/generated unit', () => {
      const result = checkContentCompleteGuard({
        chapters: [{ status: 'draft' }],
        pages: [{ status: 'generated' }],
      })
      expect(result.ok).toBe(false)
      expect(result.blockers).toEqual([
        'chapter[0] status is "draft", must be "edited" or "approved"',
        'page[0] status is "generated", must be "edited" or "approved"',
      ])
    })

    it('blocks a project with no chapters or pages at all', () => {
      const result = checkContentCompleteGuard({ chapters: [], pages: [] })
      expect(result.ok).toBe(false)
      expect(result.blockers).toContain('project has no chapters or pages to review')
    })
  })

  describe('checkRightsClearedGuard', () => {
    it.each(['cleared', 'owned', 'licensed', 'public_domain'])('passes for rights status "%s"', (status) => {
      expect(checkRightsClearedGuard({ rightsLedger: { status } })).toEqual({ ok: true, blockers: [] })
    })

    it('blocks for needs_review', () => {
      const result = checkRightsClearedGuard({ rightsLedger: { status: 'needs_review' } })
      expect(result.ok).toBe(false)
      expect(result.blockers[0]).toContain('needs_review')
    })

    it('blocks when there is no rights ledger at all', () => {
      const result = checkRightsClearedGuard({ rightsLedger: null })
      expect(result.ok).toBe(false)
      expect(result.blockers[0]).toContain('unknown')
    })
  })

  describe('checkAssembledGuard', () => {
    it('passes when a package manifest exists', () => {
      expect(checkAssembledGuard({ packageManifest: { status: 'draft', version: '1' } })).toEqual({ ok: true, blockers: [] })
    })

    it('blocks when there is no manifest', () => {
      const result = checkAssembledGuard({ packageManifest: null })
      expect(result.ok).toBe(false)
    })
  })

  describe('checkQaApprovedGuard', () => {
    it('passes when qaStatus is approved or pass', () => {
      expect(checkQaApprovedGuard({ packageManifest: { qaStatus: 'pass' } }).ok).toBe(true)
    })

    it('blocks when qaStatus is missing_evidence or block', () => {
      expect(checkQaApprovedGuard({ packageManifest: { qaStatus: 'block' } }).ok).toBe(false)
      expect(checkQaApprovedGuard({ packageManifest: {} }).ok).toBe(false)
    })
  })

  describe('runLifecycleGuard', () => {
    it('runs the registered guard for a target state', () => {
      const result = runLifecycleGuard('rights_cleared', { rightsLedger: { status: 'cleared' } })
      expect(result.ok).toBe(true)
    })

    it('returns ok for target states with no registered guard', () => {
      expect(runLifecycleGuard('submission_ready', {})).toEqual({ ok: true, blockers: [] })
      expect(runLifecycleGuard('draft', {})).toEqual({ ok: true, blockers: [] })
    })
  })
})

describe('executeLifecycleTransition', () => {
  function makeFakeDb(project: Record<string, unknown> | null) {
    const projectDoc = { ...project }
    const updateSpy = jest.fn((patch: Record<string, unknown>) => Object.assign(projectDoc, patch))
    const createSpy = jest.fn()
    const projectRef = { get: async () => ({ exists: Boolean(project), data: () => projectDoc }) }
    const decisionLogRef = {}
    const collection = jest.fn((name: string) => {
      if (name === 'book_studio_projects') return { doc: () => projectRef } as unknown as FirebaseFirestore.CollectionReference
      if (name === 'book_studio_decision_logs') return { doc: () => decisionLogRef } as unknown as FirebaseFirestore.CollectionReference
      throw new Error(`unexpected collection ${name}`)
    })
    const tx = {
      get: async (ref: unknown) => (ref as { get: () => Promise<unknown> }).get(),
      update: updateSpy,
      create: createSpy,
    }
    const runTransaction = jest.fn(async (fn: (tx: unknown) => Promise<void>) => fn(tx))
    return { db: { collection, runTransaction } as never, updateSpy, createSpy }
  }

  it('updates lifecycleState and writes a decision log in the same transaction', async () => {
    const { db, updateSpy, createSpy } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'content_complete', deleted: false })
    const result = await executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'rights_cleared',
      guardData: { rightsLedger: { status: 'cleared' } },
      actor: { uid: 'uid-1', actorType: 'user' },
    })
    expect(result).toEqual({ from: 'content_complete', to: 'rights_cleared' })
    expect(updateSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lifecycleState: 'rights_cleared' }))
    expect(createSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      decision: 'lifecycle_transition', fromState: 'content_complete', toState: 'rights_cleared',
    }))
  })

  it('throws LifecycleTransitionNotAllowedError for a disallowed jump', async () => {
    const { db } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'draft', deleted: false })
    await expect(executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'rights_cleared',
      guardData: {}, actor: { uid: 'uid-1', actorType: 'user' },
    })).rejects.toBeInstanceOf(LifecycleTransitionNotAllowedError)
  })

  it('throws LifecycleStateTooLowError with blockers when the guard fails', async () => {
    const { db } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'content_complete', deleted: false })
    await expect(executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'rights_cleared',
      guardData: { rightsLedger: { status: 'needs_review' } },
      actor: { uid: 'uid-1', actorType: 'user' },
    })).rejects.toBeInstanceOf(LifecycleStateTooLowError)
  })

  it('requires a reason when reopening to draft', async () => {
    const { db } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'assembled', deleted: false })
    await expect(executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'draft',
      guardData: {}, actor: { uid: 'uid-1', actorType: 'user' },
    })).rejects.toBeInstanceOf(LifecycleReopenReasonRequiredError)
  })

  it('allows reopening to draft when a reason is given', async () => {
    const { db, updateSpy } = makeFakeDb({ orgId: 'org-1', lifecycleState: 'assembled', deleted: false })
    const result = await executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'draft',
      guardData: {}, actor: { uid: 'uid-1', actorType: 'user' }, reason: 'Client requested rewrite',
    })
    expect(result.to).toBe('draft')
    expect(updateSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lifecycleState: 'draft' }))
  })

  it('throws when the project belongs to another org', async () => {
    const { db } = makeFakeDb({ orgId: 'org-2', lifecycleState: 'draft', deleted: false })
    await expect(executeLifecycleTransition({
      db, orgId: 'org-1', projectId: 'proj-1', toState: 'content_complete',
      guardData: {}, actor: { uid: 'uid-1', actorType: 'user' },
    })).rejects.toBeInstanceOf(LifecycleTransitionNotAllowedError)
  })
})

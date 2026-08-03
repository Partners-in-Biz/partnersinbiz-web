import {
  buildMilestoneRevenueSchedule,
  buildRecognitionJournalLines,
  buildReversalJournalLines,
  buildStraightLineRevenueSchedule,
  deferredBalanceFrom,
  FinanceValidationError,
  recognizedBps,
  scheduleLinesTotal,
} from '@/lib/accounting/revenue-recognition'
import { InMemoryRevenueRecognitionService } from '@/lib/accounting/revenue-recognition-service'
import type { FinanceActorContext } from '@/lib/finance/types'

const scope = { orgId: 'org-a', legalEntityId: 'entity-a', bookId: 'book-a' }

function actor(uid = 'admin-1', role: FinanceActorContext['assignments'][number]['role'] = 'finance_admin'): FinanceActorContext {
  return {
    uid,
    orgId: scope.orgId,
    membershipRole: 'admin',
    membershipActive: true,
    financeModuleEnabled: true,
    assignments: [{
      id: `asg-${uid}`,
      orgId: scope.orgId,
      userId: uid,
      legalEntityId: scope.legalEntityId,
      scopeMode: 'entity',
      role,
      status: 'active',
    }],
  }
}

describe('revenue recognition golden schedules (pure)', () => {
  test('straight-line remainder absorbed in final month', () => {
    const lines = buildStraightLineRevenueSchedule({
      totalContractMinor: 100_00,
      months: 3,
      startDate: '2026-01-15',
      scheduleId: 'sch1',
    })
    expect(lines).toHaveLength(3)
    expect(lines.map((l) => l.amountMinor)).toEqual([3333, 3333, 3334])
    expect(scheduleLinesTotal(lines)).toBe(100_00)
    expect(lines[0].periodKey).toBe('2026-01')
    expect(lines[2].periodKey).toBe('2026-03')
    expect(lines.every((l) => l.status === 'pending')).toBe(true)
  })

  test('divisible retainer 12 x 10_000', () => {
    const lines = buildStraightLineRevenueSchedule({
      totalContractMinor: 120_000_00,
      months: 12,
      startDate: '2026-01-01',
      scheduleId: 'retainer',
    })
    expect(lines).toHaveLength(12)
    expect(lines.every((l) => l.amountMinor === 10_000_00)).toBe(true)
    expect(lines[11].cumulativeMinor).toBe(120_000_00)
  })

  test('milestone amounts must sum to total', () => {
    const lines = buildMilestoneRevenueSchedule({
      scheduleId: 'm1',
      totalContractMinor: 50_000_00,
      milestones: [
        { code: 'kickoff', name: 'Kickoff', amountMinor: 20_000_00, periodKey: '2026-01' },
        { code: 'delivery', name: 'Delivery', amountMinor: 30_000_00, periodKey: '2026-03' },
      ],
    })
    expect(lines).toHaveLength(2)
    expect(scheduleLinesTotal(lines)).toBe(50_000_00)
    expect(() => buildMilestoneRevenueSchedule({
      scheduleId: 'bad',
      totalContractMinor: 10_00,
      milestones: [{ code: 'a', amountMinor: 4_00 }],
    })).toThrow(FinanceValidationError)
  })

  test('journal lines balance and reverse', () => {
    const forward = buildRecognitionJournalLines({
      deferredRevenueAccountId: 'liab',
      revenueAccountId: 'rev',
      amountMinor: 5_000,
      description: 'Jan',
    })
    expect(forward[0].debitMinor).toBe(5_000)
    expect(forward[1].creditMinor).toBe(5_000)
    const reverse = buildReversalJournalLines({
      deferredRevenueAccountId: 'liab',
      revenueAccountId: 'rev',
      amountMinor: 5_000,
      description: 'Rev',
    })
    expect(reverse[0].debitMinor).toBe(5_000)
    expect(reverse[1].creditMinor).toBe(5_000)
    expect(deferredBalanceFrom({ billedMinor: 100, recognizedMinor: 40 })).toBe(60)
    expect(recognizedBps(25, 100)).toBe(2500)
  })
})

describe('revenue recognition lifecycle service', () => {
  test('AR-linked straight-line schedule → period post → reverse with audit; hard gates false', async () => {
    const svc = new InMemoryRevenueRecognitionService()
    const admin = actor('admin-1')
    const poster = actor('poster-1', 'finance_approver')

    const schedule = await svc.createSchedule(admin, {
      id: 'sch-1',
      ...scope,
      scheduleNumber: 'RR-1',
      name: 'Retainer Acme',
      arInvoiceId: 'inv-acme-1',
      contractRef: 'MSA-1',
      currency: 'ZAR',
      method: 'straight_line',
      totalContractMinor: 9_000,
      months: 3,
      startDate: '2026-01-01',
      deferredRevenueAccountId: 'acc-def',
      revenueAccountId: 'acc-rev',
      expectedVersion: 0,
      requestId: 'r1',
      idempotencyKey: 'idem-sch',
    })
    expect(schedule.status).toBe('draft')
    expect(schedule.deferredBalanceMinor).toBe(9_000)
    expect(schedule.lines).toHaveLength(3)
    expect(schedule.sarsSubmissionInitiated).toBe(false)
    expect(schedule.externalPaymentInitiated).toBe(false)
    expect(schedule.externalEgressAllowed).toBe(false)

    const active = await svc.activateSchedule(admin, {
      id: schedule.id,
      ...scope,
      expectedVersion: 1,
      requestId: 'r2',
      idempotencyKey: 'idem-act',
    })
    expect(active.status).toBe('active')

    const run = await svc.createRecognitionRun(admin, {
      id: 'run-2026-01',
      ...scope,
      periodKey: '2026-01',
      postingDate: '2026-01-31',
      expectedVersion: 0,
      requestId: 'r3',
      idempotencyKey: 'idem-run',
    })
    const calculated = await svc.calculateRecognitionRun(admin, {
      id: run.id,
      ...scope,
      expectedVersion: 1,
      requestId: 'r4',
      idempotencyKey: 'idem-calc',
    })
    expect(calculated.status).toBe('calculated')
    expect(calculated.itemCount).toBe(1)
    expect(calculated.totalRecognizedMinor).toBe(3_000)

    const posted = await svc.postRecognitionRun(poster, {
      id: run.id,
      ...scope,
      approvalId: 'appr-1',
      reason: 'January recognition',
      expectedVersion: calculated.version,
      requestId: 'r5',
      idempotencyKey: 'idem-post',
    })
    expect(posted.status).toBe('approved_posted')
    expect(posted.journalEntryId).toBeTruthy()
    expect(posted.externalEgressAllowed).toBe(false)

    let sch = svc.storeRef.current.schedules.get('sch-1')!
    expect(sch.recognizedMinor).toBe(3_000)
    expect(sch.deferredBalanceMinor).toBe(6_000)
    expect(sch.lines[0].status).toBe('recognized')

    const deferred = await svc.deferredRevenueReport(admin, scope, '2026-01')
    expect(deferred.totalDeferredMinor).toBe(6_000)
    expect(deferred.totalRecognizedMinor).toBe(3_000)
    expect(deferred.totalBilledMinor).toBe(9_000)

    const vs = await svc.recognizedVsBilledReport(admin, scope, '2026-01')
    expect(vs.recognizedBps).toBe(3333)

    const reversed = await svc.reverseRecognitionRun(poster, {
      id: run.id,
      ...scope,
      approvalId: 'appr-rev',
      reason: 'Adjust January',
      expectedVersion: posted.version,
      requestId: 'r6',
      idempotencyKey: 'idem-rev',
    })
    expect(reversed.status).toBe('reversed')
    expect(reversed.reversalJournalEntryId).toBeTruthy()

    sch = svc.storeRef.current.schedules.get('sch-1')!
    expect(sch.recognizedMinor).toBe(0)
    expect(sch.deferredBalanceMinor).toBe(9_000)
    expect(sch.lines[0].status).toBe('pending')
    expect(sch.status).toBe('active')

    const audits = [...svc.storeRef.current.auditEvents.values()]
    expect(audits.some((a) => a.eventType === 'revenue.recognition.run.post')).toBe(true)
    expect(audits.some((a) => a.eventType === 'revenue.recognition.run.reverse')).toBe(true)
    expect(audits.every((a) => a.externalEgressAllowed === false)).toBe(true)

    // tenant isolation: other org sees empty
    const other = actor('x')
    other.orgId = 'org-b'
    other.assignments[0].orgId = 'org-b'
    await expect(svc.getSchedule(other, { ...scope, orgId: 'org-b' }, 'sch-1')).rejects.toThrow(/not found/i)
  })

  test('milestone schedule recognizes selected codes in period run', async () => {
    const svc = new InMemoryRevenueRecognitionService()
    const admin = actor('admin-1')
    const poster = actor('poster-1', 'finance_approver')

    await svc.createSchedule(admin, {
      id: 'sch-m',
      ...scope,
      scheduleNumber: 'RR-M',
      name: 'Project milestones',
      currency: 'ZAR',
      method: 'milestone',
      totalContractMinor: 50_000,
      startDate: '2026-02-01',
      milestones: [
        { code: 'M1', amountMinor: 20_000, periodKey: '2026-02' },
        { code: 'M2', amountMinor: 30_000 },
      ],
      deferredRevenueAccountId: 'acc-def',
      revenueAccountId: 'acc-rev',
      expectedVersion: 0,
      requestId: 'm1',
      idempotencyKey: 'idem-m-sch',
    })
    await svc.activateSchedule(admin, {
      id: 'sch-m',
      ...scope,
      expectedVersion: 1,
      requestId: 'm2',
      idempotencyKey: 'idem-m-act',
    })

    const run = await svc.createRecognitionRun(admin, {
      id: 'run-m',
      ...scope,
      periodKey: '2026-02',
      postingDate: '2026-02-28',
      expectedVersion: 0,
      requestId: 'm3',
      idempotencyKey: 'idem-m-run',
    })
    // periodKey match on M1 only
    const calc = await svc.calculateRecognitionRun(admin, {
      id: run.id,
      ...scope,
      expectedVersion: 1,
      requestId: 'm4',
      idempotencyKey: 'idem-m-calc',
    })
    expect(calc.totalRecognizedMinor).toBe(20_000)
    expect(calc.itemCount).toBe(1)

    await svc.postRecognitionRun(poster, {
      id: run.id,
      ...scope,
      approvalId: 'a',
      reason: 'M1',
      expectedVersion: calc.version,
      requestId: 'm5',
      idempotencyKey: 'idem-m-post',
    })

    // second period with explicit milestone code
    const run2 = await svc.createRecognitionRun(admin, {
      id: 'run-m2',
      ...scope,
      periodKey: '2026-03',
      postingDate: '2026-03-31',
      expectedVersion: 0,
      requestId: 'm6',
      idempotencyKey: 'idem-m-run2',
    })
    const calc2 = await svc.calculateRecognitionRun(admin, {
      id: run2.id,
      ...scope,
      milestoneCodes: ['M2'],
      expectedVersion: 1,
      requestId: 'm7',
      idempotencyKey: 'idem-m-calc2',
    })
    expect(calc2.totalRecognizedMinor).toBe(30_000)
    const posted2 = await svc.postRecognitionRun(poster, {
      id: run2.id,
      ...scope,
      approvalId: 'a2',
      reason: 'M2',
      expectedVersion: calc2.version,
      requestId: 'm8',
      idempotencyKey: 'idem-m-post2',
    })
    expect(posted2.status).toBe('approved_posted')
    const sch = svc.storeRef.current.schedules.get('sch-m')!
    expect(sch.status).toBe('completed')
    expect(sch.deferredBalanceMinor).toBe(0)
    expect(sch.recognizedMinor).toBe(50_000)
  })
})

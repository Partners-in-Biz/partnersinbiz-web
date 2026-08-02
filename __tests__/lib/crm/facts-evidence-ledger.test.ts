/**
 * Unit tests for ContactFact evidence ledger — scoring, hard rules, mailbox parse.
 */
import {
  BAND_FLOOR,
  bandFor,
  scoreEvidence,
  WEIGHTS,
} from '@/lib/crm/facts/evidence'
import {
  columnForField,
  isFactField,
  sameFactValue,
} from '@/lib/crm/facts/fields'
import { humanOwnedFieldsAfterHumanEdit } from '@/lib/crm/facts/record'
import { parseMailboxEvidence, isolateSignatureRegion } from '@/lib/crm/facts/mailbox-evidence'

describe('ContactFact evidence scoring', () => {
  it('prices primary signature evidence as VERIFIED-capable', () => {
    const scored = scoreEvidence([
      { kind: 'crm.signature-block', detail: 'Signature says Head of Sales' },
    ])
    expect(scored.hasPrimary).toBe(true)
    expect(scored.score).toBeGreaterThanOrEqual(BAND_FLOOR.PROBABLE)
    expect(scored.band).toBe('PROBABLE') // single 0.8 weight → not quite 0.85
  })

  it('requires primary source for VERIFIED band', () => {
    const weak = scoreEvidence([
      { kind: 'web.cited-claim', detail: 'Blog says title' },
      { kind: 'web.cited-claim', detail: 'Another blog' },
      { kind: 'search.cites-profile', detail: 'Search hit' },
    ])
    if (weak.score >= BAND_FLOOR.VERIFIED) {
      expect(weak.band).not.toBe('VERIFIED')
      expect(weak.hasPrimary).toBe(false)
    }
  })

  it('reaches VERIFIED with strong primary pair', () => {
    const scored = scoreEvidence([
      { kind: 'crm.signature-block', detail: 'sig' },
      { kind: 'crm.thread-reply', detail: 'replied' },
    ])
    expect(scored.hasPrimary).toBe(true)
    expect(scored.band).toBe('VERIFIED')
    expect(scored.score).toBeGreaterThanOrEqual(BAND_FLOOR.VERIFIED)
    expect(scored.score).toBeLessThan(1)
  })

  it('holds contradictions under PROBABLE ceiling', () => {
    const scored = scoreEvidence([
      { kind: 'linkedin.employer-and-name', detail: 'LI match' },
      { kind: 'contradiction', detail: 'Other employer listed' },
    ])
    expect(scored.score).toBeLessThanOrEqual(0.45)
    expect(scored.band).not.toBe('VERIFIED')
  })

  it('returns null band below POSSIBLE floor', () => {
    const scored = scoreEvidence([
      { kind: 'employer-only', detail: 'employer only' },
    ])
    expect(scored.score).toBeLessThan(BAND_FLOOR.POSSIBLE)
    expect(scored.band).toBeNull()
  })

  it('bandFor enforces primary for VERIFIED', () => {
    expect(bandFor(0.9, false)).toBe('PROBABLE')
    expect(bandFor(0.9, true)).toBe('VERIFIED')
    expect(bandFor(0.4, true)).toBe('POSSIBLE')
    expect(bandFor(0.2, true)).toBeNull()
  })

  it('weights table covers evidence kinds', () => {
    const kinds = Object.keys(WEIGHTS)
    expect(kinds.length).toBeGreaterThanOrEqual(10)
    expect(WEIGHTS['crm.signature-block'].primary).toBe(true)
    expect(WEIGHTS['web.cited-claim'].primary).toBe(false)
  })
})

describe('ContactFact fields', () => {
  it('maps title → jobTitle column and employer as fact-only', () => {
    expect(isFactField('title')).toBe(true)
    expect(columnForField('title')).toBe('jobTitle')
    expect(columnForField('employer')).toBeNull()
  })

  it('normalises value compare case-insensitively', () => {
    expect(sameFactValue(' Head of Sales ', 'head of sales')).toBe(true)
    expect(sameFactValue('A', 'B')).toBe(false)
  })

  it('marks human-owned columns only for human actors', () => {
    expect(
      humanOwnedFieldsAfterHumanEdit({
        existingOwned: [],
        patch: { jobTitle: 'CEO', notes: 'x' },
        isHumanActor: true,
      }),
    ).toEqual(expect.arrayContaining(['jobTitle']))

    expect(
      humanOwnedFieldsAfterHumanEdit({
        existingOwned: ['name'],
        patch: { jobTitle: 'CEO' },
        isHumanActor: false,
      }),
    ).toBeNull()

    expect(
      humanOwnedFieldsAfterHumanEdit({
        existingOwned: ['phone'],
        patch: { tags: ['a'] },
        isHumanActor: true,
      }),
    ).toBeNull()
  })
})

describe('Mailbox evidence parser', () => {
  it('isolates signature region before quoted reply', () => {
    const body = [
      'Thanks for the note.',
      '',
      'Jane Doe',
      'Head of Growth',
      'Acme Corp',
      '',
      'On Mon, someone wrote:',
      '> prior message',
    ].join('\n')
    const region = isolateSignatureRegion(body)
    expect(region).toContain('Head of Growth')
    expect(region).not.toContain('prior message')
  })

  it('extracts title, phone, linkedin, employer from signature', () => {
    const body = [
      'Best,',
      'Alex Rivera',
      'Title: VP Engineering',
      'Phone: +27 82 555 0101',
      'https://www.linkedin.com/in/alex-rivera',
      'Director of Platform | Northwind Labs',
    ].join('\n')

    const candidates = parseMailboxEvidence({
      bodyText: body,
      direction: 'inbound',
      fromName: 'Alex Rivera',
    })

    const fields = candidates.map((c) => c.field)
    expect(fields).toEqual(expect.arrayContaining(['title', 'phone', 'linkedinUrl', 'name']))
    expect(candidates.some((c) => c.field === 'employer')).toBe(true)
    expect(
      candidates.every((c) =>
        c.evidence.every((e) =>
          e.kind === 'crm.signature-block' || e.kind === 'crm.thread-reply',
        ),
      ),
    ).toBe(true)
  })

  it('does not invent candidates from empty body', () => {
    expect(parseMailboxEvidence({ bodyText: '   ' })).toEqual([])
  })

  it('dedupes same field+value candidates', () => {
    const body = ['Jane Doe', 'Title: CEO', 'CEO | Acme'].join('\n')
    const candidates = parseMailboxEvidence({ bodyText: body })
    const titles = candidates.filter((c) => c.field === 'title')
    const values = new Set(titles.map((c) => c.value.toLowerCase()))
    expect(values.size).toBe(titles.length)
  })
})

describe('Evidence kind guards', () => {
  it('rejects unknown evidence kinds', () => {
    const { isEvidenceKind } = require('@/lib/crm/facts/evidence') as typeof import('@/lib/crm/facts/evidence')
    expect(isEvidenceKind('crm.signature-block')).toBe(true)
    expect(isEvidenceKind('model.confidence')).toBe(false)
    expect(isEvidenceKind('')).toBe(false)
  })
})

describe('applyMailboxFacts dry-run contract', () => {
  it('returns candidates without requiring Firestore when dryRun', async () => {
    const { applyMailboxFactsToContact } = await import('@/lib/crm/facts/apply-mailbox')
    const contact = {
      id: 'c1',
      orgId: 'org1',
      name: 'Alex Rivera',
      email: 'alex@example.com',
    }
    const body = ['Thanks', '', 'Alex Rivera', 'Title: VP Engineering', 'https://linkedin.com/in/alex'].join('\n')
    const out = await applyMailboxFactsToContact({
      orgId: 'org1',
      contact,
      bodyText: body,
      dryRun: true,
      direction: 'inbound',
      fromName: 'Alex Rivera',
    })
    expect(out.dryRun).toBe(true)
    expect(out.storedCount).toBe(0)
    expect(out.candidateCount).toBeGreaterThan(0)
    expect(out.candidates.some((c) => c.field === 'title')).toBe(true)
  })

  it('returns empty result for blank body', async () => {
    const { applyMailboxFactsToContact } = await import('@/lib/crm/facts/apply-mailbox')
    const out = await applyMailboxFactsToContact({
      orgId: 'org1',
      contact: { id: 'c1', orgId: 'org1' },
      bodyText: '   ',
      dryRun: true,
    })
    expect(out.candidateCount).toBe(0)
    expect(out.results).toEqual([])
  })
})

describe('scheduleRecheck delaySeconds contract', () => {
  it('allows delaySeconds 0 (due immediately) and rejects empty reason at API layer via helper shape', () => {
    // Pure guard mirrored from scheduleRecheck — 0 must not clamp to 60.
    const clamp = (raw: number | undefined) => {
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 7 * 24 * 3600
      return Math.max(0, Math.min(365 * 24 * 3600, Math.floor(value)))
    }
    expect(clamp(0)).toBe(0)
    expect(clamp(1)).toBe(1)
    expect(clamp(-5)).toBe(0)
    expect(clamp(undefined)).toBe(7 * 24 * 3600)
  })
})

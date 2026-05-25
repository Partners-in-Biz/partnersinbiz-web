import { NextRequest } from 'next/server'
import { isSuppressed } from '@/lib/email/suppressions'
import { shouldSendToContact } from '@/lib/preferences/store'
import { isWithinFrequencyCap, logFrequencySkip } from '@/lib/email/frequency'

const mockGet = jest.fn()
const mockUpdate = jest.fn()
const mockAdd = jest.fn()
const mockDoc = jest.fn()
const mockWhere = jest.fn()
const mockCollection = jest.fn()
const mockSendCampaignEmail = jest.fn()
const mockResolveFrom = jest.fn()

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: { collection: mockCollection },
}))

jest.mock('@/lib/email/resend', () => ({
  sendCampaignEmail: (...args: unknown[]) => mockSendCampaignEmail(...args),
}))

jest.mock('@/lib/email/resolveFrom', () => ({
  resolveFrom: (...args: unknown[]) => mockResolveFrom(...args),
}))

jest.mock('@/lib/email/suppressions', () => ({
  isSuppressed: jest.fn().mockResolvedValue(false),
}))

jest.mock('@/lib/preferences/store', () => ({
  shouldSendToContact: jest.fn().mockResolvedValue({ allowed: true }),
}))

jest.mock('@/lib/email/frequency', () => ({
  isWithinFrequencyCap: jest.fn().mockResolvedValue({ allowed: true }),
  logFrequencySkip: jest.fn().mockResolvedValue(undefined),
}))

process.env.CRON_SECRET = 'cron-secret'

const scheduledEmailDoc = {
  id: 'email-1',
  data: () => ({
    orgId: 'org-1',
    contactId: 'contact-1',
    to: 'Ada@Example.com',
    cc: [],
    subject: 'Hello {{name}}',
    bodyHtml: '<p>Hello {{name}}</p>',
    bodyText: 'Hello {{name}}',
    campaignId: 'campaign-1',
    topicId: 'newsletter',
  }),
}

function setupFirestore() {
  const query = { where: mockWhere, get: mockGet }
  mockWhere.mockReturnValue(query)
  mockDoc.mockReturnValue({ get: mockGet, update: mockUpdate })
  mockCollection.mockReturnValue({ where: mockWhere, get: mockGet, doc: mockDoc, add: mockAdd })
  mockGet
    .mockResolvedValueOnce({ docs: [scheduledEmailDoc] })
    .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Test Org' }) })
    .mockResolvedValueOnce({ exists: true, data: () => ({ fromName: 'Test Org' }) })
    .mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Ada', email: 'ada@example.com' }) })
}

async function runCron() {
  setupFirestore()
  mockResolveFrom.mockResolvedValue({ from: 'Test Org <hello@example.com>' })
  mockSendCampaignEmail.mockResolvedValue({ ok: true, resendId: 'resend-1', provider: 'resend' })
  const { GET } = await import('@/app/api/cron/emails/route')
  const req = new NextRequest('http://localhost/api/cron/emails', {
    headers: { Authorization: 'Bearer cron-secret' },
  })
  return GET(req)
}

describe('GET /api/cron/emails send gates', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGet.mockReset()
    mockWhere.mockReset()
    mockDoc.mockReset()
    mockCollection.mockReset()
    ;(isSuppressed as jest.Mock).mockResolvedValue(false)
    ;(shouldSendToContact as jest.Mock).mockResolvedValue({ allowed: true })
    ;(isWithinFrequencyCap as jest.Mock).mockResolvedValue({ allowed: true })
  })

  it('skips scheduled campaign/one-off email when recipient is suppressed before provider dispatch', async () => {
    ;(isSuppressed as jest.Mock).mockResolvedValue(true)

    const res = await runCron()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.processed).toBe(0)
    expect(isSuppressed).toHaveBeenCalledWith('org-1', 'Ada@Example.com')
    expect(mockSendCampaignEmail).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped',
      skippedReason: 'suppressed',
    }))
  })

  it('skips scheduled campaign/one-off email when topic preferences or global unsubscribe block it', async () => {
    ;(shouldSendToContact as jest.Mock).mockResolvedValue({ allowed: false, reason: 'opted out of topic newsletter' })

    await runCron()

    expect(shouldSendToContact).toHaveBeenCalledWith({
      contactId: 'contact-1',
      orgId: 'org-1',
      topicId: 'newsletter',
    })
    expect(mockSendCampaignEmail).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped',
      skippedReason: 'opted out of topic newsletter',
    }))
  })

  it('skips scheduled campaign/one-off email when the frequency cap is exceeded', async () => {
    ;(isWithinFrequencyCap as jest.Mock).mockResolvedValue({ allowed: false, reason: 'daily cap exceeded' })

    await runCron()

    expect(isWithinFrequencyCap).toHaveBeenCalledWith('org-1', 'contact-1', 'newsletter')
    expect(logFrequencySkip).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-1',
      contactId: 'contact-1',
      topicId: 'newsletter',
      source: 'campaign',
      sourceId: 'campaign-1',
      reason: 'daily cap exceeded',
    }))
    expect(mockSendCampaignEmail).not.toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'skipped',
      skippedReason: 'daily cap exceeded',
    }))
  })
})

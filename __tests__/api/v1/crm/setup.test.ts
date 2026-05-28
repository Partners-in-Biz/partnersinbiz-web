import type { CrmSetupState } from '@/lib/crm/setup/types'

jest.mock('@/lib/firebase/admin', () => ({
  adminAuth: { verifySessionCookie: jest.fn() },
  adminDb: { collection: jest.fn(), batch: jest.fn() },
}))

jest.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: () => ({ seconds: 1000, nanoseconds: 0, toDate: () => new Date() }),
  },
}))

jest.mock('@/lib/pipelines/store', () => ({
  assertStagesValid: jest.fn(),
  clearOtherDefaults: jest.fn(),
}))

import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { seedOrgMember, callAsMember } from '../../../helpers/crm'
import { assertStagesValid, clearOtherDefaults } from '@/lib/pipelines/store'

process.env.SESSION_COOKIE_NAME = '__session'

let setupState: Partial<CrmSetupState> | null
let pipelineSet: jest.Mock
let crmSetupSet: jest.Mock
let pipelineDuplicateExists: boolean

function stageAuth(member: ReturnType<typeof seedOrgMember>) {
  ;(adminAuth.verifySessionCookie as jest.Mock).mockResolvedValue({ uid: member.uid })
  ;(adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'users') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ activeOrgId: member.orgId }) }),
        }),
      }
    }
    if (name === 'orgMembers') {
      return {
        where: jest.fn().mockReturnThis(),
        get: () => Promise.resolve({
          docs: [{
            id: `${member.orgId}_${member.uid}`,
            data: () => member,
          }],
        }),
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => member }),
        }),
      }
    }
    if (name === 'organizations') {
      return {
        doc: () => ({
          get: () => Promise.resolve({ exists: true, data: () => ({ settings: { permissions: {} } }) }),
        }),
      }
    }
    if (name === 'crmSetup') {
      return {
        doc: (id: string) => ({
          id,
          get: () => Promise.resolve({
            exists: setupState !== null,
            data: () => setupState,
          }),
          set: crmSetupSet,
        }),
      }
    }
    if (name === 'pipelines') {
      return {
        doc: jest.fn().mockReturnValue({
          id: 'pipeline-template-id',
          set: pipelineSet,
        }),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
          empty: !pipelineDuplicateExists,
          docs: pipelineDuplicateExists
            ? [{
                id: 'existing-pipeline-id',
                data: () => ({ orgId: member.orgId, name: 'Simple sales pipeline', stages: [], isDefault: false, archived: false }),
              }]
            : [],
        }),
      }
    }
    return { doc: () => ({ get: () => Promise.resolve({ exists: false }) }) }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let setupRoute: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let applyRoute: any

beforeAll(async () => {
  setupRoute = await import('@/app/api/v1/crm/setup/route')
  applyRoute = await import('@/app/api/v1/crm/setup/apply-template/route')
})

beforeEach(() => {
  jest.clearAllMocks()
  setupState = null
  pipelineDuplicateExists = false
  pipelineSet = jest.fn().mockResolvedValue(undefined)
  crmSetupSet = jest.fn().mockImplementation((data: Partial<CrmSetupState>) => {
    setupState = { ...setupState, ...data }
    return Promise.resolve()
  })
  ;(assertStagesValid as jest.Mock).mockImplementation(() => undefined)
  ;(clearOtherDefaults as jest.Mock).mockResolvedValue(undefined)
})

describe('CRM setup state', () => {
  it('GET returns default setup and starter templates for the active org', async () => {
    const member = seedOrgMember('org-setup-a', 'setup-viewer', { role: 'viewer' })
    stageAuth(member)

    const res = await setupRoute.GET(callAsMember(member, 'GET', '/api/v1/crm/setup'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.setup.orgId).toBe('org-setup-a')
    expect(body.data.setup.importStatus).toBe('not_started')
    expect(body.data.templates.some((template: { kind: string }) => template.kind === 'pipeline')).toBe(true)
  })

  it('PUT persists setup answers under the authenticated workspace', async () => {
    const member = seedOrgMember('org-setup-b', 'setup-member', { role: 'member' })
    stageAuth(member)

    const res = await setupRoute.PUT(callAsMember(member, 'PUT', '/api/v1/crm/setup', {
      salesProcess: 'mixed',
      importStatus: 'planning',
      gmailIntent: 'connect_now',
      pipelinePreference: 'consultative_sales',
      selectedTemplateIds: ['pipeline-consultative', 'sequence-new-lead', 'pipeline-consultative'],
      notes: 'Need to clean source CSV first.',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(crmSetupSet).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-setup-b',
        salesProcess: 'mixed',
        importStatus: 'planning',
        gmailIntent: 'connect_now',
        pipelinePreference: 'consultative_sales',
        selectedTemplateIds: ['pipeline-consultative', 'sequence-new-lead'],
        updatedBy: 'setup-member',
      }),
      { merge: true },
    )
  })
})

describe('CRM setup starter template application', () => {
  it('creates a pipeline from a starter template and records it on setup state', async () => {
    const member = seedOrgMember('org-setup-c', 'setup-admin', { role: 'admin' })
    stageAuth(member)

    const res = await applyRoute.POST(callAsMember(member, 'POST', '/api/v1/crm/setup/apply-template', {
      templateId: 'pipeline-simple-sales',
      makeDefault: true,
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.applied).toBe(true)
    expect(body.data.pipeline.orgId).toBe('org-setup-c')
    expect(body.data.pipeline.name).toBe('Simple sales pipeline')
    expect(pipelineSet).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-setup-c',
      name: 'Simple sales pipeline',
      isDefault: true,
    }))
    expect(clearOtherDefaults).toHaveBeenCalledWith('org-setup-c', 'pipeline-template-id')
    expect(crmSetupSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        orgId: 'org-setup-c',
        appliedPipelineTemplateIds: ['pipeline-simple-sales'],
      }),
      { merge: true },
    )
  })

  it('does not recreate a pipeline template when one with the same name already exists', async () => {
    const member = seedOrgMember('org-setup-d', 'setup-admin-dup', { role: 'admin' })
    pipelineDuplicateExists = true
    stageAuth(member)

    const res = await applyRoute.POST(callAsMember(member, 'POST', '/api/v1/crm/setup/apply-template', {
      templateId: 'pipeline-simple-sales',
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.applied).toBe(false)
    expect(body.data.reason).toBe('already_exists')
    expect(pipelineSet).not.toHaveBeenCalled()
  })
})

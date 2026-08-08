jest.mock('../../../services/agent-watcher/src/firestore', () => ({
  db: { collection: jest.fn() },
  FieldValue: {
    serverTimestamp: jest.fn(() => 'SERVER_TIME'),
    delete: jest.fn(() => 'DELETE_FIELD'),
  },
}))

jest.mock('../../../services/agent-watcher/src/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { db } from '../../../services/agent-watcher/src/firestore'
import {
  buildDesignContextPromptBlock,
  loadLatestDesignContext,
} from '../../../services/agent-watcher/src/design-context'

const dbMock = db as unknown as { collection: jest.Mock }

function designDoc(overrides: Record<string, unknown> = {}) {
  return {
    data: () => ({
      orgId: 'org-1',
      kind: 'design',
      status: 'verified',
      deleted: false,
      designContext: {
        audience: 'Small law firms',
        positioning: 'Modern trust',
        brandVoice: 'Clear, calm, confident.',
        antiReferences: ['purple gradients', 'glassmorphism'],
        palette: [
          { name: 'primary', value: '#0F172A' },
          { name: 'accent', value: '#F59E0B', usage: 'CTA buttons' },
        ],
        typeStack: [
          { role: 'heading', family: 'Fraunces' },
          { role: 'body', family: 'Inter' },
        ],
        componentRules: ['Sharp corners', 'Dense tables'],
        radiusScale: [{ name: 'sm', value: '4px' }],
        elevationScale: [{ name: 'md', value: '0 1px 3px rgba(0,0,0,0.1)' }],
        surfaceModes: [{ surface: 'landing', mode: 'persuade' }],
        version: 3,
        source: 'questionnaire',
        sourceUrl: 'https://acme.example/',
      },
      updatedAt: { toMillis: () => 1000 },
      ...overrides,
    }),
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('agent-watcher design-context prompt block', () => {
  it('loads the latest design context record for an org', async () => {
    dbMock.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: [
            designDoc({ updatedAt: { toMillis: () => 500 } }),
            designDoc({ updatedAt: { toMillis: () => 900 } }),
          ],
        }),
      }),
    })
    const record = await loadLatestDesignContext('org-1')
    expect(record).not.toBeNull()
    expect(record?.payload.version).toBe(3)
    expect(dbMock.collection).toHaveBeenCalledWith('research_items')
  })

  it('returns null when org has no design context', async () => {
    dbMock.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }),
    })
    const record = await loadLatestDesignContext('org-empty')
    expect(record).toBeNull()
  })

  it('skips archived/deleted/non-design records', async () => {
    dbMock.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: [
            designDoc({ kind: 'competitor' }),
            designDoc({ deleted: true }),
            designDoc({ status: 'archived' }),
            designDoc({ designContext: undefined }),
          ],
        }),
      }),
    })
    const record = await loadLatestDesignContext('org-1')
    expect(record).toBeNull()
  })

  it('builds a prompt block with palette, type, voice, anti-references and modes', async () => {
    dbMock.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: [designDoc()] }),
      }),
    })
    const block = await buildDesignContextPromptBlock('org-1')
    expect(block).toContain('## Design context (per-client)')
    expect(block).toContain('Stay on-brand')
    expect(block).toContain('Audience: Small law firms')
    expect(block).toContain('Brand voice: Clear, calm, confident.')
    expect(block).toContain('Anti-references (avoid): purple gradients; glassmorphism')
    expect(block).toContain('Palette: primary #0F172A | accent #F59E0B (CTA buttons)')
    expect(block).toContain('Type stack: heading Fraunces | body Inter')
    expect(block).toContain('Component rules: Sharp corners; Dense tables')
    expect(block).toContain('Radius scale: sm=4px')
    expect(block).toContain('Surface modes: landing → persuade')
    expect(block).toContain('Source: https://acme.example/')
  })

  it('returns empty string when no orgId or no record', async () => {
    expect(await buildDesignContextPromptBlock(undefined)).toBe('')
    dbMock.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: [] }),
      }),
    })
    expect(await buildDesignContextPromptBlock('org-empty')).toBe('')
  })

  it('degrades gracefully when the store read fails', async () => {
    dbMock.collection.mockReturnValue({
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockRejectedValue(new Error('boom')),
      }),
    })
    expect(await buildDesignContextPromptBlock('org-1')).toBe('')
  })
})

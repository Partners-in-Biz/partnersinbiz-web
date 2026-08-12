import { buildStudioReviewContract } from '../../../lib/design-finish-gate/studio'
import type { StudioAuditStamp } from '../../../lib/design-audit/studio'

describe('finish-gate Studio integration', () => {
  it('builds a contract from a Studio artifact with HTML payloads', () => {
    const contract = buildStudioReviewContract({
      nodeId: 'node_123',
      data: {
        title: 'Welcome email',
        html: '<div><h2>Welcome</h2><p>Body copy here.</p></div>',
        meta: { nested: { bodyHtml: '<section><h3>Deal</h3></section>' } },
      },
      brief: '- Compose a welcome email with the brand palette',
      title: 'Welcome email artifact',
      builderAgentId: 'theo',
      taskId: 'task_abc',
    })
    expect(contract.schema).toBe('pib-design-finish-gate/v1')
    expect(contract.title).toBe('Welcome email artifact')
    expect(contract.taskId).toBe('task_abc')
    expect(contract.brief).toContain('Artifact HTML payloads')
    expect(contract.brief).toContain('html')
    expect(contract.brief).toContain('meta.nested.bodyHtml')
    expect(contract.promises.length).toBeGreaterThan(0)
  })

  it('attaches the designAudit stamp as evidence when present', () => {
    const stamp: StudioAuditStamp = {
      at: '2026-08-09T00:00:00.000Z',
      mode: 'studio',
      summary: { findings: 1, blocked: 1, bySeverity: { P0: 1, P1: 0, P2: 0, P3: 0 } },
      findings: [{ rule: 'purple-gradients', severity: 'P0', message: 'gradient hero', element: 'div', field: 'html' }],
    }
    const contract = buildStudioReviewContract({
      nodeId: 'node_456',
      data: { html: '<div style="background:linear-gradient(#7c3aed,#2563eb)"></div>' },
      brief: '- Publish the campaign email',
      builderAgentId: 'theo',
      designAudit: stamp,
    })
    expect(contract.brief).toContain('Existing design-audit stamp')
    expect(contract.brief).toContain('purple-gradients')
  })

  it('works with no HTML payloads and no stamp', () => {
    const contract = buildStudioReviewContract({
      nodeId: 'node_789',
      data: { plain: 'no markup here' },
      brief: '- Render the dashboard tile',
      builderAgentId: 'theo',
    })
    expect(contract.brief).not.toContain('Artifact HTML payloads')
    expect(contract.brief).not.toContain('Existing design-audit stamp')
    expect(contract.promises.length).toBeGreaterThan(0)
  })
})

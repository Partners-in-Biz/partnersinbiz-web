import { getSoftwareBuildEvidenceRows } from '@/lib/software-build-evidence'

describe('software build evidence rows', () => {
  it('extracts commit refs, verification commands, preview links, related docs, and blockers from agent output', () => {
    const rows = getSoftwareBuildEvidenceRows({
      sourceDocumentId: 'doc-123',
      agentInput: {
        context: {
          approvalGateTaskId: 'gate-1',
        },
      },
      agentOutput: {
        artifacts: [
          { type: 'commit', ref: 'abc1234', label: 'Development commit' },
          { type: 'url', ref: 'https://partnersinbiz.online/admin/projects/project-1?taskId=task-1', label: 'Development task link' },
          { type: 'doc', ref: 'spec-999', label: 'Spec doc' },
        ],
        summary: 'Verification passed: npm run lint -- --file components/briefing/BriefingControlDesk.tsx; npx jest __tests__/components/briefing/BriefingControlDesk.test.tsx\nBlocker: Production deploy still needs Peet approval.',
      },
    })

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'commit', label: 'Development commit', value: 'abc1234' }),
      expect.objectContaining({ kind: 'verification', value: 'npm run lint -- --file components/briefing/BriefingControlDesk' }),
      expect.objectContaining({ kind: 'verification', value: 'npx jest __tests__/components/briefing/BriefingControlDesk' }),
      expect.objectContaining({ kind: 'link', label: 'Development task link', href: 'https://partnersinbiz.online/admin/projects/project-1?taskId=task-1' }),
      expect.objectContaining({ kind: 'document', label: 'Related doc', value: 'doc-123', href: '/admin/documents/doc-123' }),
      expect.objectContaining({ kind: 'document', label: 'Spec doc', value: 'spec-999', href: '/admin/documents/spec-999' }),
      expect.objectContaining({ kind: 'document', label: 'Approval gate', value: 'gate-1' }),
      expect.objectContaining({ kind: 'blocker', value: 'Blocker: Production deploy still needs Peet approval.' }),
    ]))
  })
})

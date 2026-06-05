import { existsSync, readFileSync } from 'fs'
import path from 'path'

const repoRoot = process.cwd()

function source(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('email editor panels shared standard', () => {
  it('keeps reusable email editor helpers out of admin-owned component paths', () => {
    const sharedPanels = [
      'components/email/AiAssistantPanel.tsx',
      'components/email/PreflightPanel.tsx',
      'components/email/AbTestingPanel.tsx',
    ]
    const removedAdminPanels = [
      'components/admin/email/AiAssistantPanel.tsx',
      'components/admin/email/PreflightPanel.tsx',
      'components/admin/email/AbTestingPanel.tsx',
    ]

    for (const panel of sharedPanels) {
      expect(existsSync(path.join(repoRoot, panel))).toBe(true)
    }
    for (const panel of removedAdminPanels) {
      expect(existsSync(path.join(repoRoot, panel))).toBe(false)
    }

    expect(source('components/email/AiAssistantPanel.tsx')).toContain('export default function AiAssistantPanel')
    expect(source('components/email/PreflightPanel.tsx')).toContain('export default function PreflightPanel')
    expect(source('components/email/AbTestingPanel.tsx')).toContain('export default function AbTestingPanel')

    const consumers = [
      'components/admin/broadcasts/BroadcastEditor.tsx',
      'components/admin/email-builder/TemplateEditor.tsx',
      'components/admin/sequences/StepEditor.tsx',
    ]

    for (const consumer of consumers) {
      const consumerSource = source(consumer)
      expect(consumerSource).not.toContain('@/components/admin/email/AiAssistantPanel')
      expect(consumerSource).not.toContain('@/components/admin/email/PreflightPanel')
      expect(consumerSource).not.toContain('@/components/admin/email/AbTestingPanel')
    }

    expect(source('components/admin/broadcasts/BroadcastEditor.tsx')).toContain('@/components/email/AiAssistantPanel')
    expect(source('components/admin/broadcasts/BroadcastEditor.tsx')).toContain('@/components/email/PreflightPanel')
    expect(source('components/admin/email-builder/TemplateEditor.tsx')).toContain('@/components/email/AiAssistantPanel')
    expect(source('components/admin/sequences/StepEditor.tsx')).toContain('@/components/email/PreflightPanel')
  })
})

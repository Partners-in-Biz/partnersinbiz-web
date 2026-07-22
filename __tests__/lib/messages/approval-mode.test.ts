import {
  cleanApprovalMode,
  shouldAutoApproveDangerousCommands,
} from '@/lib/messages/approval-mode'

describe('approval mode helpers', () => {
  it('accepts Hermes-aligned approval modes', () => {
    expect(cleanApprovalMode('ask')).toBe('ask')
    expect(cleanApprovalMode('smart')).toBe('smart')
    expect(cleanApprovalMode('full')).toBe('full')
    expect(cleanApprovalMode('yolo')).toBeNull()
  })

  it('marks full permissions as auto-approve', () => {
    expect(shouldAutoApproveDangerousCommands('full')).toBe(true)
    expect(shouldAutoApproveDangerousCommands('ask')).toBe(false)
    expect(shouldAutoApproveDangerousCommands('smart')).toBe(false)
  })
})

import {
  CONVERSATION_RUN_RECOVERING_USER_ERROR,
  humanizeConversationRunError,
  isConversationBrowserToolFailure,
  isConversationInfrastructureInterrupt,
  isRecoverableConversationRunError,
} from '@/lib/conversations/run-policy'

describe('humanizeConversationRunError', () => {
  it('rewrites agent-browser connect failures into recovery guidance', () => {
    expect(humanizeConversationRunError('Unable to connect. Is the computer able to access the url?'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
  })

  it('maps connection-reset style gateway deaths to recovery guidance', () => {
    expect(humanizeConversationRunError('ClientConnectorError: Connection refused'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
    expect(humanizeConversationRunError('Broken pipe while streaming events'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
    expect(humanizeConversationRunError('Tool terminal returned error exit_code": -15'))
      .toBe(CONVERSATION_RUN_RECOVERING_USER_ERROR)
  })

  it('maps real-profile guard failures to the owner-only browsing message', () => {
    expect(humanizeConversationRunError('real_profile_guard'))
      .toBe("This computer's owner has enabled browsing as themselves; your chat cannot run there.")
  })

  it('maps remaining Appendix C runtime errors to operator-safe chat copy', () => {
    expect(humanizeConversationRunError('org_mismatch'))
      .toBe('This agent profile belongs to a different organisation on that computer. Re-pair the computer.')
    expect(humanizeConversationRunError('grant_not_active'))
      .toBe("The organisation's access to this computer is paused.")
    expect(humanizeConversationRunError('device grant not active'))
      .toBe("The organisation's access to this computer is paused.")
    expect(humanizeConversationRunError('linked_device_hermes_update_required'))
      .toBe('Hermes on this computer is too old. It will update automatically when idle.')
    expect(humanizeConversationRunError('hermes_update_failed'))
      .toBe('Hermes could not update on this computer. It keeps working on the previous version; see the runbook.')
  })

  it('preserves ordinary short errors', () => {
    expect(humanizeConversationRunError('Project is not linked to this computer'))
      .toBe('Project is not linked to this computer')
  })

  it('handles empty input', () => {
    expect(humanizeConversationRunError('')).toMatch(/failed/i)
    expect(humanizeConversationRunError(null)).toMatch(/failed/i)
  })
})

describe('isRecoverableConversationRunError', () => {
  it('classifies browser and infrastructure interrupts as recoverable', () => {
    expect(isConversationBrowserToolFailure('Unable to connect. Is the computer able to access the url?')).toBe(true)
    expect(isConversationInfrastructureInterrupt('Local Hermes pip runtime restarting; reattachment retry window exhausted')).toBe(true)
    expect(isRecoverableConversationRunError('gateway_draining')).toBe(true)
    expect(isRecoverableConversationRunError('Project is not linked to this computer')).toBe(false)
  })
})

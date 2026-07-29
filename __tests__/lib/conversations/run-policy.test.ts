import {
  CONVERSATION_BROWSER_CONNECT_USER_ERROR,
  CONVERSATION_RUN_LOST_ERROR,
  humanizeConversationRunError,
} from '@/lib/conversations/run-policy'

describe('humanizeConversationRunError', () => {
  it('rewrites agent-browser connect failures into actionable guidance', () => {
    expect(humanizeConversationRunError('Unable to connect. Is the computer able to access the url?'))
      .toBe(CONVERSATION_BROWSER_CONNECT_USER_ERROR)
  })

  it('maps connection-reset style gateway deaths to the lost-run message', () => {
    expect(humanizeConversationRunError('ClientConnectorError: Connection refused'))
      .toBe(CONVERSATION_RUN_LOST_ERROR)
    expect(humanizeConversationRunError('Broken pipe while streaming events'))
      .toBe(CONVERSATION_RUN_LOST_ERROR)
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

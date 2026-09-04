import { browsingAsYouPartFromEvents } from '@/lib/conversations/run-finalizer'

describe('browsing as you transcript notice', () => {
  it('prepends a single status part when a run used the owner browser', () => {
    expect(browsingAsYouPartFromEvents([
      { event: 'tool.completed', tool: 'browser' },
      { event: 'browser.real_profile_used', tool: 'browser' },
    ], 'Pip')).toEqual({
      type: 'status',
      title: 'Browsing as you',
      content: 'Pip used your browser logins for part of this reply.',
    })
  })

  it('stays silent when the real profile was not used', () => {
    expect(browsingAsYouPartFromEvents([{ event: 'tool.completed', tool: 'browser' }])).toBeNull()
  })
})

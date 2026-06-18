import { UNIFIED_GOOGLE_WORKSPACE_SCOPES, GOOGLE_WORKSPACE_DRIVE_READ_SCOPES } from '@/lib/mailbox/googleOAuth'

describe('google workspace scopes', () => {
  it('includes drive.metadata.readonly so recent-files listing is permitted', () => {
    expect(GOOGLE_WORKSPACE_DRIVE_READ_SCOPES).toContain('https://www.googleapis.com/auth/drive.metadata.readonly')
    expect(UNIFIED_GOOGLE_WORKSPACE_SCOPES).toContain('https://www.googleapis.com/auth/drive.metadata.readonly')
  })
  it('still requests calendar.events and gmail.readonly', () => {
    expect(UNIFIED_GOOGLE_WORKSPACE_SCOPES).toContain('https://www.googleapis.com/auth/calendar.events')
    expect(UNIFIED_GOOGLE_WORKSPACE_SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly')
  })
})

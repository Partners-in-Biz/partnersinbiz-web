import {
  ADMIN_NOTIFICATION_EVENT_CLASSES,
  buildDefaultAdminNotificationPreference,
  normaliseAdminNotificationPreference,
  canAdminManageNotificationPreference,
  type AdminNotificationPreference,
} from '@/lib/notifications/adminPreferences'

describe('admin notification preference model', () => {
  it('defaults critical client acceptance events on for in-app/push and email', () => {
    const pref = buildDefaultAdminNotificationPreference('admin-1', 'org-client')

    expect(pref.userId).toBe('admin-1')
    expect(pref.orgId).toBe('org-client')
    expect(pref.channels.inApp).toBe(true)
    expect(pref.channels.push).toBe(true)
    expect(pref.channels.email).toBe(true)
    expect(pref.eventClasses.client_acceptance).toEqual({ inApp: true, push: true, email: true })
  })

  it('defaults noisy non-critical events to in-app only', () => {
    const pref = buildDefaultAdminNotificationPreference('admin-1', 'org-client')

    expect(pref.eventClasses.comment).toEqual({ inApp: true, push: false, email: false })
    expect(pref.eventClasses.task).toEqual({ inApp: true, push: false, email: false })
    expect(Object.keys(pref.eventClasses).sort()).toEqual([...ADMIN_NOTIFICATION_EVENT_CLASSES].sort())
  })

  it('merges stored partial preferences with current defaults', () => {
    const stored: Partial<AdminNotificationPreference> = {
      userId: 'admin-1',
      orgId: 'org-client',
      channels: { inApp: false, push: true, email: false },
      eventClasses: {
        client_acceptance: { email: false },
      } as any,
    }

    const pref = normaliseAdminNotificationPreference(stored, 'admin-1', 'org-client')

    expect(pref.channels).toEqual({ inApp: false, push: true, email: false })
    expect(pref.eventClasses.client_acceptance).toEqual({ inApp: true, push: true, email: false })
    expect(pref.eventClasses.comment).toEqual({ inApp: true, push: false, email: false })
  })

  it('allows super admins to manage any client preference and restricted admins only allowed clients', () => {
    expect(canAdminManageNotificationPreference({ uid: 'super-1', role: 'admin' }, 'any-org')).toBe(true)
    expect(
      canAdminManageNotificationPreference(
        { uid: 'restricted-1', role: 'admin', allowedOrgIds: ['org-a'], orgId: 'platform' },
        'org-a',
      ),
    ).toBe(true)
    expect(
      canAdminManageNotificationPreference(
        { uid: 'restricted-1', role: 'admin', allowedOrgIds: ['org-a'], orgId: 'platform' },
        'org-b',
      ),
    ).toBe(false)
  })
})

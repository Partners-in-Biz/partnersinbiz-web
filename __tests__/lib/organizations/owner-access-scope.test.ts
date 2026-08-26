import { effectiveAccessScopeForRole } from '@/lib/organizations/owner-access-scope'

describe('effectiveAccessScopeForRole', () => {
  it('treats a missing accessScope on an owner as all', () => {
    expect(effectiveAccessScopeForRole('owner')).toBe('all')
    expect(effectiveAccessScopeForRole('owner', undefined)).toBe('all')
    expect(effectiveAccessScopeForRole('owner', null)).toBe('all')
    expect(effectiveAccessScopeForRole('owner', '')).toBe('all')
  })

  it('treats none accessScope on an owner as all', () => {
    expect(effectiveAccessScopeForRole('owner', 'none')).toBe('all')
  })

  it('keeps an explicit owner accessScope of all', () => {
    expect(effectiveAccessScopeForRole('owner', 'all')).toBe('all')
  })

  it('does not promote a non-owner missing or none accessScope', () => {
    expect(effectiveAccessScopeForRole('admin')).toBe('none')
    expect(effectiveAccessScopeForRole('member', 'none')).toBe('none')
    expect(effectiveAccessScopeForRole('viewer', undefined)).toBe('none')
  })

  it('preserves a concrete non-owner accessScope', () => {
    expect(effectiveAccessScopeForRole('member', 'crm')).toBe('crm')
    expect(effectiveAccessScopeForRole('admin', 'projects')).toBe('projects')
  })
})

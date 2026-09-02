import {
  brandKitDocId,
  clientVisibilityFieldsForWrite,
  companyFieldsForWrite,
  isClientPrivate,
  isClientShared,
  parseClientVisibility,
  recordCompanyId,
  recordVisibleForWorkScope,
  resolveWorkScope,
  resolveWorkScopeFromRequest,
  resolveWorkScopeFromSearchParams,
  workScopeFieldsForWrite,
} from '@/lib/work-scope'

describe('resolveWorkScope', () => {
  it('resolves personal, company, and org', () => {
    expect(resolveWorkScope({ personal: true, uid: 'u1' })).toEqual({ owner: 'personal', uid: 'u1' })
    expect(resolveWorkScope({ companyId: 'co-1' })).toEqual({ owner: 'company', companyId: 'co-1' })
    expect(resolveWorkScope({ sourceCompanyId: 'co-2' })).toEqual({ owner: 'company', companyId: 'co-2' })
    expect(resolveWorkScope({})).toEqual({ owner: 'org' })
  })

  it('prefers companyId over sourceCompanyId', () => {
    expect(resolveWorkScope({ companyId: 'a', sourceCompanyId: 'b' })).toEqual({
      owner: 'company',
      companyId: 'a',
    })
  })

  it('reads from search params and request body', () => {
    const params = new URLSearchParams('companyId=co-9&scope=org')
    expect(resolveWorkScopeFromSearchParams(params)).toEqual({ owner: 'company', companyId: 'co-9' })
    expect(resolveWorkScopeFromRequest({
      body: { sourceCompanyId: 'co-body' },
      searchParams: new URLSearchParams(),
    })).toEqual({ owner: 'company', companyId: 'co-body' })
  })
})

describe('workScopeFieldsForWrite', () => {
  it('stamps workOwner and marketingOwner alias', () => {
    expect(workScopeFieldsForWrite({ owner: 'company', companyId: 'co-1' })).toEqual({
      workOwner: 'company',
      marketingOwner: 'company',
      companyId: 'co-1',
    })
    expect(workScopeFieldsForWrite({ owner: 'org' })).toEqual({
      workOwner: 'org',
      marketingOwner: 'org',
    })
    expect(workScopeFieldsForWrite({ owner: 'personal', uid: 'u1' })).toMatchObject({
      accountScope: 'personal',
      workOwner: 'personal',
      marketingOwner: 'personal',
      ownerUid: 'u1',
    })
    expect(companyFieldsForWrite('co-3')).toEqual({
      companyId: 'co-3',
      workOwner: 'company',
      marketingOwner: 'company',
    })
  })
})

describe('recordVisibleForWorkScope', () => {
  it('includes company rows in org view by default', () => {
    expect(recordVisibleForWorkScope({ companyId: 'co-1' }, { owner: 'org' })).toBe(true)
    expect(recordVisibleForWorkScope({}, { owner: 'org' })).toBe(true)
    expect(recordVisibleForWorkScope(
      { companyId: 'co-1' },
      { owner: 'org' },
      { orgViewIncludesCompany: false },
    )).toBe(false)
  })

  it('filters company and personal scopes', () => {
    expect(recordVisibleForWorkScope(
      { companyId: 'co-1' },
      { owner: 'company', companyId: 'co-1' },
    )).toBe(true)
    expect(recordVisibleForWorkScope(
      { companyId: 'co-2' },
      { owner: 'company', companyId: 'co-1' },
    )).toBe(false)
    expect(recordVisibleForWorkScope(
      { accountScope: 'personal', ownerUid: 'u1' },
      { owner: 'personal', uid: 'u1' },
    )).toBe(true)
    expect(recordVisibleForWorkScope(
      { accountScope: 'personal', ownerUid: 'u1' },
      { owner: 'org' },
    )).toBe(false)
  })
})

describe('clientVisibility', () => {
  it('defaults unset to shared', () => {
    expect(parseClientVisibility(undefined)).toBe('shared')
    expect(isClientShared({})).toBe(true)
    expect(isClientPrivate({ clientVisibility: 'private' })).toBe(true)
    expect(clientVisibilityFieldsForWrite('private')).toEqual({ clientVisibility: 'private' })
    expect(clientVisibilityFieldsForWrite(undefined)).toEqual({})
  })
})

describe('brandKitDocId / recordCompanyId', () => {
  it('builds stable doc ids', () => {
    expect(brandKitDocId('org1', { owner: 'org' })).toBe('org1')
    expect(brandKitDocId('org1', { owner: 'company', companyId: 'co' })).toBe('org1__company_co')
    expect(brandKitDocId('org1', { owner: 'personal', uid: 'u' })).toBe('org1__personal_u')
    expect(recordCompanyId({ companyId: '  x  ' })).toBe('x')
  })
})

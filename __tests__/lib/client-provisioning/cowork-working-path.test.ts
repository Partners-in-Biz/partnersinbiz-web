import {
  collapseNestedCoworkWorkingPath,
  joinCoworkWorkingPath,
} from '@/lib/client-provisioning/cowork-working-path'

describe('joinCoworkWorkingPath', () => {
  const companyVps = '/var/lib/hermes/Cowork/partners/Hunt and Gun'
  const companyLocal = '/Users/peetstander/Cowork/partners/Hunt and Gun'

  it('joins company-relative project folders normally', () => {
    expect(joinCoworkWorkingPath(companyVps, 'projects/project-1'))
      .toBe(`${companyVps}/projects/project-1`)
    expect(joinCoworkWorkingPath(companyLocal, 'hunt-and-gun-seller-crm'))
      .toBe(`${companyLocal}/hunt-and-gun-seller-crm`)
  })

  it('strips mapping-relative partners/{Company}/ prefixes under a company root', () => {
    expect(joinCoworkWorkingPath(companyVps, 'partners/Hunt and Gun/hunt-and-gun-seller-crm'))
      .toBe(`${companyVps}/hunt-and-gun-seller-crm`)
    expect(joinCoworkWorkingPath(companyLocal, 'partners/Hunt and Gun/projects/p1'))
      .toBe(`${companyLocal}/projects/p1`)
    expect(joinCoworkWorkingPath(companyVps, 'partners/Hunt and Gun'))
      .toBe(companyVps)
  })

  it('strips a bare company-name prefix under partners/', () => {
    expect(joinCoworkWorkingPath(companyVps, 'Hunt and Gun/hunt-and-gun-seller-crm'))
      .toBe(`${companyVps}/hunt-and-gun-seller-crm`)
  })

  it('returns the root when relative is empty', () => {
    expect(joinCoworkWorkingPath(companyVps, '')).toBe(companyVps)
    expect(joinCoworkWorkingPath(companyVps, null)).toBe(companyVps)
  })
})

describe('collapseNestedCoworkWorkingPath', () => {
  it('collapses doubled partners/{Name} segments', () => {
    expect(collapseNestedCoworkWorkingPath(
      '/var/lib/hermes/Cowork/partners/Hunt and Gun/partners/Hunt and Gun/hunt-and-gun-seller-crm',
    )).toBe('/var/lib/hermes/Cowork/partners/Hunt and Gun/hunt-and-gun-seller-crm')
  })

  it('is a no-op for already-canonical paths', () => {
    const good = '/var/lib/hermes/Cowork/partners/Hunt and Gun/hunt-and-gun-seller-crm'
    expect(collapseNestedCoworkWorkingPath(good)).toBe(good)
  })
})

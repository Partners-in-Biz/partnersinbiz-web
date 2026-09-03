import { scanStyleDebt } from '@/scripts/studio-style-baseline'

describe('studio style lint', () => {
  it('allows zero banned-pattern hits in app and components', () => {
    expect(scanStyleDebt()).toEqual({})
  })
})

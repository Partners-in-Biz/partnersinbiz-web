import { readableAccentOnDark } from '@/components/campaign-preview/utils'

describe('readableAccentOnDark', () => {
  it('keeps a brand accent that has enough contrast on black', () => {
    expect(readableAccentOnDark('#8BD8BD', '#0095F6')).toBe('#8BD8BD')
  })

  it('replaces dark brand accents that are unreadable on black cards', () => {
    expect(readableAccentOnDark('#2f5d3a', '#0095F6')).toBe('#0095F6')
  })

  it('uses the fallback for missing or invalid accent values', () => {
    expect(readableAccentOnDark(undefined, '#1D9BF0')).toBe('#1D9BF0')
    expect(readableAccentOnDark('not-a-colour', '#1D9BF0')).toBe('#1D9BF0')
  })
})

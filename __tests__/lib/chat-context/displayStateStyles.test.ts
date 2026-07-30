import { displayStateLabel, displayStateStyle } from '@/lib/chat-context/displayStateStyles'

describe('displayStateStyles', () => {
  it('maps project task states to board-aligned colours', () => {
    expect(displayStateLabel('complete')).toBe('Complete')
    expect(displayStateStyle('complete').rail).toBe('#4ade80')
    expect(displayStateStyle('running').rail).toContain('accent')
    expect(displayStateStyle('needs_input').badgeClassName).toContain('orange')
    expect(displayStateStyle('blocked').rail).toBe('#ef4444')
    expect(displayStateStyle('review').rail).toBe('#c084fc')
    expect(displayStateStyle('ready').rail).toBe('#60a5fa')
  })

  it('falls back safely for unknown states', () => {
    expect(displayStateStyle('mystery').label).toBe('Ready')
  })
})

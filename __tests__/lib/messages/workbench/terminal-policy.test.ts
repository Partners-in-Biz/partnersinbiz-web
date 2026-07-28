import { validateTerminalPolicy } from '@/lib/messages/workbench/terminal-policy'

describe('organisation terminal policy validation', () => {
  it('accepts bounded exact argv commands outside the compiled defaults', () => {
    expect(validateTerminalPolicy([
      ['git', 'status', '--short'],
      ['npm', 'run', 'typecheck'],
    ])).toEqual({
      ok: true,
      value: [
        ['git', 'status', '--short'],
        ['npm', 'run', 'typecheck'],
      ],
    })
  })

  it.each([
    [['sh', '-c', 'echo hello']],
    [['rm', '-rf', '/']],
    [['node', '--version;']],
    [['npm', 'test'], ['npm', 'test']],
  ])('rejects unsafe or duplicate policy %j', (policy) => {
    expect(validateTerminalPolicy(policy).ok).toBe(false)
  })
})

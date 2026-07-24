import {
  ALLOWLISTED_SHELL_ARGV,
  ALLOWLISTED_SHELL_COMMANDS,
  isAllowlistedShellArgv,
  mapShellCommandToArgv,
  normalizeShellArgv,
  parseShellCommandLine,
} from '@/lib/messages/workbench/shell-allowlist'

describe('ALLOWLISTED_SHELL_COMMANDS', () => {
  it('mirrors the argv templates as space-joined human-readable commands', () => {
    expect(ALLOWLISTED_SHELL_COMMANDS).toContain('node --version')
    expect(ALLOWLISTED_SHELL_COMMANDS).toContain('git log --oneline -n 20')
    expect(ALLOWLISTED_SHELL_COMMANDS.length).toBe(ALLOWLISTED_SHELL_ARGV.length)
  })
})

describe('normalizeShellArgv', () => {
  it('trims safe argv arrays', () => {
    expect(normalizeShellArgv([' node ', ' --version '])).toEqual(['node', '--version'])
  })

  it.each([
    [[]],
    [['']],
    [[' ']],
    [Array.from({ length: 17 }, () => 'x')],
    [['node', 'x'.repeat(300)]],
  ])('rejects malformed argv %j', (argv) => {
    expect(normalizeShellArgv(argv as string[])).toBeNull()
  })

  it.each([
    ['git', 'log', '|', 'rm -rf /'],
    ['echo', '$(whoami)'],
    ['echo', '`whoami`'],
    ['echo', 'a;b'],
    ['echo', 'a&&b'],
    ['echo', 'a>b'],
    ['echo', 'a<b'],
    ['echo', 'a(b)'],
    ['echo', 'a{b}'],
    ['echo', 'a[b]'],
    ['echo', 'a*b'],
    ['echo', 'a?b'],
    ['echo', 'a~b'],
  ])('rejects shell metacharacters in any arg %j', (...argv) => {
    expect(normalizeShellArgv(argv)).toBeNull()
  })

  it.each(['sh', 'bash', 'zsh', 'cmd', 'powershell', 'SH', 'Bash'])('rejects %s as argv[0]', (interpreter) => {
    expect(normalizeShellArgv([interpreter, '-c', 'echo hi'])).toBeNull()
  })
})

describe('isAllowlistedShellArgv', () => {
  it('exact-matches every published template', () => {
    for (const template of ALLOWLISTED_SHELL_ARGV) {
      expect(isAllowlistedShellArgv([...template])).toBe(true)
    }
  })

  it('rejects argv not on the allowlist, including longer/shorter variants of a template', () => {
    expect(isAllowlistedShellArgv(['rm', '-rf', '/'])).toBe(false)
    expect(isAllowlistedShellArgv(['node', '--version', '--extra'])).toBe(false)
    expect(isAllowlistedShellArgv(['node'])).toBe(false)
  })
})

describe('parseShellCommandLine', () => {
  it('splits a plain whitespace-delimited command', () => {
    expect(parseShellCommandLine('git log --oneline -n 20')).toEqual(['git', 'log', '--oneline', '-n', '20'])
  })

  it.each(['', '   ', 'x'.repeat(600)])('rejects empty or overlong commands', (command) => {
    expect(parseShellCommandLine(command)).toBeNull()
  })

  it.each([
    'echo "hello world"',
    "echo 'hello'",
    'git log | grep foo',
    'echo $(whoami)',
    'echo `whoami`',
    'echo a && echo b',
    'echo a; echo b',
    'rm -rf / > out.txt',
  ])('rejects quoted or metacharacter commands %s', (command) => {
    expect(parseShellCommandLine(command)).toBeNull()
  })
})

describe('mapShellCommandToArgv', () => {
  it('maps an allowlisted command line to its argv', () => {
    expect(mapShellCommandToArgv('node --version')).toEqual(['node', '--version'])
    expect(mapShellCommandToArgv('  npm   run   lint  ')).toEqual(['npm', 'run', 'lint'])
    expect(mapShellCommandToArgv('git log --oneline -n 20')).toEqual(['git', 'log', '--oneline', '-n', '20'])
  })

  it('returns null for commands that parse but are not allowlisted', () => {
    expect(mapShellCommandToArgv('rm -rf /')).toBeNull()
  })

  it('returns null for commands that fail to parse', () => {
    expect(mapShellCommandToArgv('git log | grep foo')).toBeNull()
    expect(mapShellCommandToArgv('sh -c "echo hi"')).toBeNull()
  })
})

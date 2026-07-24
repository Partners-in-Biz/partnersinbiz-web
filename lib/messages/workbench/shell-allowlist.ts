/**
 * Phase 3 MVP `shell.exec` allowlist. Only exact argv templates below may
 * run on a linked computer — there is no free-form shell, no `sh -c`, and
 * no interpreter (`sh`/`bash`/`zsh`/`cmd`/`powershell`) may ever be argv[0].
 * `shell: false` is always used on the device side; these argv arrays are
 * passed directly to `execFile`-style process spawn, never a shell string.
 */
export const ALLOWLISTED_SHELL_ARGV: readonly (readonly string[])[] = [
  ['node', '--version'],
  ['npm', '--version'],
  ['npm', 'test'],
  ['npm', 'run', 'lint'],
  ['pnpm', '--version'],
  ['pnpm', 'test'],
  ['pnpm', 'lint'],
  ['yarn', '--version'],
  ['python3', '--version'],
  ['python', '--version'],
  ['uname', '-a'],
  ['which', 'node'],
  ['ls', '-la'],
  ['git', 'log', '--oneline', '-n', '20'],
  ['git', 'branch', '--show-current'],
]

/** Human-readable `argv.join(' ')` list for terminal/error-message display. */
export const ALLOWLISTED_SHELL_COMMANDS: readonly string[] = ALLOWLISTED_SHELL_ARGV.map((argv) => argv.join(' '))

const MAX_ARGV_LENGTH = 16
const MAX_ARG_LENGTH = 256
// Deliberately excludes quotes — normalizeShellArgv validates programmatic
// argv arrays (already split into discrete args), so quoting characters are
// just literal bytes there. parseShellCommandLine additionally rejects
// quotes below since it still has to split a single command string.
const SHELL_METACHARACTERS = /[|;$<>`&(){}[\]*?~]/
const COMMAND_LINE_UNSAFE_CHARACTERS = /["'|;$<>`&(){}[\]*?~\\]/
const DISALLOWED_INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh'])

/**
 * Trims and validates a candidate argv array. Rejects empty arrays/args,
 * overly long args, shell metacharacters, control characters, and shell
 * interpreters as argv[0]. Returns the normalized (trimmed) argv or `null`.
 */
export function normalizeShellArgv(argv: string[]): string[] | null {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > MAX_ARGV_LENGTH) return null
  const normalized: string[] = []
  for (const raw of argv) {
    if (typeof raw !== 'string') return null
    const value = raw.trim()
    if (!value || value.length > MAX_ARG_LENGTH || SHELL_METACHARACTERS.test(value) || /[\u0000-\u001f]/.test(value)) {
      return null
    }
    normalized.push(value)
  }
  const executable = normalized[0] ?? ''
  const base = executable.toLowerCase().split('/').pop() ?? executable.toLowerCase()
  if (DISALLOWED_INTERPRETERS.has(base)) return null
  return normalized
}

/** Exact-match only for MVP — no prefix/wildcard matching against templates. */
export function isAllowlistedShellArgv(argv: string[]): boolean {
  const normalized = normalizeShellArgv(argv)
  if (!normalized) return false
  return ALLOWLISTED_SHELL_ARGV.some((template) =>
    template.length === normalized.length && template.every((segment, index) => segment === normalized[index]))
}

/**
 * Splits a plain, quote-free command string on whitespace. Any quoting or
 * shell metacharacter causes a hard rejection — there is no shell parser
 * here, just a literal argv split for allowlisted commands.
 */
export function parseShellCommandLine(command: string): string[] | null {
  const trimmed = command.trim()
  if (!trimmed || trimmed.length > 512 || COMMAND_LINE_UNSAFE_CHARACTERS.test(trimmed) || /[\u0000-\u001f]/.test(trimmed)) {
    return null
  }
  const argv = trimmed.split(/\s+/).filter(Boolean)
  return argv.length ? argv : null
}

/** Parses a command line and returns its normalized argv only if allowlisted. */
export function mapShellCommandToArgv(command: string): string[] | null {
  const argv = parseShellCommandLine(command)
  if (!argv) return null
  return isAllowlistedShellArgv(argv) ? normalizeShellArgv(argv) : null
}

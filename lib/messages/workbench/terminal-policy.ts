import { adminDb } from '@/lib/firebase/admin'
import { DEFAULT_ALLOWLISTED_SHELL_ARGV, isAllowlistedShellArgv, normalizeShellArgv } from './shell-allowlist'
const COLLECTION = 'workbench_terminal_policies'; const MAX_COMMANDS = 40
export type TerminalPolicy = { allowedShellArgv: string[][]; updatedAt?: Date; updatedBy?: string }
export function validateTerminalPolicy(value: unknown): { ok: true; value: string[][] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COMMANDS) return { ok: false, error: `Choose between 1 and ${MAX_COMMANDS} exact commands` }
  const seen = new Set<string>(); const commands: string[][] = []
  for (const candidate of value) { if (!Array.isArray(candidate) || !candidate.every((part) => typeof part === 'string')) return { ok: false, error: 'Each terminal command must be an argv array' }; const argv = normalizeShellArgv(candidate as string[]); if (!argv || !isAllowlistedShellArgv(argv, [argv])) return { ok: false, error: 'A command contains unsafe shell syntax or an interpreter' }; const key = argv.join('\u0000'); if (seen.has(key)) return { ok: false, error: 'Duplicate terminal commands are not allowed' }; seen.add(key); commands.push(argv) }
  return { ok: true, value: commands }
}
export async function getTerminalPolicy(orgId: string): Promise<TerminalPolicy> { const snap = await adminDb.collection(COLLECTION).doc(orgId).get(); const valid = validateTerminalPolicy(snap.data()?.allowedShellArgv); return { allowedShellArgv: valid.ok ? valid.value : DEFAULT_ALLOWLISTED_SHELL_ARGV.map((argv) => [...argv]) } }
export async function saveTerminalPolicy(orgId: string, actorUserId: string, allowedShellArgv: string[][]): Promise<TerminalPolicy> { await adminDb.collection(COLLECTION).doc(orgId).set({ allowedShellArgv, updatedBy: actorUserId, updatedAt: new Date() }); return { allowedShellArgv, updatedBy: actorUserId } }

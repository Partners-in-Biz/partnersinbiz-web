import type { CodeExecResult, ToolsetPolicy } from './types'
import { isToolsetEnabled } from './toolsets'

/**
 * Sandboxed code execution path for PiB.
 * Pure interpreter for a tiny safe subset used by tests and readiness gates.
 * Real Hermes execute_code runs on the agent when toolset `code_execution` is enabled.
 */
export function executeCodeSandboxed(
  policy: ToolsetPolicy,
  script: string,
): CodeExecResult {
  const enabled = isToolsetEnabled(policy, 'code_execution')
  if (!enabled) {
    return {
      ok: false,
      stdout: '',
      stderr: 'code_execution toolset is disabled',
      exitCode: 1,
      toolsetEnabled: false,
    }
  }

  const src = script.trim()
  if (!src) {
    return {
      ok: false,
      stdout: '',
      stderr: 'empty script',
      exitCode: 1,
      toolsetEnabled: true,
    }
  }

  // Allow only trivial print-style scripts for the product-safe path:
  // print("hello") or console.log("hello")
  const m =
    src.match(/^print\(\s*(['"])(.*?)\1\s*\)$/) ||
    src.match(/^console\.log\(\s*(['"])(.*?)\1\s*\)$/)
  if (m) {
    return {
      ok: true,
      stdout: `${m[2]}\n`,
      stderr: '',
      exitCode: 0,
      toolsetEnabled: true,
    }
  }

  // Arithmetic: print(1+2)
  const arith = src.match(/^print\(\s*(\d+)\s*([+\-*/])\s*(\d+)\s*\)$/)
  if (arith) {
    const a = Number(arith[1])
    const b = Number(arith[3])
    const op = arith[2]
    let value = 0
    if (op === '+') value = a + b
    else if (op === '-') value = a - b
    else if (op === '*') value = a * b
    else value = b === 0 ? NaN : a / b
    if (!Number.isFinite(value)) {
      return {
        ok: false,
        stdout: '',
        stderr: 'division by zero',
        exitCode: 1,
        toolsetEnabled: true,
      }
    }
    return {
      ok: true,
      stdout: `${value}\n`,
      stderr: '',
      exitCode: 0,
      toolsetEnabled: true,
    }
  }

  return {
    ok: false,
    stdout: '',
    stderr: 'script not allowed in PiB sandboxed subset; enable Hermes execute_code on the agent runtime for full RPC',
    exitCode: 2,
    toolsetEnabled: true,
  }
}

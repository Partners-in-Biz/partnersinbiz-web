'use client'

import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'
import type { FitAddon } from '@xterm/addon-fit'
import type { ITheme, Terminal } from '@xterm/xterm'

/**
 * Real xterm.js surface for the Messages workbench Session mode (Phase 5).
 * The host (`UnifiedChat` via `WorkbenchTerminalPanel`) owns the session
 * lifecycle and the accumulated transcript; this component only renders it
 * and reports keystrokes/grid changes back:
 *
 * - `output` is the full accumulated transcript. Renders are incremental - 
 *     only the suffix past what has already been written is pushed to the
 *     emulator, so a poll that returns no new chunks costs nothing and a long
 *     session never redraws from scratch. A transcript that shrinks or is
 *     replaced (new session started) falls back to one clean `reset()`.
 * - `onData` receives raw keystrokes, including control bytes such as
 *     Ctrl-C, so the host must forward them with the session stdin `mode:
 *     'raw'` - never `'line'`, which would append its own newline.
 * - `onResize` fires after the FitAddon recomputes the grid (on mount and
 *     on every container resize), which is what the host forwards to
 *     `resizeWorkbenchSession` so the remote pty's `SIGWINCH` matches what
 *     the user actually sees.
 *
 * xterm.js is loaded lazily inside the mount effect: it is a DOM-only library
 * with no server-side value, and deferring it keeps it out of the initial
 * Messages bundle for the (common) case where Session mode is never opened.
 */

/** Neutral PiB HUD palette - deliberately no primary/purple accent, so agent output colors read true. */
const PIB_TERMINAL_THEME: ITheme = {
  background: '#050505',
  foreground: '#EDEDED',
  cursor: '#EDEDED',
  cursorAccent: '#050505',
  selectionBackground: 'rgba(255, 255, 255, 0.18)',
  black: '#141416',
  red: '#F87171',
  green: '#34D399',
  yellow: '#FBBF24',
  blue: '#60A5FA',
  magenta: '#F472B6',
  cyan: '#22D3EE',
  white: '#EDEDED',
  brightBlack: '#4A4A52',
  brightRed: '#FCA5A5',
  brightGreen: '#6EE7B7',
  brightYellow: '#FCD34D',
  brightBlue: '#93C5FD',
  brightMagenta: '#F9A8D4',
  brightCyan: '#67E8F9',
  brightWhite: '#FFFFFF',
}

const TERMINAL_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'

export interface WorkbenchXtermProps {
  /** Full accumulated session output. Written incrementally - see the module comment. */
  output: string
  /** Raw keystrokes from the emulator. Forward with stdin `mode: 'raw'`. */
  onData?: (data: string) => void
  /** Fired with the fitted grid size on mount and after every container resize. */
  onResize?: (cols: number, rows: number) => void
  /** Blocks keyboard input (e.g. the session is not running yet) without unmounting the transcript. */
  disabled?: boolean
  className?: string
}

export function WorkbenchXterm({ output, onData, onResize, disabled = false, className }: WorkbenchXtermProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  /** Exact transcript prefix already handed to the emulator; its length is the incremental write offset. */
  const writtenRef = useRef('')
  const outputRef = useRef(output)
  const onDataRef = useRef(onData)
  const onResizeRef = useRef(onResize)
  const disabledRef = useRef(disabled)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    outputRef.current = output
    onDataRef.current = onData
    onResizeRef.current = onResize
    disabledRef.current = disabled
  }, [output, onData, onResize, disabled])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    let terminal: Terminal | null = null
    let observer: ResizeObserver | null = null

    /**
     * A zero-width container (a hidden tab, a collapsed rail) makes the
     * FitAddon propose nonsense dimensions, so failures here are swallowed - 
     * the ResizeObserver refits as soon as the panel has real layout.
     */
    const refit = () => {
      try {
        fitRef.current?.fit()
      } catch {
        // Ignored: the next resize observation retries with a measurable container.
      }
    }

    void (async () => {
      const [{ Terminal: XtermTerminal }, { FitAddon: XtermFitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ])
      if (disposed) return

      terminal = new XtermTerminal({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: TERMINAL_FONT_FAMILY,
        fontSize: 12,
        lineHeight: 1.35,
        scrollback: 5_000,
        theme: PIB_TERMINAL_THEME,
      })
      const fit = new XtermFitAddon()
      terminal.loadAddon(fit)
      terminal.open(container)
      terminalRef.current = terminal
      fitRef.current = fit

      terminal.onData((data) => {
        if (!disabledRef.current) onDataRef.current?.(data)
      })
      terminal.onResize(({ cols, rows }) => onResizeRef.current?.(cols, rows))

      if (outputRef.current) {
        terminal.write(outputRef.current)
        writtenRef.current = outputRef.current
      }
      refit()
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => refit())
        observer.observe(container)
      }
      setMounted(true)
    })()

    return () => {
      disposed = true
      observer?.disconnect()
      terminalRef.current = null
      fitRef.current = null
      writtenRef.current = ''
      terminal?.dispose()
    }
  }, [])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || !mounted) return
    const written = writtenRef.current
    if (output === written) return
    if (output.startsWith(written)) {
      terminal.write(output.slice(written.length))
    } else {
      terminal.reset()
      terminal.write(output)
    }
    writtenRef.current = output
  }, [mounted, output])

  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal || !mounted) return
    terminal.options.disableStdin = disabled
  }, [mounted, disabled])

  return (
    <div
      ref={containerRef}
      data-testid="workbench-xterm"
      role="group"
      aria-label="Interactive shell terminal"
      className={`min-h-0 w-full overflow-hidden bg-[#050505] ${className ?? ''}`}
    />
  )
}

export default WorkbenchXterm

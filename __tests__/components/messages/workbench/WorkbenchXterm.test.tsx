import { act, render, screen } from '@testing-library/react'
import { WorkbenchXterm } from '@/components/messages/workbench/WorkbenchXterm'

/**
 * xterm.js needs a real canvas/renderer, so the emulator itself is mocked and
 * these tests assert the contract `WorkbenchXterm` owns: incremental writes,
 * raw keystroke forwarding, fit-driven resize reporting, and disposal.
 */
type DataListener = (data: string) => void
type ResizeListener = (size: { cols: number; rows: number }) => void

const terminalInstances: MockTerminal[] = []
const fitInstances: MockFitAddon[] = []

class MockTerminal {
  options: Record<string, unknown> = {}
  writes: string[] = []
  resets = 0
  disposed = 0
  opened: HTMLElement | null = null
  addons: unknown[] = []
  dataListeners: DataListener[] = []
  resizeListeners: ResizeListener[] = []

  constructor(options: Record<string, unknown>) {
    this.options = { ...options }
    terminalInstances.push(this)
  }

  loadAddon(addon: unknown) { this.addons.push(addon) }
  open(element: HTMLElement) { this.opened = element }
  write(data: string) { this.writes.push(data) }
  reset() { this.resets += 1 }
  dispose() { this.disposed += 1 }
  onData(listener: DataListener) { this.dataListeners.push(listener); return { dispose: () => {} } }
  onResize(listener: ResizeListener) { this.resizeListeners.push(listener); return { dispose: () => {} } }

  /** Simulates a keystroke arriving from the emulator. */
  emitData(data: string) { this.dataListeners.forEach((listener) => listener(data)) }
  /** Simulates xterm reporting a new grid size (what FitAddon.fit triggers in the real thing). */
  emitResize(cols: number, rows: number) { this.resizeListeners.forEach((listener) => listener({ cols, rows })) }
}

class MockFitAddon {
  fits = 0
  terminal: MockTerminal | null = null
  constructor() { fitInstances.push(this) }
  fit() {
    this.fits += 1
    // The real FitAddon resizes the terminal, which emits onResize.
    terminalInstances[terminalInstances.length - 1]?.emitResize(80, 24)
  }
}

jest.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }))
jest.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }))

const resizeObserverCallbacks: ResizeObserverCallback[] = []

beforeAll(() => {
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resizeObserverCallbacks.push(callback) }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  terminalInstances.length = 0
  fitInstances.length = 0
  resizeObserverCallbacks.length = 0
})

/** Renders and flushes the lazy `import('@xterm/xterm')` inside the mount effect. */
async function renderXterm(props: Parameters<typeof WorkbenchXterm>[0]) {
  const result = render(<WorkbenchXterm {...props} />)
  await act(async () => { await Promise.resolve() })
  return result
}

describe('WorkbenchXterm', () => {
  it('mounts a terminal into its container and writes the initial transcript once', async () => {
    await renderXterm({ output: '$ bash\nready> ' })

    const terminal = terminalInstances[0]
    expect(terminalInstances).toHaveLength(1)
    expect(terminal.opened).toBe(screen.getByTestId('workbench-xterm'))
    expect(terminal.writes).toEqual(['$ bash\nready> '])
    expect(terminal.addons[0]).toBe(fitInstances[0])
  })

  it('writes only the new suffix when the transcript grows (no full redraw)', async () => {
    const { rerender } = await renderXterm({ output: 'first\n' })
    const terminal = terminalInstances[0]

    rerender(<WorkbenchXterm output={'first\nsecond\n'} />)

    expect(terminal.writes).toEqual(['first\n', 'second\n'])
    expect(terminal.resets).toBe(0)
  })

  it('does not rewrite anything when a poll returns no new output', async () => {
    const { rerender } = await renderXterm({ output: 'stable' })
    const terminal = terminalInstances[0]

    rerender(<WorkbenchXterm output="stable" />)

    expect(terminal.writes).toEqual(['stable'])
  })

  it('resets and redraws when the transcript is replaced rather than appended (new session)', async () => {
    const { rerender } = await renderXterm({ output: 'old session\n' })
    const terminal = terminalInstances[0]

    rerender(<WorkbenchXterm output={'brand new session\n'} />)

    expect(terminal.resets).toBe(1)
    expect(terminal.writes).toEqual(['old session\n', 'brand new session\n'])
  })

  it('forwards raw keystrokes, including control bytes, to onData', async () => {
    const onData = jest.fn()
    await renderXterm({ output: '', onData })

    terminalInstances[0].emitData('l')
    terminalInstances[0].emitData('\u0003')

    expect(onData).toHaveBeenNthCalledWith(1, 'l')
    expect(onData).toHaveBeenNthCalledWith(2, '\u0003')
  })

  it('swallows keystrokes and disables stdin while disabled', async () => {
    const onData = jest.fn()
    await renderXterm({ output: '', onData, disabled: true })

    terminalInstances[0].emitData('x')

    expect(onData).not.toHaveBeenCalled()
    expect(terminalInstances[0].options.disableStdin).toBe(true)
  })

  it('reports the fitted grid on mount and refits on container resize', async () => {
    const onResize = jest.fn()
    await renderXterm({ output: '', onResize })

    expect(fitInstances[0].fits).toBe(1)
    expect(onResize).toHaveBeenCalledWith(80, 24)

    await act(async () => { resizeObserverCallbacks[0]([], {} as ResizeObserver) })

    expect(fitInstances[0].fits).toBe(2)
  })

  it('keeps rendering when the container has no measurable layout and fit throws', async () => {
    const onResize = jest.fn()
    await renderXterm({ output: 'hi', onResize })
    jest.spyOn(fitInstances[0], 'fit').mockImplementation(() => { throw new Error('This terminal is not attached') })

    await act(async () => { resizeObserverCallbacks[0]([], {} as ResizeObserver) })

    expect(screen.getByTestId('workbench-xterm')).toBeInTheDocument()
  })

  it('disposes the terminal on unmount', async () => {
    const { unmount } = await renderXterm({ output: '' })
    const terminal = terminalInstances[0]

    unmount()

    expect(terminal.disposed).toBe(1)
  })

  it('exposes an accessible label for the terminal surface', async () => {
    await renderXterm({ output: '' })
    expect(screen.getByRole('group', { name: 'Interactive shell terminal' })).toBeInTheDocument()
  })
})

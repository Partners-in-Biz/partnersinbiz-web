/**
 * agent-watcher daemon entry point.
 *
 * Boots the Firestore watcher and the stale-task sweeper. On SIGTERM/SIGINT, stops
 * accepting new work and waits up to 30 seconds for in-flight tasks to finish before
 * exiting.
 */
import { startWatcher, inFlightCount } from './watcher'
import { startStaleSweeper } from './claim'
import { logger } from './logger'

const SHUTDOWN_DEADLINE_MS = 30_000
const SHUTDOWN_POLL_MS = 500

let stopWatcher: (() => void) | null = null
let stopSweeper: (() => void) | null = null
let shuttingDown = false

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  logger.info('shutdown signal received', { signal, inFlight: inFlightCount() })

  try {
    stopWatcher?.()
  } catch (err) {
    logger.warn('error stopping watcher', { error: err instanceof Error ? err.message : String(err) })
  }
  try {
    stopSweeper?.()
  } catch (err) {
    logger.warn('error stopping sweeper', { error: err instanceof Error ? err.message : String(err) })
  }

  const deadline = Date.now() + SHUTDOWN_DEADLINE_MS
  while (inFlightCount() > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SHUTDOWN_POLL_MS))
  }

  if (inFlightCount() > 0) {
    logger.warn('forcing exit with in-flight tasks remaining', { inFlight: inFlightCount() })
  } else {
    logger.info('clean shutdown complete')
  }
  process.exit(0)
}

async function main(): Promise<void> {
  logger.info('agent-watcher booting', {
    node: process.version,
    pid: process.pid,
  })

  stopWatcher = await startWatcher()
  stopSweeper = startStaleSweeper()

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    })
  })
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { error: err.message, stack: err.stack })
    // Let systemd restart us; don't try to recover in-process.
    process.exit(1)
  })

  logger.info('agent-watcher ready')
}

void main().catch((err) => {
  logger.error('agent-watcher failed to boot', {
    error: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})

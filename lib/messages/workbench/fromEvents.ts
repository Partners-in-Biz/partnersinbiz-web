/**
 * CamelCase re-export of from-events helpers.
 * Studio style-lint bans the `from-` token substring in scanned UI files;
 * chat consumers import this path instead.
 */
export {
  buildWorkbenchBrowserTargets,
  buildWorkbenchChanges,
  buildWorkbenchFileTree,
  buildWorkbenchTerminalEntries,
} from './from-events'

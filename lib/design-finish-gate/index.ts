/**
 * Design Finish Gate — public API.
 *
 * The finish gate is the fresh-reviewer rule from research ZTTo7g6CU80u1uUSZvoC
 * recommendation P2: before a web/design/Studio task is marked done, a
 * SEPARATE review pass in a FRESH context (never the builder thread, never
 * self-grading) grades the delivered surface against the brief contract and
 * returns ship / fix / rebuild, scored promise-by-promise with at most 2 fix
 * rounds.
 *
 * Typical flow (agent-side):
 *   1. buildContract(...)            — brief + screenshots -> ReviewContract
 *   2. Hand contract.reviewerPrompt  — to a FRESH reviewer context
 *      (delegate_task / separate run); NEVER answer it in the builder thread.
 *   3. parseReviewerOutput(...)      — normalize + validate the JSON verdict
 *   4. buildReport(...)              — aggregate + enforce fix-round budget
 *   5. ship only when exitCode === 0
 */

export * from './types'
export * from './contract'
export * from './reviewer'
export * from './vision'
export * from './studio'
export * from './report'

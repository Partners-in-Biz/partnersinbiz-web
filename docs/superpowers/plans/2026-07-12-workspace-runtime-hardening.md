# Workspace Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove browser path leakage, enforce canonical contained working directories, make explicit runtime selection strict, align conversation mutation authorization, and record the runtime that actually accepted each run.

**Architecture:** Introduce browser-safe DTOs and focused server-only resolvers at the Workspace/runtime boundaries. Conversation creation persists logical scope, dispatch resolves and validates the physical directory just in time, and the run ledger stores a safe execution receipt rather than duplicated raw paths.

**Tech Stack:** Next.js App Router, TypeScript, Firebase Admin/Firestore, Jest, Node `fs/promises` and `path`, Hermes HTTP run API.

## Global Constraints

- Browser requests contain logical organisation, Workspace, project, mapping, and runtime identifiers only.
- Browser responses and user-visible logs contain no raw paths, runtime URLs, API keys, SSH details, or arbitrary upstream payloads.
- Explicit runtime selection never falls back; only `auto` may use priority fallback.
- VPS remains the canonical Workspace source of truth.
- General conversations remain filesystem-unbound.
- Project paths must be canonical existing directories contained beneath the canonical Workspace `projects/` root and must not traverse symlinks.
- Private/shared reads require explicit participation; organisation-visible reads require organisation access; mutations require explicit participation or owner/manager authority appropriate to the action.
- All behavior changes use red-green TDD.

---

### Task 1: Browser-safe Workspace catalogue

**Files:**
- Modify: `app/api/v1/workspaces/route.ts`
- Modify: `components/chat/UnifiedChat.tsx`
- Modify: `__tests__/api/conversations-platform.test.ts`
- Modify: `__tests__/components/chat/UnifiedChat.context.test.tsx`

**Interfaces:**
- Produces: `PublicWorkspaceSummary` with logical identity, source-of-truth, sync mode, folder version, and no physical paths.

- [ ] Write failing API and UI tests asserting `vpsPath`, `localPath`, `agentDomainPath`, and `localAgentDomainPath` are absent and raw paths are not rendered.
- [ ] Run `npm test -- --runTestsByPath __tests__/api/conversations-platform.test.ts __tests__/components/chat/UnifiedChat.context.test.tsx --runInBand`; confirm the new assertions fail on leaked fields/copy.
- [ ] Add a purpose-built public mapping in the route and replace raw-path UI text with friendly VPS-canonical scope copy.
- [ ] Re-run the focused tests and confirm all pass.
- [ ] Commit with `fix(workspaces): redact filesystem paths from browser catalogue`.

### Task 2: Canonical contained Workspace path resolver

**Files:**
- Create: `lib/client-provisioning/working-directory.ts`
- Create: `__tests__/lib/client-provisioning/working-directory.test.ts`
- Modify: `lib/client-provisioning/workspace-context.ts`
- Modify: `app/api/v1/conversations/[convId]/messages/route.ts`

**Interfaces:**
- Produces: `resolveAuthorizedWorkingDirectory(input): Promise<{ ok: true; directory: string; pathClass: 'organisation' | 'project' } | { ok: false; code: WorkspaceDispatchFailureCode }>`.

- [ ] Write failing tests for a valid organisation root, valid project, relative root, missing directory, sibling-prefix escape, `..` traversal, symlink component, archived project, and missing project.
- [ ] Run `npm test -- --runTestsByPath __tests__/lib/client-provisioning/working-directory.test.ts --runInBand`; confirm failures are caused by the missing resolver.
- [ ] Implement canonical `realpath`/`lstat` validation, separator-safe containment, and symlink-component rejection; do not create directories.
- [ ] Change dispatch to call the resolver immediately before `createHermesRun` and return/store a typed safe failure without reflecting paths.
- [ ] Re-run the resolver and message-routing suites; confirm pass.
- [ ] Commit with `fix(workspaces): enforce canonical contained run directories`.

### Task 3: Strict runtime selection and execution identity

**Files:**
- Modify: `lib/agents/runtime-targets.ts`
- Modify: `lib/agents/team.ts`
- Modify: `lib/hermes/types.ts`
- Modify: `app/api/v1/conversations/[convId]/messages/route.ts`
- Modify: `__tests__/lib/agents/runtime-targets.test.ts`
- Modify: `__tests__/api/conversation-messages-routing.test.ts`

**Interfaces:**
- Produces: `RuntimeTargetResolution` that is either an actual selected target or a typed explicit-selection error; `HermesProfileLink` preserves `runtimeTargetId`, runtime kind, and machine label.

- [ ] Write failing tests showing missing, stale, disabled, unhealthy, and keyless explicit targets return typed errors and never choose VPS/legacy; `auto` retains fallback.
- [ ] Run the runtime-target tests and confirm expected failures.
- [ ] Implement strict explicit resolution and preserve selected target identity through the Hermes link and safe run metadata.
- [ ] Add routing tests proving requested and accepted targets match and stale local selection creates no Hermes request.
- [ ] Run both focused suites and confirm pass.
- [ ] Commit with `fix(runtimes): enforce strict target selection`.

### Task 4: Conversation mutation policy matrix

**Files:**
- Modify: `lib/conversations/access.ts`
- Modify: `app/api/v1/conversations/[convId]/route.ts`
- Modify: `app/api/v1/conversations/[convId]/messages/[msgId]/stop/route.ts`
- Modify: `app/api/v1/conversations/[convId]/agent-messages/route.ts`
- Create: `__tests__/api/conversation-route-policy-matrix.test.ts`

**Interfaces:**
- Produces: purpose-specific `canDeleteConversation`, `canStopConversationRun`, and `canAppendAgentMessage` policy helpers.

- [ ] Write a failing matrix covering owner, explicit human, nonparticipant org member/admin, explicit AI agent, and nonparticipant AI across private/shared/org visibility for delete, stop, and agent append.
- [ ] Run the new suite and confirm the known bypasses fail.
- [ ] Implement the smallest central helpers and apply them to all three routes.
- [ ] Run the new matrix plus existing access/route suites and confirm pass.
- [ ] Commit with `fix(chat): align conversation mutation authorization`.

### Task 5: Safe errors, metadata, and execution receipts

**Files:**
- Create: `lib/workspaces/dispatch-errors.ts`
- Modify: `lib/hermes/server.ts`
- Modify: `app/api/v1/conversations/[convId]/messages/route.ts`
- Modify: legacy Hermes message/finalise routes identified by `rg 'runResult.data|errorData' app/api/v1/admin/hermes`
- Create: `__tests__/lib/workspaces/dispatch-errors.test.ts`
- Modify: `__tests__/api/conversation-messages-routing.test.ts`

**Interfaces:**
- Produces: stable `WorkspaceDispatchFailureCode`, safe browser error DTO, and `executionReceipt` with requested/accepted target IDs and logical timing/outcome fields.

- [ ] Write failing tests proving raw upstream payloads, exception messages, paths, endpoints, and credentials are not reflected or stored in public metadata.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add allowlisted error classification and execution receipt persistence; store only logical Workspace/project IDs and path class in run metadata.
- [ ] Sanitize legacy upstream success/error responses before returning them to callers.
- [ ] Run focused tests and confirm pass.
- [ ] Commit with `fix(workspaces): sanitize dispatch telemetry and errors`.

### Task 6: Stage 1 integrated verification

**Files:**
- Modify: `docs/deploy/workspace-folder-sync-v1.md` only if the verified error/receipt contract changes operator instructions.

- [ ] Run all Workspace/conversation/runtime focused Jest suites.
- [ ] Run `npm run typecheck`, `npm run lint:ratchet`, targeted ESLint on changed source/test files, and `git diff --check`.
- [ ] Run `npm run build` sequentially after tests.
- [ ] Run a browser-safe local API smoke and a real local project `pwd`; retain redacted evidence under `.verification/`.
- [ ] Commit any verification/runbook updates with `docs(workspaces): record runtime hardening verification`.


---
name: interactive-project-planning
description: >
  Interview-first project planning for Partners in Biz. Use when starting a substantive project,
  major replan, "plan with me", "interview me about this project", "decision brief", playbook design,
  milestone planning, or when planning discovery is required / blocked. Inspects project context first,
  asks one high-value question at a time with a guess, produces a Decision Brief, and only then
  creates specs, milestones, structured playbooks, and agent-ready tasks.
---

# Interactive Project Planning — Partners in Biz

PiB-native planning gate that turns rough project intent into a confirmed Decision Brief before agents swing the hammer.

This is **not** a generic personality questionnaire. It is evidence-first discovery bound to the project's Plan suite and Kanban.

## When to use

- "Interview me before you start this project"
- "Plan with me" / "Help me scope this project"
- "Turn this rough idea into a decision brief"
- Creating a substantive new project or major replan
- Planning discovery returns `planning_discovery_required`
- Designing playbooks, milestones, approval gates, or multi-agent task graphs

## When not to use

- Already-explicit low-risk tasks ("rename X", "fix typo", "add a one-line note")
- Pure status checks ("what's on the board?")
- User says skip / just proceed / plan with assumptions and a manager will attest YOLO
- Non-interactive contexts (cron, watcher-only loops) — flag the planning gate instead of interviewing

## Auth

Interactive Messages runs: user-delegation token (`Authorization: Bearer pib_dlg_…` + `X-Org-Id`).
The platform mints that token with `agentId=pip` when Pip is the active Messages agent.

Planning interview mutations (`start`, `record_inspection`, `ask_question`, `surface_brief`, `submit_brief`) accept:

- Pip agent API key (`role=ai`, `agentId=pip`), or
- Pip user-delegation (`authKind=user_delegation`, `agentId=pip`)

They reject other agents and human-only session tokens for those interview writes (except `start`, which a direct human manager may also run).

**Human-binding actions (browser session OR complete Messages user-delegation acting for that human):** `answer_question`, `confirm`, `plan_with_assumptions`, `reopen`.  
Pure agent API keys still receive 403 — they cannot impersonate human intent.
Humans answer in chat / Plan tab and click **Confirm Decision Brief** on the Messages card.

Never claim a planning write succeeded without read-back. Do not fall back to a long-lived system AI key for interactive planning.

## Product rule (mandatory vs skip)

| Situation | Mode |
|---|---|
| New substantive project or major replan | **Mandatory interview** (or manager `PLAN WITH ASSUMPTIONS`) |
| Small explicit low-risk task on an already planned project | Bypass interview; do the task |
| Planning mutation while discovery incomplete | Fail closed with `planning_discovery_required` |

YOLO = **plan with assumptions** only. It never bypasses deploy, spend, publish, finance, client send, secret/config, destructive, or capability/reviewer gates.

## Required procedure

### 1. Inspect first (do not interview blindly)

Call:

```
GET /api/v1/agent/project/{projectId}
```

Read `project`, `documents`, `tasks`, and **`plan`** (milestones, approvals, risks, decisions, playbooks, capacities, automations, `planningDiscovery`).

Also inspect authorised linked files / Workbench folders when the conversation has a computer context.

Then record inspection via planning discovery:

```
POST /api/v1/projects/{projectId}/planning-discovery
{
  "type": "record_inspection",
  "expectedRevision": <n>,
  "evidence": {
    "brief": ["..."],
    "docs": ["..."],
    "files": ["..."],
    "plan": ["..."],
    "tasks": ["..."],
    "tools": ["..."],
    "agents": ["..."],
    "skills": ["..."]
  }
}
```

Every evidence array must contain at least one entry. Use `"none observed"` only when you truly inspected and found nothing.

If discovery is not started:

```
POST /api/v1/projects/{projectId}/planning-discovery
{ "type": "start" }
```

### 2. One question at a time, with a guess

```
POST /api/v1/projects/{projectId}/planning-discovery
{
  "type": "ask_question",
  "expectedRevision": <n>,
  "question": "…",
  "currentGuess": "…"
}
```

In chat, present:

```
HYPOTHESIS: <one sentence>
CONFIDENCE: <0-100>% — <what's still blocking>

Q: <one high-value question>
GUESS: <your current assumption and why>
```

Wait for the human answer **in chat**, then POST with the same Messages user-delegation token (acting for that human):

```
POST /api/v1/projects/{projectId}/planning-discovery
{
  "type": "answer_question",
  "expectedRevision": <n>,
  "expectedQuestionId": "q-…",
  "answer": "…"
}
```

Do **not** tell the human they must leave chat for the Plan panel. Chat-native answer + confirm are supported when the run uses a complete user-delegation token for that human.

### 3. Classify answers

Track separately:

- **Confirmed facts**
- **Assumptions** (agent interpretations not yet confirmed)
- **Constraints**
- **Preferences**
- **Risks**
- **Unknowns** (especially intent-blocking unknowns)

Never silently write interview content to Hermes memory. Offer a memory summary only after explicit approval.

### 4. Stop intelligently

Stop when another answer would not change the plan, milestones, playbook, agent routing, or approval gates.

Checkpoint after 3–5 substantive answers with a short restate.

### 5. Decision Brief (full contract)

```
POST /api/v1/projects/{projectId}/planning-discovery
{
  "type": "submit_brief",
  "expectedRevision": <n>,
  "confidence": 95,
  "predictedNextAnswers": ["…", "…", "…"],
  "intentBlockingUnknowns": [],
  "brief": {
    "outcome": "…",
    "user": "…",
    "whyNow": "…",
    "successCriteria": ["…"],
    "constraints": ["…"],
    "outOfScope": ["…"],
    "assumptions": ["…"],
    "risks": ["…"],
    "approvalGates": ["…"]
  }
}
```

Requirements for normal mode:

- confidence ≥ 95
- at least one completed interview turn
- exactly 3 predicted next answers
- zero intent-blocking unknowns
- all brief sections populated

Then surface a **confirm card in Messages** and/or call `confirm` with the human’s user-delegation token when they clearly confirmed in chat. Do **not** ask the human to leave chat for the Plan tab.

On `submit_brief` (and when re-surfacing an existing ready brief), include Messages handoff ids and let the platform attach the card:

```
POST /api/v1/projects/{projectId}/planning-discovery
{
  "type": "submit_brief",
  "expectedRevision": <n>,
  "confidence": 95,
  "predictedNextAnswers": ["…", "…", "…"],
  "intentBlockingUnknowns": [],
  "brief": { … },
  "conversationId": "<from this turn>",
  "responseMessageId": "<assistant message id for this turn>"
}
```

If the brief is already `brief_ready` and the human confirmed in prose (or the card is missing):

```
POST /api/v1/projects/{projectId}/planning-discovery
{
  "type": "request_human_confirm",
  "conversationId": "<from this turn>",
  "responseMessageId": "<assistant message id for this turn>"
}
```

That returns `richParts` (approval_card) + `uiActions` with **Confirm Decision Brief**. Echo those into the assistant message if the auto-attach did not land.

**Allowed:** calling `answer_question` / `confirm` / `plan_with_assumptions` / `reopen` with a **complete Messages user-delegation** token acting for the project manager (same human uid).  
**Forbidden:** pure agent API keys / system keys for those actions (HTTP 403).

When the human says “yes / confirm / adopt the recommended matrix” in chat, Pip should POST `answer_question` or `confirm` with the delegated token immediately — do not bounce them to the Plan panel.

### 6. Only after confirmation — create execution structure

Use `project-management` + suite APIs:

1. Spec / client document (if needed) via `client-documents`
2. Milestones via suite
3. Approval gates
4. **Structured playbook** (not bare titles):

```json
{
  "type": "playbook",
  "title": "Launch sequence",
  "template": {
    "schemaVersion": 1,
    "steps": [
      {
        "stepId": "step-1",
        "taskKind": "agent",
        "title": "Draft technical approach",
        "assigneeAgentId": "theo",
        "agentInput": { "spec": "…", "constraints": ["…"] },
        "dependsOnStepIds": [],
        "reviewerAgentId": "qa-release",
        "requiredCapability": "write",
        "riskLevel": "medium",
        "expectedArtifacts": ["approach-doc"],
        "verifierChecklist": ["matches Decision Brief", "no secrets"],
        "labels": ["planning", "playbook"]
      },
      {
        "stepId": "step-2",
        "taskKind": "approval-gate",
        "title": "Peet approves approach",
        "approvalGate": "human-manager",
        "riskLevel": "high",
        "expectedArtifacts": ["approval"],
        "verifierChecklist": ["explicit approve recorded"],
        "dependsOnStepIds": ["step-1"],
        "labels": ["approval"]
      }
    ]
  }
}
```

Route tasks by real specialist skills/capabilities. Do not invent assignees the runtime does not have.

## Related skills

- `interview-me` — generic adaptive interview craft
- `planning-and-task-breakdown` — after brief confirmed
- `project-management` — CRUD, suite, agent context, tasks
- `client-documents` — specs / approval packs
- `collaboration-runtime` — handoffs and evidence

## Verification checklist

- [ ] `GET /agent/project/{id}` inspected, including `plan`
- [ ] Inspection recorded before questions
- [ ] One question + guess at a time
- [ ] Facts / assumptions / constraints / risks / unknowns separated
- [ ] Brief complete; human confirmation obtained
- [ ] No memory write without approval
- [ ] Post-confirm work uses structured agent-ready tasks, not bare titles

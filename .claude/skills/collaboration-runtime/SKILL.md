---
name: collaboration-runtime
description: Shared Partners in Biz collaboration runtime for agents. Use for updating assigned tasks, writing handoff comments, recording status, linking source documents, and keeping work visible without granting broad module-specific powers.
---

# Collaboration Runtime

This is the small shared operating skill every Partners in Biz specialist may use.
It does not grant ownership of a business module. It only lets an agent keep its
assigned work visible and auditable.

## Rules

- Read the task, project, source document, source research item, and recent comments before acting.
- Keep `agentStatus`, `agentOutput.summary`, comments, and artifacts current.
- Do not publish, spend, deploy, invoice, message a client, delete data, or change secrets through this skill.
- If blocked, write the exact blocker and set the task to `awaiting-input` or `blocked`.
- Attach evidence links whenever a task produces an output.

## Minimum Output

Every meaningful task update should include:

- source task id
- source document/spec/research ids when available
- current status
- next action
- artifacts produced
- approvals still required

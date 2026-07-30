# Company folders, Projects, and shared codebases

## Model

| Layer | Purpose |
|-------|---------|
| **Company Cowork** `Cowork/partners/{Company}/` | Identity, research, briefs, multi-app knowledge, company `AGENTS.md` |
| **PiB Project** | Delivery board, tasks, command sessions, approvals, linked locations |
| **On-disk app path** | One real codebase (or monorepo); may be shared by multiple Projects |

## One codebase, two Projects

Supported. Both Projects use **Link existing folder** (or the same `projectFolderRelativePath`) so agents work in the **same** tree.

- Do **not** copy the repo into `projects/{otherId}` for convenience.
- Prefer one project as the “product build” board and another as “ops / QA / launch” if that helps management.
- Avoid dual project-sync as competing canonical sources on the same path.

## Frontend + backend

### Monorepo (recommended)

```text
Cowork/partners/Hunt and Gun/hunt-and-gun-seller-crm/
  frontend/
  backend/
  AGENTS.md
```

- Project location = monorepo root.
- Set `codeRoots` on the project (auto-suggested on existing-folder setup as frontend/backend when applicable).
- Agents receive a code-workspace map in session context.

### Separate sibling repos

Prefer a **parent company cwd** plus an AGENTS map, or register each repo as a project folder and document the sibling path in both AGENTS files. First-class multi-root mapping is the monorepo `codeRoots` list under one primary folder.

## Agent knowledge of company `.md`

Project sessions inject:

1. Project cwd and folder mode (`registered` / shared).
2. Company name / CRM company id when linked.
3. Instructions to read project AGENTS, **parent company AGENTS**, agentDomain wiki, `.pib-workspace.json`.
4. Explicit `codeRoots` when set.

They do **not** paste every company markdown file into the prompt; they are told **where to read**.

## Templates

Use `projectAgentsTemplate()` from `lib/projects/code-workspace.ts` when creating orientation files. Linked-runtime auto-created project folders write a short AGENTS.md with the same rules.

## API

- `PATCH /api/v1/projects/:id` accepts `codeRoots`, `sharedFolder`, `projectFolderMode`.
- Existing-folder project setup may share a registered workspace folder already linked to another project (`sharedProjectIds` on the folder record).

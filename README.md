# Partners in Biz Web

Partners in Biz is the client growth platform for managing campaigns, CRM,
client portals, invoices, content, analytics, and internal AI-assisted
operations.

## Repository

- Production branch: `main`
- Working branch: `development`
- Production releases happen by an explicit `development -> main` promotion.
- Routine development work should not be committed directly to `main`.

## Local Setup

```bash
npm ci
npm run dev
```

The app runs at http://localhost:3000 by default.

## Quality Gates

```bash
npm test
npm run lint
npm run typecheck
npm audit --omit=dev --audit-level=high
```

Use `NODE_OPTIONS=--max-old-space-size=8192` for memory-heavy builds or full
Jest runs.

## Project Knowledge

- Agent instructions: `AGENTS.md`
- System audit: `docs/system-designs/AUDIT-partnersinbiz-web-2026-06-10.md`
- Paired wiki: `/Users/peetstander/Cowork/Cowork/agents/partners`

Keep durable implementation notes in the paired wiki when audit or architecture
decisions change.

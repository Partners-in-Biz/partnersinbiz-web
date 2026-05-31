# Company Tabs Overflow Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the long company-detail tab row with a scalable primary-tabs plus grouped More navigation pattern.

**Architecture:** Keep the public `CompanyTabsBar` API unchanged so admin and portal company detail pages continue to pass `activeTab`, `onChange`, and `counts`. Render the five high-frequency destinations first, pin the selected overflow destination into the visible row, and put the remaining modules into grouped menu sections.

**Tech Stack:** Next.js App Router, React, TypeScript, Material Symbols, Jest, React Testing Library.

---

### Task 1: Company Tabs Overflow Navigation

**Files:**
- Modify: `components/crm/CompanyTabsBar.tsx`
- Test: `__tests__/components/crm/CompanyTabsBar.test.tsx`

- [ ] **Step 1: Write the focused component tests**

Create `__tests__/components/crm/CompanyTabsBar.test.tsx` with tests that render the component, verify the visible primary tabs, open the grouped More menu, preserve count badges, and pin a selected overflow tab.

- [ ] **Step 2: Run the new test before implementation**

Run: `npm test -- CompanyTabsBar.test.tsx --runInBand`

Expected: FAIL because `CompanyTabsBar.test.tsx` does not exist yet or because the component still renders every tab in the main row.

- [ ] **Step 3: Implement grouped More navigation**

Update `components/crm/CompanyTabsBar.tsx` to:
- Keep `overview`, `contacts`, `deals`, `projects`, and `documents` in the visible row.
- Add the active overflow tab to the visible row when selected.
- Render a `More` menu with Commercial, Delivery, Relationships, and Insight groups.
- Preserve icons, badges, ARIA roles, and disabled-free button navigation.

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm test -- CompanyTabsBar.test.tsx --runInBand
npx eslint components/crm/CompanyTabsBar.tsx __tests__/components/crm/CompanyTabsBar.test.tsx
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add components/crm/CompanyTabsBar.tsx __tests__/components/crm/CompanyTabsBar.test.tsx docs/superpowers/plans/2026-05-31-company-tabs-overflow-navigation.md
git commit -m "feat(crm): group company detail overflow tabs"
```

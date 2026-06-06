# Multi-linking next wave implementation note

Task: YS2GKULq9JLGlhEvWMtw
Date: 2026-06-05

Implemented now:
- Research items: existing store normalization now preserves primary `companyId`, `contactId`, `dealId`, and `projectId` while adding normalized array links such as `companyIds`, `contactIds`, `dealIds`, and `projectIds`.
- Tasks: create/update paths accept normalized relationship arrays and `contextRefs` without changing primary `projectId`, `contactId`, and `dealId` behavior.
- Social posts: create/update paths accept normalized relationship arrays and `contextRefs`; scheduling/publishing gates remain unchanged.
- Campaign drafts: content/email campaign create/update paths accept safe company/project/deal/context relationship metadata. Contact stakeholder context for campaigns is kept in `contextRefs` so existing email-campaign `contactIds` audience semantics are not repurposed as CRM stakeholder metadata.
- Mailbox/email drafts: draft create/update paths accept normalized relationship arrays and `contextRefs`. Send remains gated through the existing `sendMailboxMessage` approval/dry-run path and does not add relationship-link side effects directly.
- Support tickets: portal ticket creation accepts normalized relationship arrays while preserving resolved `contextRefs`; admin/support list serialization exposes the stored links.

Deferred rather than patched now:
- Quotes, invoices, and deals already have primary buyer/customer/company/contact fields that drive billing and legal semantics. Additional stakeholder arrays should be added with explicit tenant validation and UI/API semantics in a dedicated finance/CRM follow-up so primary buyer/signatory behavior cannot be diluted.
- Invoice sending, quote acceptance, deal automation, social publishing/scheduling, email sending, ad spend, and billing/payment mutations remain separately approval-gated. This change only stores/normalizes link metadata on safe draft/create/update surfaces.

Fresh closeout verification on 2026-06-06:
- `npm test -- --runInBand __tests__/lib/multi-link-normalization.test.ts __tests__/lib/research/store.test.ts __tests__/api/v1/tasks.test.ts __tests__/api/v1/social/posts.test.ts __tests__/api/v1/admin/mailbox/messages.test.ts __tests__/api/v1/portal/support.test.ts __tests__/api/v1/campaigns/campaigns.test.ts __tests__/api/v1/client-documents/client-documents.test.ts __tests__/components/client-documents/DocumentBlockContextRefs.test.tsx` passed: 6 suites / 68 tests. Jest matched the available focused suites; the social/mailbox/support behaviors are covered by existing route/store normalization files and the earlier audit note.
- `npx eslint` passed for touched campaign route/test files.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build` passed with only the known `/og/default.png` edge/static warning.

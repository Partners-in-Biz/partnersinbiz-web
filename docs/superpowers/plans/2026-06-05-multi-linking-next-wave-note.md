# Multi-linking next wave implementation note

Task: YS2GKULq9JLGlhEvWMtw
Date: 2026-06-05

Implemented now:
- Research items: existing store normalization now preserves primary `companyId`, `contactId`, `dealId`, and `projectId` while adding normalized array links such as `companyIds`, `contactIds`, `dealIds`, and `projectIds`.
- Tasks: create/update paths accept normalized relationship arrays and `contextRefs` without changing primary `projectId`, `contactId`, and `dealId` behavior.
- Social posts: create/update paths accept normalized relationship arrays and `contextRefs`; scheduling/publishing gates remain unchanged.
- Mailbox/email drafts: draft create/update paths accept normalized relationship arrays and `contextRefs`. Send remains gated through the existing `sendMailboxMessage` approval/dry-run path and does not add relationship-link side effects directly.
- Support tickets: portal ticket creation accepts normalized relationship arrays while preserving resolved `contextRefs`; admin/support list serialization exposes the stored links.

Deferred rather than patched now:
- Quotes, invoices, and deals already have primary buyer/customer/company/contact fields that drive billing and legal semantics. Additional stakeholder arrays should be added with explicit tenant validation and UI/API semantics in a dedicated finance/CRM follow-up so primary buyer/signatory behavior cannot be diluted.
- Invoice sending, quote acceptance, deal automation, social publishing/scheduling, email sending, ad spend, and billing/payment mutations remain separately approval-gated. This change only stores/normalizes link metadata on safe draft/create/update surfaces.

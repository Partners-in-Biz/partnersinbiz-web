# Selected organisation context audit map

Source spec: PIB - Website project document `4znonQc8Yq3ggs2XvpRI`, "Selected Organisation Context Rollout — Approved Change Spec".

Shared resolver: `lib/api/selectedOrgContext.ts`

## Resolver contract

- `requestedOrgId` wins when a route/body/header explicitly scopes the operation and the user can access that org.
- Client portal users with no explicit requested org prefer `activeOrgId` when it is one of their accessible `orgIds`.
- If the active selected org is missing or inaccessible, client portal users fall back to their default `orgId`, then the first accessible `orgIds` value.
- Admin and AI routes remain explicit by default. They must pass an org id instead of silently falling back to an admin default.
- CRM-specific views should use `crmScopeOrgId` or route/company/contact/deal scope, not generic selected-org defaults.

## Surface classifications

| Surface | Classification | Resolver | Notes |
| --- | --- | --- | --- |
| Agent chat and Hermes runs | selected-org-aware | selectedOrgContext | Conversations, injected prompts, run payloads, and scheduled work should carry the active selected workspace org. |
| Projects/Kanban | selected-org-aware | selectedOrgContext | Project/task/comment/evidence defaults should use selected workspace context unless a route/project id has an explicit tenant. |
| Client documents | selected-org-aware | selectedOrgContext | Spec, report, brief, approval, review, and document list/create defaults should follow the selected workspace. |
| Workspace files/artifacts | selected-org-aware | selectedOrgContext | Folders, uploads, Drive docs, generated assets, and artifacts should default to the selected workspace. |
| Briefings/inbox/notifications | selected-org-aware | selectedOrgContext | Attention feeds, briefing lists, inbox summaries, and notification dashboards should use selected workspace scope where tenant data is shown. |
| Reports/dashboards | selected-org-aware | selectedOrgContext | Activity summaries, analytics, monthly reports, support/social stats, and dashboards should prefer active selected org. |
| Support | selected-org-aware | selectedOrgContext | Ticket lists, ticket creates, summaries, and comments should default to selected workspace. |
| Social/content/SEO/ads | selected-org-aware | selectedOrgContext | Campaign, content, SEO sprint, and ads workspace defaults should follow the selected workspace while preserving approval gates. |
| Research intelligence | selected-org-aware | selectedOrgContext | Research items, citations, competitor notes, and generated recommendations should default to selected workspace. |
| CRM company/contact/deal views | CRM-scoped | crmScopeOrgId | CRM list/detail surfaces keep explicit CRM org, company, contact, deal, and command-center filters. Do not silently switch to generic selected-org lists. |
| CRM company invoices | CRM-scoped | crmScopeOrgId | Company invoice tabs stay on company/command-center invoice payloads with company filtering, not generic invoice lists. |
| Platform admin settings | intentionally global | global | Super-admin platform settings, agent registry, policy, feature flags, and internal operations are platform/global unless a route explicitly selects a client org. |
| Public tokenized links | not applicable | token | Public invoice/document/PDF links resolve by signed/tokenized public route, not current user selected organisation. |

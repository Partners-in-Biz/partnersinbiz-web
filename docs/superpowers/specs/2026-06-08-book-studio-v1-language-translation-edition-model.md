# Book Studio V1 Language, Translation, And Edition Governance Model

**Date:** 2026-06-08
**Status:** Design-only governance model; not an implementation plan.
**Authoritative approval packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Decision index:** `docs/superpowers/specs/2026-06-08-book-studio-v1-decision-index.md`
**Coverage audit:** `docs/superpowers/specs/2026-06-08-book-studio-objective-coverage-audit.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`
**Source refresh execution report:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-execution-report.md`
**Publishing and analytics model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-publishing-analytics-model.md`
**Editorial quality model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-editorial-quality-reader-experience-model.md`
**Production package QA model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-production-package-qa-model.md`
**Book family gate catalog:** `docs/superpowers/specs/2026-06-08-book-studio-v1-book-family-gate-catalog.md`
**Hermes skill contract pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-hermes-skill-contract-pack.md`
**Acceptance fixture pack:** `docs/superpowers/specs/2026-06-08-book-studio-v1-acceptance-fixtures.md`
**Red-team register:** `docs/superpowers/specs/2026-06-08-book-studio-v1-red-team-risk-register.md`

## Purpose

A translated book is not just the same book in another language. In Book Studio V1, a translated edition is a separate edition, package, listing, review surface, and analytics unit that happens to depend on a source edition.

The central rule is: Book Studio may capture language and translation intent in V1 design, but no translated-edition production, portal proof, package QA, manual handoff, or analytics summary can pass until the source language, target language, translation rights, AI or translator provenance, target-language quality, edition identity, channel support, metadata, identifiers, pricing, territories, disclosure, and analytics evidence pass or carry accepted warnings.

This model does not create runtime translation records, translation generation, translation APIs, KDP Translate automation, Google packet automation, Firestore schema, Hermes dispatch, UI routes, or a Phase 1 implementation plan.

## Current Official Source Posture

The live source refresh on 2026-06-08 supports these design consequences:

- KDP requires the language selected in KDP, the language in the book, and the content file metadata language to match. If a book contains multiple languages, the primary language must be selected. KDP also requires reading direction to match the content for languages where direction applies, and paperback cover layout must match the reading direction. Source: [KDP Language and Reading direction](https://kdp.amazon.com/en_US/help/topic/GQSHRFWZ5CEY7XAC).
- KDP supports many languages but some formats, language combinations, and paperback/hardcover/eBook support differ. Some paperback-only languages cannot become Kindle eBooks or hardcovers, and some PDF upload support is language-limited. Source: [KDP Book Supported Languages](https://kdp.amazon.com/en_US/help/topic/G200673300).
- KDP content guidelines require translator and original-author contributor credit for translations of another work, and AI-generated translations must be disclosed when publishing or republishing through KDP. AI-assisted use remains different, but the publisher is still responsible for IP rights and content guidelines. Source: [KDP Content Guidelines](https://kdp.amazon.com/en_US/help/topic/G200672390).
- Kindle Translate is currently an invite-only beta for eligible KDP eBooks. Direct editing of translated text is not available in the beta flow; translated eBooks are available by territorial selection; the feature cannot create audiobooks or print books. Source: [KDP Beta: Kindle Translate](https://kdp.amazon.com/en_US/help/topic/GRSNH76FDTJHRX49).
- KDP says Kindle Translate translations can use source or custom royalty/list-price choices, have KDP reports, and can carry separate KDP Select enrollment behavior. Source: [KDP Pricing, royalties, and reports for translations](https://kdp.amazon.com/en_US/help/topic/GS36UMYB3M9FDBSB).
- Google Play Books metadata treats language as the primary language of the book and identifiers as edition-specific. Changing a Google book identifier can create a duplicate and ratings/reviews do not carry over. Source: [Google Play Books metadata](https://support.google.com/books/partner/answer/3237055?hl=en).
- Google Play Books add-book flow requires a book ID path, title, language, contributors, series, settings, content files, reviewer access, and pricing rows as separate Partner Center steps. Source: [Google add-book quickstart](https://support.google.com/books/partner/answer/9261664?hl=en).
- Google can assign GGKEY identifiers when there is no ISBN, accepts valid ISBNs, and treats different print/eBook editions and identifiers carefully in catalog and reports. Source: [Google ISBNs](https://support.google.com/books/partner/answer/3431108?hl=en).
- Google content policies prohibit misleading, poor-quality, duplicate, hard-to-read, or spammy content. Source: [Google Play Books content policies](https://support.google.com/books/partner/answer/1067634?hl=en).

## Translation Edition States

| State | Meaning | Allowed next action | Blockers |
| --- | --- | --- | --- |
| `translation_intent_captured` | Operator has named source edition, target language, channel intent, and ownership posture. | Create internal review tasks. | Missing source edition, target language, or ownership. |
| `language_scope_review` | Source and target language, locale, script, reading direction, file format, and channel support are being checked. | Continue evidence collection. | Unsupported target format, unclear primary language, or reading-direction mismatch. |
| `translation_rights_reviewable` | Rights to translate, adapt, and distribute in target territories are documented enough for reviewer assessment. | Move to translation production planning only after quality and channel lanes are ready. | Missing rights, source-work ambiguity, contributor authority gaps, or territory conflict. |
| `translation_production_blocked` | Translation work must not start or continue. | Create evidence or reviewer tasks. | Rights, disclosure, source freshness, target-language reviewer, or channel support missing. |
| `translation_internally_reviewable` | A target-language draft, machine beta output, or translator package exists for internal review only. | Target-language quality review, glossary review, metadata review. | No human target-language review path, no provenance, no source-target traceability. |
| `translation_quality_accepted_with_warnings` | Translation has useful evidence but accepted warnings remain. | Package QA may begin only if the warnings are named and do not affect target-language meaning, rights, or channel safety. | Ambiguous meaning, poor target-language quality, hidden AI disclosure, unreviewed cultural adaptation. |
| `translated_edition_package_ready_for_channel_preflight` | The current target-language version has quality, metadata, disclosure, rights, pricing, territory, identifier, and package evidence. | KDP or Google manual-handoff preflight review. | Any stale source, unsupported format, missing identifier, pricing/territory gap, or proof mismatch. |
| `translated_edition_manually_handed_off` | An operator has external handoff evidence for that channel and edition. | Manual lifecycle tracking and analytics import. | No external action evidence, wrong channel, wrong edition, or unclear KDP Translate beta state. |
| `translation_lifecycle_active` | The translated edition can be tracked, revised, unpublished, or reported separately. | Import reports, track revisions, create lifecycle records. | Blended analytics, source-edition assumptions, stale listing evidence, or unclear KDP Select state. |

## Required Evidence Lanes

| Lane | Required evidence | Devil's advocate |
| --- | --- | --- |
| Source language | Primary language, source edition version, source metadata, source file language metadata, source rights owner. | If the source edition is unstable, the translation is chasing a moving target. |
| Target language and locale | Target language, locale or market assumption, script, reading direction, expected file formats, target reviewer. | "Spanish" or "French" without locale, title fit, and reviewer responsibility can hide market and quality risk. |
| Translation authority | Rights to translate, adapt, distribute, and price in target territories. | A right to publish the source book is not automatically a right to create every translation. |
| Translator and AI provenance | Human translator, AI-generated translation, AI-assisted revision, Kindle Translate beta, glossary, prompt/tool notes, review trail. | AI translation cannot become invisible because a human edited it later. |
| Edition identity | Source edition link, target edition title/subtitle, contributor credits, original author, translator credit, target ISBN/GGKEY plan. | Reusing identifiers or contributor fields blindly can corrupt reports and metadata. |
| Target metadata | Target-language title, subtitle, description, categories/genres, keywords, audience, maturity flags, series labels, contributor roles. | Translated metadata is not a literal word swap; it can mislead if the target market reads it differently. |
| Reading direction and layout | Direction, cover orientation, TOC/nav direction, page spread behavior, print/eBook support, proof screenshots. | Right-to-left or vertical/horizontal assumptions can make a package look broken even if text is translated. |
| Target-language quality | Meaning fidelity, fluency, terminology, cultural adaptation, source/claim preservation, glossary consistency, reviewer sign-off. | A fluent translation can still distort claims, promises, or legal-sensitive language. |
| Channel support | KDP language support, Kindle Translate eligibility, Google metadata/file path, source freshness, format constraints, channel-specific series behavior. | KDP pass does not prove Google pass, and Kindle Translate beta pass does not prove manual translation pass. |
| Pricing and territories | Royalty plan, list price, territory selection, tax/payment caveats, KDP Select translation posture, Google pricing rows. | Source-edition price can be wrong for a translation, and KDP Select can create distribution conflicts. |
| Series consistency | Source series link, target-language series name, volume order, translated continuity bible, channel-specific series eligibility. | A source series can look coherent while translated titles drift or channel series rules differ. |
| Portal summary | Reviewed target-language status, safe blockers, no raw translation notes, no internal rights uncertainty, no target-language quality details unless approved. | Clients may read "translated" as "ready to sell" unless the state and confidence are explicit. |
| Analytics separation | Source edition, translated edition, channel, report type, KDP Translate beta flag, language, territory, period, confidence, reconciliation. | Blended sales hide whether the source book or translation is performing. |

## KDP And Kindle Translate Implications

Manual KDP translated editions:

- Need source and target language evidence, KDP-supported language check, file format check, reading-direction check where applicable, contributor credit, AI disclosure, rights, metadata, pricing, territory, and quality review.
- Must not be marked KDP handoff-ready from source-edition packet readiness alone.

Kindle Translate beta:

- Must be modeled as a separate beta pathway, not as a general translation engine.
- Requires eligibility evidence from the KDP Bookshelf state and current source freshness.
- Cannot be assumed available for every KDP account, source title, print book, audiobook, or language.
- Should create its own warning if the direct editing limitation affects target-language quality review.
- Needs translated-edition pricing, KDP Select, reports, territory, and unpublish tracking separate from source-edition lifecycle state.

## Google Play Books Implications

Google translated editions need their own Google packet:

- primary language,
- identifier or GGKEY plan,
- title, subtitle, description, contributors, publisher, genres, series, settings,
- content files and cover,
- reviewer access,
- price rows and country/currency assumptions,
- duplicate and identifier-change risk,
- content-quality and misleading-metadata review.

Google readiness cannot be inherited from a KDP language pass, KDP Translate beta output, or source-edition Google packet.

## Hermes Boundaries

Allowed Hermes assistance:

- Draft a translation brief, style guide, glossary, target-reader notes, and source-target consistency checklist.
- Compare metadata fields against source evidence and source keys.
- Create target-language quality issue lists and reviewer tasks.
- Draft AI disclosure questions for the operator.
- Draft client-safe translated-edition status wording after admin review.

Forbidden Hermes actions:

- Translate the final book content for publication in V1.
- Mark a translation quality-approved.
- Infer translation rights, territories, or contributor authority.
- Hide AI-generated translation disclosure because a human edited the output.
- Publish, trigger, or manage Kindle Translate.
- Reuse source identifiers, prices, series entries, or metadata blindly.
- Convert KDP readiness into Google readiness.
- Blend translated-edition analytics into source-edition performance without labels.

## Portal And Client Safety

Portal clients may eventually see only reviewed translated-edition summaries:

- target language,
- current state,
- reviewed blocker or warning,
- next requested decision,
- channel-safe handoff state,
- client-facing analytics confidence if imported and reconciled.

Portal clients must not see raw translation prompts, internal rights uncertainty, translator disputes, target-language quality notes, KDP account eligibility screenshots, Google account details, or unreconciled translated-edition report rows.

## Analytics Rules

Translated-edition analytics are separate from source-edition analytics by default.

Minimum translated-edition analytics labels:

- source edition id,
- translated edition id,
- target language,
- channel,
- report type,
- territory,
- period and timezone,
- beta pathway if Kindle Translate,
- confidence and reconciliation state.

No dashboard or portal summary may use translated-edition data to promise global demand, source-edition uplift, bestseller status, or future sales.

## Acceptance Fixtures

| Fixture | Scenario | Expected result |
| --- | --- | --- |
| `LANG-PASS-001` | Business nonfiction eBook has Spanish target-language rights, translator/AI provenance, glossary, target metadata, quality review, KDP and Google source freshness, pricing, and separate analytics labels. | Translated edition can move to channel preflight for the current target-language version only. |
| `LANG-WARN-001` | Target language and draft are useful, but Google identifier, KDP Select posture, or human target-language reviewer evidence is incomplete. | Internal review continues with owner/date warnings; portal and handoff remain blocked. |
| `LANG-BLOCK-001` | AI-translated public-domain companion or unsupported target-language file tries to reach package QA or portal with hidden disclosure and weak rights. | Book Studio blocks package QA, portal promotion, and manual handoff. |

## Future Planning Requirements

Any future implementation plan that includes translated editions must preserve:

- source/target edition separation,
- source refresh for KDP language, KDP AI/content, Kindle Translate, Google metadata/add-book/identifier/content policy sources,
- target-language quality gates before package QA or portal proof,
- AI translation disclosure derivation from provenance,
- channel-specific KDP and Google readiness,
- translated-edition analytics separation,
- pass/warn/block fixtures.

## Current Review State

This model strengthens Book Studio V1 by making translated editions explicit. It does not change the recommended V1 posture:

- internal PiB production studio,
- KDP and Google Play Books manual handoff first,
- controlled Hermes skill readiness,
- no runtime translation engine,
- no Kindle Translate automation,
- no translated-edition portal or package readiness without the language and translation gates above.

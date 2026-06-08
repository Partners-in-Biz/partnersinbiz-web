# Book Studio V1 Jurisdiction And Local Publisher Model

**Date:** 2026-06-08
**Status:** Design-only operating model; not legal, tax, accounting, publishing, or implementation advice.
**Authoritative dossier:** `docs/superpowers/specs/2026-06-07-book-studio-research-dossier.md`
**Decision packet:** `docs/superpowers/specs/2026-06-08-book-studio-v1-approval-packet.md`
**Ownership and commercial model:** `docs/superpowers/specs/2026-06-08-book-studio-v1-ownership-commercial-model.md`
**Source refresh contract:** `docs/superpowers/specs/2026-06-08-book-studio-v1-source-refresh-contract.md`

## Purpose

Book Studio is being designed from a South African PiB operating base, even when the first sales channels are Amazon KDP and Google Play Books. V1 therefore needs a jurisdiction and local publisher review layer so the module does not imply that a KDP/Google-ready packet is automatically complete for the publisher's local obligations.

This model defines the evidence lanes and gate behavior that a future implementation plan must preserve. It does not create records, legal templates, tax flows, APIs, Firestore collections, routes, Hermes skills, publishing integrations, legal advice, or a Phase 1 task list.

## Current Source Implications

These sources were checked on 2026-06-08 and should remain source-refresh gated:

| Source | Implication for Book Studio |
| --- | --- |
| NARSSA Legal Deposit FAQ: `https://www.nationalarchives.gov.za/node/475` | Legal deposit is described as a legal obligation for South African publishers or producers, including documents published in South Africa or adapted for the South African public. Book Studio should treat legal-deposit state as a local publisher evidence lane when South Africa is the publisher jurisdiction or target adaptation. |
| Legal Deposit Act PDF via NARSSA: `https://www.nationalarchives.gov.za/sites/default/files/Legal%20Deposit%20Act.pdf` | The Act defines published documents, publisher responsibility, prescribed copies, publisher-borne cost, and a default dispatch timing of 14 days unless otherwise prescribed. Book Studio should track evidence tasks and dispatch status, not make legal conclusions. |
| CIPC copyright registration page: `https://www.cipc.co.za/?page_id=4586` | CIPC lists literary works as copyright-eligible, says the work must be original and in material form, and limits copyright registration through CIPC to cinematographic films. Book Studio should preserve authorship/provenance evidence and avoid promising that book copyright is "registered" through CIPC. |
| CIPC copyright FAQ: `https://www.cipc.co.za/?page_id=4160` | CIPC explains that most eligible works do not require registration or formalities except cinematographic films, and that copyright is secured automatically upon creation if requirements are met. Book Studio should use copyright posture labels and reviewer tasks, not legal-advice copy. |
| International ISBN Agency: `https://www.isbn-international.org/` | ISBN is a global book identifier system coordinated through regional or national registration agencies. Book Studio should treat ISBN source and agency as source-backed metadata, not a plain string. |
| ISBN.org ISBN standard page: `https://www.isbn.org/about_ISBN_standard` | ISBNs identify both the title/product and the publisher contact; ISBNs from a non-official source may not identify the publisher accurately. Book Studio should distinguish platform ISBN, official-agency ISBN, publisher/imprint owner, and channel restrictions. |
| Publishers Association of South Africa ISBN note: `https://publishsa.co.za/isbn-numbers/` | PASA says South African ISBN applications should contact the ISN Agency, which forms part of the National Library of South Africa. Use this as South African publisher workflow evidence, while still source-refreshing the NLSA contact path before operational use. |

## Trigger Conditions

The local publisher layer should appear when any of these are true:

- Ownership mode is `pib_owned` and PiB is the publisher, imprint owner, or commercial risk owner.
- Ownership mode is `client_owned` and the client is South African, uses a South African imprint, or asks PiB to prepare a book for the South African public.
- A book is published in South Africa, adapted for the South African public, or intended for South African distribution in print, ebook, audio, or other public document formats.
- A South African ISBN, imprint, author business, publisher address, tax/payment profile, legal deposit claim, or local copyright posture is used in the packet.
- The book uses a platform-provided ISBN but the portal or packet wording could imply PiB or the client is the ISBN-listed publisher.

The layer should not block internal research, drafting, outlining, editing, or proof work. It should block or warn only release-sensitive claims: manual handoff readiness, public publisher/imprint claims, client-facing legal/compliance wording, and analytics or revenue statements tied to publisher identity.

## Evidence Lanes

| Lane | Evidence to capture later | Safe state wording | Release-sensitive blocker |
| --- | --- | --- | --- |
| Publisher jurisdiction | Publisher country, entity/person, imprint, account owner, and target public. | "Publisher jurisdiction evidence needed." | Packet claims upload-ready or locally compliant while jurisdiction is unknown. |
| Legal deposit | Applicability assessment, dispatch requirement owner, deposit copies/status, date, receipt/reference, exemption note if reviewed externally. | "Local deposit evidence pending." | Public/manual-handoff claim says local obligations are complete without evidence. |
| ISBN and imprint | ISBN source, official agency, format binding, publisher/imprint owner, platform ISBN constraints, metadata responsibility. | "ISBN/imprint decision pending." | ISBN owner, imprint, format, or platform restrictions are unclear. |
| Copyright posture | Human authorship, AI-generated/assisted classification, contributors, copyright notice, registration limitation note, legal-review task where needed. | "Rights and authorship evidence pending." | Packet claims copyright registration, ownership, or rights clearance without reviewed evidence. |
| Contributor authority | Ghostwriter, editor, designer, illustrator, narrator, photographer, translator, and font/asset licenses. | "Contributor evidence pending." | Public packet relies on unassigned or unlicensed contributor work. |
| Tax/payment/account authority | Account owner, external readiness labels, report access, payment profile readiness, and consent artifacts. | "Account authority evidence pending." | PiB/client ownership or revenue claim conflicts with account/payment evidence. |
| Territory and adaptation | Rights territory, target market, South African adaptation, public-domain jurisdiction assumptions, and client approval. | "Territory evidence pending." | Channel packet assumes rights or public-domain status from one jurisdiction only. |

## V1 Design Consequences

- KDP and Google Play Books manual-handoff packets stay channel-specific, but local publisher obligations are an independent review lane.
- A KDP/Google pass should not automatically resolve South African legal deposit, ISBN/imprint, copyright, tax/payment, or contributor-authority posture.
- Legal deposit state should warn during internal review and block local-compliance or upload-ready wording when the selected publisher jurisdiction requires evidence.
- ISBN decisions should be made before print packet approval. A KDP free ISBN, a Google GGKEY/no-ISBN path, and a South African official-agency ISBN carry different publisher/imprint consequences.
- Book Studio should preserve evidence and create reviewer tasks; it should not decide legal compliance, draft legal advice, or tell clients that a legal obligation has been satisfied without reviewed evidence.
- Client portal wording should be decision-safe: "Local publisher evidence needed", "ISBN/imprint decision pending", or "PiB is reviewing publisher evidence", not internal legal analysis.
- South African local obligations should apply to both PiB-owned and client-owned books when the trigger conditions fit; PiB-owned projects are not exempt from the evidence lane.
- Future Hermes skills may summarize source implications and create tasks, but may not give legal advice, select an imprint owner, claim legal-deposit compliance, or approve copyright/ISBN decisions.

## Packet State Overlay

Local publisher review should produce one of these conceptual states:

| State | Meaning | Allowed use |
| --- | --- | --- |
| `not_applicable_reviewed` | Reviewer records why no local publisher obligation is triggered for this packet. | Channel packet can proceed if other gates pass. |
| `evidence_needed` | Jurisdiction or local obligation may apply, but evidence is incomplete. | Internal drafting and review only. |
| `reviewable` | Evidence exists, but a human reviewer must decide whether it is enough for the selected packet claim. | Internal review and task routing. |
| `ready_with_evidence` | Reviewer accepts evidence for the current packet version and claim scope. | Can support manual-handoff or client-safe wording for that scope only. |
| `blocked_or_disputed` | Evidence contradicts the claim, is stale, or creates unresolved legal/account/publisher risk. | Blocks local-compliance wording, upload-ready claims, and portal promotion. |

Each state applies to a specific package, channel, publisher, imprint, ISBN, and version. Changing any of those should invalidate the affected local publisher evidence, not the entire book project.

## Source Evidence Keys

Future source evidence should be separated from KDP/Google policy keys:

```yaml
localPublisherSourceKeys:
  south-africa-legal-deposit-faq:
    url: https://www.nationalarchives.gov.za/node/475
    staleAfterDays: 90
    affects:
      - legal_deposit_lane
      - south_africa_publication_claim
  south-africa-legal-deposit-act:
    url: https://www.nationalarchives.gov.za/sites/default/files/Legal%20Deposit%20Act.pdf
    staleAfterDays: 180
    affects:
      - legal_deposit_lane
      - dispatch_timing_claim
      - publisher_definition
  south-africa-copyright-cipc:
    url: https://www.cipc.co.za/?page_id=4586
    staleAfterDays: 180
    affects:
      - copyright_posture
      - registration_claim
      - authorship_provenance
  south-africa-copyright-cipc-faq:
    url: https://www.cipc.co.za/?page_id=4160
    staleAfterDays: 180
    affects:
      - copyright_posture
      - registration_formality_claim
  isbn-global-agency:
    url: https://www.isbn-international.org/
    staleAfterDays: 180
    affects:
      - isbn_source
      - official_agency_claim
  isbn-publisher-identity:
    url: https://www.isbn.org/about_ISBN_standard
    staleAfterDays: 180
    affects:
      - imprint_owner
      - publisher_identity
      - non_official_isbn_warning
  south-africa-isbn-workflow:
    url: https://publishsa.co.za/isbn-numbers/
    staleAfterDays: 90
    affects:
      - south_africa_isbn_contact_path
      - nlsa_isn_agency_workflow
```

The PASA source is useful workflow evidence, not a substitute for refreshing the current NLSA or ISN Agency contact path before operational use.

## Review Questions For Peet

1. Should PiB-owned South African books use a PiB imprint, author/person imprint, or a separate publisher identity?
2. For client-owned books, should PiB default to client-owned ISBN/imprint decisions unless the client explicitly asks PiB to publish under a PiB-owned imprint?
3. Should Phase 1 pilots include a South African local-publisher evidence fixture, or should this stay a mandatory warning lane only?
4. Should legal deposit evidence be collected before manual handoff, after publication status is recorded, or as a follow-up task with a due date?

## Devil's Advocate

- The team could falsely assume that KDP or Google publication satisfies local obligations. The design must keep channel readiness and local publisher readiness separate.
- A platform-provided ISBN can be convenient but may conflict with PiB/client imprint goals or future distribution. Book Studio should make the tradeoff visible before print approval.
- Legal deposit can look like a back-office task and get missed after launch. The packet should create an owner, due date, and evidence slot before the claim is considered settled.
- Overbuilding legal tooling is also risky. The module should collect evidence and route reviewer decisions, not become a legal-advice system.
- Public-domain, quote, translation, and AI-authorship assumptions can change by jurisdiction. One jurisdiction's answer should not become a global rights claim.
- Contributor contracts and asset licenses can be less visible than manuscript text, but they can block the book just as completely as channel policy.
- Portal transparency can overexpose internal legal risk. Clients need clear safe blockers and reviewed decisions, not raw legal notes.

## Current Review State

This model strengthens the Book Studio V1 approval packet by adding a local publisher evidence layer. It does not change the recommended V1 posture:

- Internal PiB production studio.
- KDP and Google Play Books manual handoff first.
- PiB-owned and client-owned workflows with explicit account, imprint, publisher, and local evidence states.
- Manual analytics imports with confidence labels.
- No runtime implementation or Phase 1 plan until Peet approves or revises the V1 approval record.

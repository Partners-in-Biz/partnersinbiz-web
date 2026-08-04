# External accountant acceptance pack — PiB Finance multi-month close

**Artifact type:** checklist pack for human sign-off (not a wet-signature product).
**Hard gates:** no SARS submit · no payment initiate · no mass client email · development/staging only.

| Field | Value |
| --- | --- |
| Org | org_verify_proving |
| Company | PiB Proving Holdings (Pty) Ltd |
| Seed key | pib-demo-proving-v1 |
| Program id | mmclose_6bf27ccff5 |
| Exported at | 2026-08-03T15:00:00.000Z |

## Evidence folder structure

- `artifacts/finance/multi-month-close/`
- `artifacts/finance/multi-month-close/seed/`
- `artifacts/finance/multi-month-close/close-runs/`
- `artifacts/finance/multi-month-close/packaging/`
- `artifacts/finance/multi-month-close/acceptance/`
- `docs/operations/finance/multi-month-close-program-2026-08-03.md`
- `docs/operations/finance/phase6-accountant-acceptance-pack-2026-08-03.md`
- `/portal/finance/proving`
- `/portal/finance/runbooks`

## Freeze hashes

- `ebd8461221af9a2900ef9647cf0912d0968ca75419b0073aedd046058c711525`
- `99c14520b8097689abd05c988acfd2e21e921c9ea0de7218b619019ce8853018`
- `c5b1453d6bf080afba71819172b673fb4d21a9347ac653536b81536e764155f0`
- `c0369d1f3a06770cde68661c65358676d47d03f7b4e1880e224afc9111609a91`
- `9740e5b7f75aaa3be1dad5f811ca0b6eda5d4a81ffb78fe6b45828a390098ede`
- `d3332c6bb28b28890d0ac4831d6124a7ac8f4bb20c2d0d043b3d95bce4433bdc`

## Packaging sample digests

- `e07f718e72ab613045add87c6f85b11cca2a0214dc35c4bae0da03c0ba301813`
- `2ca0536bac7849f250a4f65a89521eb0de3d2193c1e92b3e3fdb748448cd106a`
- `dab4ac5bd51e4d1a15347fa101e5ae31ae435a08d99a16d5edacc58f2a657209`
- `fe7ceedec7f01f37857d1fc3cbf46a05dd6611c98122be36721da1614a845090`
- `0829ef3cac4e6a3d6ee9e073648e0b0fb9ba065cf305e33b9097785993c51585`
- `e729955236cfd41f0f5819fc5c96b7be0f061ff7691e28077f940745426334a2`
- `da15e0b2f9a0588764199ed24d4c2fc33c0ca9f5bd0b9cb1ad778156db8c4d55`
- `57d690d68d741a9f0d7b8d0adc85e01d933d2fb964bd859fc397b85eb2722d61`
- `ad6b772d766e6a04399629befc8c4c603a315855ce6dd7923db3710f9126f9fc`
- `ef5f28f7f502dbf5cdf0cc6526e094bb91732b2617df19ec3131c58e426a9082`
- `5fbf1f0fe941ac59fb0193e34eeac5bbc6d7ef577c8c1e852e6e20a98e33f2e6`
- `72cef71decbddfe8e69766ac1598646c0faccc346b817b7c23c1b2ad2548e5ba`
- `2889ec67f86ab36183bb36c7bdda08e52c8fdd5d043684f4791a5c8569647bbc`
- `02f88c23f5c5e4e2483583a2c0a61f235f204ba34f5f3bcbd90a9a09e7ce961b`
- `9ce75c1329906043756e459efb9d8b8510a3def2aec9c8961b16faf92bb7220d`

## Checklist

[ ] **1. Confirm development/staging tenant** (Environment, required)
   Org is non-production. Finance module enabled. No main/prod deploy planned from this run.
   Evidence hint: Portal URL + orgId chip

[ ] **2. Run deterministic proving seed** (Seed, required)
   Multi-entity HOLD/OPS/SVC books, COA, three periods, sample AR/AP, bank, payroll, FX, assets, job costing dims.
   Evidence hint: Seed snapshot seedKey + entity codes

[ ] **3. Re-run seed is idempotent** (Seed, required)
   Second seed with same seedKey returns identical snapshot digest without duplicate journals.
   Evidence hint: Jest proving-domain or UI re-seed message

[ ] **4. Open period has activity** (Close, required)
   Posted journals exist in the target period before close.
   Evidence hint: Ledger journal count > 0

[ ] **5. Close checklist shows real blockers** (Close, required)
   Unreconciled bank / unapproved pay run / open FX reval / incomplete cutover / missing depreciation block close.
   Evidence hint: Close run status=blocked with unresolved codes

[ ] **6. Resolve blockers then hard-close** (Close, required)
   After resolving blockers, period transitions to hard_closed with approval evidence.
   Evidence hint: Close run status=closed + period.status

[ ] **7. Reports freeze after close** (Close, required)
   Trial balance freeze snapshot hash is stable; further ordinary posts to hard-closed period fail.
   Evidence hint: freeze.trialBalanceHash + rejected post

[ ] **8. Dry-run SARS EMP201 pack** (Packaging, required)
   Download pack contains realistic PAYE/UIF/SDL rows. sarsSubmissionInitiated remains false.
   Evidence hint: packaging dry-run file list + hard gates

[ ] **9. Dry-run payment instruction pack** (Packaging, required)
   EFT instruction CSV/JSON generated. externalPaymentInitiated remains false.
   Evidence hint: payment.eft_instructions dry-run

[ ] **10. Dry-run accountant pack set** (Packaging, required)
   Trial balance, GL, open items, audit extract packs download with content.
   Evidence hint: accountant.* dry-run rowCount > 0

[ ] **11. Hard gates still false** (Hard gates, required)
   No SARS submit, no external payment initiate, no mass email, externalEgressAllowed=false across seed/close/packs.
   Evidence hint: hardGates object on snapshot + packs

[ ] **12. Run multi-month close program (≥3 periods × ≥2 entities)** (Multi-month, required)
   OPS+SVC (or equivalent) close 2026-05/06/07 with IC matched, FX closed where applicable, payroll locked, bank recon history, packaging dry-run.
   Evidence hint: program.closedPeriodCount ≥ 3 and closedEntityCount ≥ 2

[ ] **13. Confirm IC + FX + payroll lock evidence** (Multi-month, required)
   Program evidence shows matched IC, locked payroll runs, and FX reval closed on participating entities.
   Evidence hint: program.evidence ic/fx/payroll counters

[ ] **14. Export accountant acceptance pack (sign-off artifact)** (Handoff, required)
   Export markdown+JSON pack with checklist, freeze hashes, packaging digests, and blank human sign-off lines. Not a wet-signature product.
   Evidence hint: acceptancePackExport.contentSha256 + evidence folder paths

[ ] **15. Print/export checklist for accountant sitting** (Handoff, optional)
   Use browser print or exported pack; attach seedKey, program id, close run ids, pack digests to Quinn evidence.
   Evidence hint: Printed checklist / exported pack path

## Known gaps (do not hide)

- **ic_fixture_not_live_service:** IC evidence is proving-kit fixture markers (matched due-to/due-from), not a full live intercompany propose/receive journal chain in this program path.
- **proving_store_process_local:** ProvingFinanceGateway store is process-local (dev/staging fixture), not durable multi-instance Firestore workspace state.

## Accountant sign-off (human completes)

I confirm I ran this pack in one sitting against the stated seed/program and hard gates remain false.

| Field | Sign |
| --- | --- |
| Accountant name | _______________________________ |
| Firm | _______________________________ |
| Date | _______________________________ |
| Signature (hand/print) | _______________________________ |
| Notes | _______________________________ |

_Wet-signature product: false — this is a printable checklist artifact only._

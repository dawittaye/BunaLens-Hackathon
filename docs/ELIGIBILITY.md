# Publication eligibility and review (Phase 5)

Recorded 2026-11-21. Sprint additions. Applied to the local test database
only; pending on hosted.

## Existing grading-rule configuration

None usable. The repository has no grading-rule table or migration. The
hosted project has a `grading_rule_sets` table with no migration (schema
drift, see `docs/FOUNDATION.md`); it was not read or used. No validated
thresholds were supplied, so the sprint uses a DEMO policy.

## The DEMO policy: `demo-policy-2026-11-21`

These thresholds were chosen for the demonstration. They are not Ethiopian
standards, not export certification and not universal quality limits. They
are stored in `public.eligibility_policies.rules` (JSON) and can be replaced
by inserting a new policy row and making it the active one. Every decision
records the policy id it was made under.

| Input | Green beans | Red cherries | Accepted method and unit |
|---|---|---|---|
| Defect percentage | Fail above 8 | Fail above 10 | Green: `hand_sort_weighed_sample`, `% by weight`. Cherry: `hand_count_sample`, `% by count` |
| Bean moisture | Fail below 9 or above 12 | Not applied | `moisture_meter`, `%` |
| Bean size | Fail below screen 14 | Not applied | `screen_sieve_set`, `screen (1/64 inch)` |
| Visible damage or discolouration (photo estimate: black or discoloured + insect-damaged or broken share) | Pass up to 10, manual review above 10 to 25, fail above 25 | Same | Saved photo screening only |

Rationale, also stored with the policy: a moisture window for dried beans in
storage; a defect share that comes from sorting or counting a sample; a
minimum screen from a sieve set; and a photo estimate that may only pass
when low and fail when clearly high. Fresh cherries are not dried or
screened, so moisture and size are not applied to them.

Outcome rules:

- Any clear violation from an accepted method → **fail**, with the specific reason.
- No violation, but an input is missing, uses a method or unit the policy
  does not accept, was rejected by a reviewer, or the photo screening needs
  review or a retake → **manual review**.
- Otherwise → **pass**.

What cannot satisfy an input:

- A visual estimate cannot satisfy defect percentage or bean size.
- Warehouse humidity cannot satisfy bean moisture. The rule code never reads
  sensor readings, and a reading recorded with a humidity method is not accepted.
- Simulated evidence is accepted by this demo policy only
  (`accept_simulated_evidence`). A decision that uses it is flagged, and a
  listing that rests on it is forced to `is_demo = true`.
- Station-recorded readings are accepted unverified, with their verification
  status kept. A reviewer can reject a reading, which sends the lot to manual
  review. This is a demo simplification.

## Evidence kept per input

`public.lot_evidence`: value, unit, method, source (`measured`,
`visually_estimated`, `reviewer_entered`, `simulated`), reading time, who
recorded it, verification status (`unverified`, `verified`, `rejected`), who
verified it and when, note. "Missing" is the absence of a row. Visible damage
is read from the saved photo screening; its source is `visually_estimated`
for live inference and `simulated` for a demo fixture.

## Decisions and audit

`public.lot_reviews` (existing table, columns added): decision, reason,
`decided_by` (rule or reviewer), reviewer id, time, policy id, rule outcome
at that moment, evidence references, full evaluation snapshot, evidence
fingerprint, override flag, simulated-evidence flag.

| Action | Who | Function |
|---|---|---|
| Record a reading | Station owner (measured, visually estimated, simulated); reviewer from outside the station (reviewer-entered, stored as verified under their identity) | `bunalens_record_lot_evidence` |
| Verify or reject a reading | Reviewer or administrator, not of that station | `bunalens_verify_lot_evidence` |
| Apply the rules | Station owner or reviewer | `bunalens_evaluate_lot_eligibility` |
| Decide a manual review, or reject | Reviewer or administrator, not of that station, with a reason | `bunalens_review_lot` |
| Pass a lot that fails a rule | Administrator only, override requested explicitly, recorded as an override | `bunalens_review_lot(..., p_override => true)` |
| Approve or suspend a seller | Administrator only | `bunalens_set_seller_status` |
| Read the current state for the lot screen | Station owner or reviewer | `bunalens_lot_eligibility` |

Roles come from `app_metadata.role` (`reviewer`, `admin`), which a user
cannot edit. A self-assigned role in user metadata gives nothing (checked).

## Five separate states

| State | Where |
|---|---|
| Photo screening | `coffee_batches.grading_result.screening` |
| Listing eligibility | `coffee_batches.eligibility_status` and `lot_reviews` |
| Administrative approval of the seller | `stations.marketplace_seller_status` |
| Published | `marketplace_listings.status` |
| Official grade | Always `Unclassified` |

Becoming eligible never publishes. A listing becomes published only by an
explicit write, and at that moment the database checks: the lot is eligible,
the seller is approved, there is stock, the last decision is `eligible`, the
evidence and policy still match that decision, and a rule decision still
passes. New evidence, a verification change or a new photo assessment resets
the lot to unreviewed and pauses its published listing. Re-evaluation does
not publish again.

Clients cannot write `marketplace_listings`. There is no seller publish
function yet; that belongs to Phase 6. In this phase the publication rules
were exercised by writing listing rows with the local service role.

## Demo cases (local test stack, demo seller, all readings SIMULATED)

| Case | Lot key and code | Evidence | Result |
|---|---|---|---|
| 1. Pass | `demo-case-pass`, BNL-JMA-0688 | Demo-fixture screening (2% visible damage), defects 3.5 % by weight, moisture 11.0 % then 11.4 %, screen 15 | Pass → eligible. Published as a demo listing at the end of the run |
| 2. Fail | `demo-case-fail`, BNL-JMA-A8E5 | Same, but moisture 14.2 % | Fail → rejected: "Bean moisture 14.2 % is above the policy limit of 12." |
| 3. Manual review | `demo-case-review`, BNL-JMA-7687 | Defects 4.0 %, screen 15, and a 61.5 %RH warehouse humidity reading offered as moisture | Manual review: the humidity method is not accepted for bean moisture |

Reproduce:

```
node scripts/hackathon/verify-eligibility.mjs
```

Result on 2026-11-21: 49 of 49 checks passed, run twice. The script sets the
reviewer and administrator roles and writes listings with the local service
role; those steps are marked in the script. Demo accounts added:
`demo-reviewer@bunalens.test`, `demo-admin@bunalens.test` (passwords in the
ignored `.env.backend`).

## What the checks cover

- Stage rules: cherries pass without moisture or size; a 55 % cherry moisture
  reading is ignored; the green-bean defect method is not accepted on cherries.
- Bypass: a seller cannot update `eligibility_status`, insert a review, insert
  a listing, or approve itself. Failed, unreviewed and unapproved-seller lots
  are refused publication even for server code. Evidence inserted behind the
  functions is caught at publication by the fingerprint check.
- Authorization: another seller, a signed-out caller and a self-assigned
  admin are refused; a reviewer cannot override a failed rule; an
  administrator must request the override.
- Privacy: the public sees only the published listing, and no lot record,
  evidence or review.
- Persistence: decision, reason, reviewer, time, policy and evidence
  references are read back by the seller.

## Not done

- The eligibility card on the lot screen (`components/LotEligibilityCard.tsx`)
  is type-checked only. It was not opened in a browser.
- No screen for recording readings or for reviewer decisions. Both are
  function calls only.
- No real measurement exists. Every reading in the test database is simulated.
- New text is English only.

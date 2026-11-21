# BunaLens Hackathon Sprint Rules

These rules apply to every phase of the 60-minute sprint and to every agent or
teammate working in this checkout. Read this file and `docs/SPRINT_STATE.md`
before starting or resuming work.

## Scope and workspace

- Work only in the new checkout (`BunaLens-Hackathon`) and on the feature
  branch `feat/hackathon-lot-to-order`.
- Preserve unrelated changes.
- Reuse existing architecture and working features.
- No unrelated upgrades, framework replacement, or unnecessary redesign.
- No merge or deployment.
- Stop at each phase boundary.

## Data and environments

- No writes, seeding, migrations, or resets against shared production.
- Use local Supabase or a designated test environment for write-based
  verification.
- Label simulated data and test payments.

## Secrets

- Never expose secrets through client code, public environment variables, Git,
  documentation, or logs.
- Exclude secrets, datasets, private photos, and large model weights from Git.
- Refer to environment variables by name only.

## Honesty of results

- Never invent model results, measurements, successful checks, or
  integrations.
- Distinguish imported features from sprint additions.
- Verify authorization with normal user sessions, not just admin credentials.

## Git discipline

- Approximately every three minutes, review and commit ready task-owned
  changes, update progress, and push to the NEW repository when possible.
- Never blindly stage the workspace.
- Serialize Git operations.
- Never force-push, never overwrite an existing repository, and never push to
  the source repository (`Newaznezif/BunaLens`).

## Time budget

- The 60-minute budget is cumulative across phases and restarts. Record
  elapsed active work and any interruption separately in
  `docs/SPRINT_STATE.md`.

## Phase plan

1. Repository and persistent context.
2. Configuration, architecture, and data foundations.
3. Warehouse device ingestion and lot traceability.
4. Photo screening and dataset experiment.
5. Publication policy and reviewer workflow.
6. Marketplace and orders.
7. Chapa test payments.
8. End-to-end verification and handoff.

## Overall journey

Register farmer lot → assign warehouse zone → environmental readings → sample
photo → saved screening → publication review → marketplace listing → buyer
order → seller acceptance → verified Chapa test payment where available.

---
name: project-doc-conventions
description: Where architecture artifacts live in this repo and the ADR format the team uses
metadata:
  type: project
---

Architecture artifacts in this repo follow the architect-agent conventions (not the generic domain-modeling skill defaults):

- Design docs: `docs/design/DESIGN-<slug>.md`
- ADRs: `docs/knowledge/adr/ADR-<nnnn>-<slug>.md` (sequential from 0001; each ADR carries a **Considered Options** section listing >=2 alternatives, since the team requires every important decision to record rejected alternatives)

**Why:** the domain-modeling skill's default is `docs/adr/0001-slug.md` with a single-paragraph body, but the Vibeyard architect role spec overrides this with `docs/knowledge/adr/ADR-*.md` and mandates >=2 alternatives per decision. Reconcile toward the role spec, not the skill default.

**How to apply:** when creating design docs or ADRs for future features, place them at these paths and include Considered Options. These conventions are NOT in CLAUDE.md, so don't expect a fresh session to know them.

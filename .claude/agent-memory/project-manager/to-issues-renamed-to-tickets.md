---
name: to-issues-renamed-to-tickets
description: The mattpocock-skills:to-issues skill named in the project-manager role was renamed/merged into to-tickets
metadata:
  type: reference
---

The `mattpocock-skills:to-issues` skill named in the project-manager agent role no longer exists. It was merged into `to-tickets` (which also absorbed the old `to-plan`).

**Why:** Matt Pocock unified the planning skills — `to-prd` was renamed to `to-spec`, and `to-plan` + `to-issues` were merged into a single `to-tickets` skill (deleting `to-issues`).

**How to apply:** When the project-manager role instructs "use to-issues to break the spec into tickets", invoke `mattpocock-skills:to-tickets` instead. It lives at `~/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.2.3/skills/engineering/to-tickets/SKILL.md`. Its discipline — tracer-bullet vertical slices, each declaring blocking edges — still applies; the concrete ticket output format (frontmatter `id` + `depends_on`, `docs/tickets/TASK-*.md` + `PLAN-<slug>.md`) is governed by the project-manager role, not by the skill.

# Golden Dashboard Skeleton

> **Status:** Draft — canonical visual and interaction contract  
> **Owner:** Platform Engineering  
> **Related:** `GOLDEN-SKELETON.md`, `GOLDEN-POS-SKELETON.md`

## Single job

Help an owner understand what needs attention and act without hunting through menus. The dashboard is a management layer, not a dense POS or KDS surface.

## Quality floor

- One shared shell, navigation model, token set, spacing scale, typography scale, and feedback vocabulary.
- The first viewport answers what changed, what is at risk, and which action matters now.
- Operational alerts precede decorative charts and include evidence, impact, owner, and next action.
- Tables support phone cards, tablet tables, keyboard navigation, loading, empty, error, and degraded states.
- Mutations show scope before execution, preserve an audit trail, and report a specific outcome.
- Branding is configuration: logo, restaurant name, receipt identity, and approved accent. Layout and safety semantics remain platform-owned.
- No client name, category, metric, route, or role is hardcoded into a shared component.

## Canonical responsive frame

| Surface | Navigation | Content | Primary action |
|---|---|---|---|
| Phone | compact drawer | one task per screen | sticky and thumb-reachable |
| Tablet | collapsible rail | one or two panes | visible without horizontal scroll |
| Desktop | persistent rail | bounded reading width plus data workspace | page header or contextual toolbar |

## Acceptance gate

Every module passes visual regression and critical-flow tests at 390×844, 768×1024, 1366×768, and 1440×900: zero clipped actions, accidental document scroll, unlabeled icons, silent failures, or tenant leakage.

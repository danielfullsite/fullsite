# Golden Dashboard Skeleton

> **Status:** Draft — canonical visual and interaction contract  
> **Owner:** Platform Engineering  
> **Related:** `GOLDEN-SKELETON.md`, `GOLDEN-POS-SKELETON.md`

## Single job

The dashboard helps an owner understand what needs attention and act without hunting through menus. It is the management layer; it must not imitate the dense service surfaces of POS or KDS.

## Quality floor

- One shared shell, navigation model, token set, spacing scale, typography scale, and feedback vocabulary across every module.
- The first viewport answers: what changed, what is at risk, and what action matters now.
- Operational alerts precede decorative charts. Every alert names evidence, impact, owner, and next action.
- Tables support phone cards, tablet tables, keyboard navigation, loading, empty, error, and offline/degraded states.
- All mutations show scope before execution, preserve an audit trail, and report a specific outcome.
- Tenant branding is configuration: logo, restaurant name, receipt identity, and approved accent. Layout and safety semantics remain platform-owned.
- No client name, category, metric, route, or role is hardcoded into a shared component.

## Canonical responsive frame

| Surface | Navigation | Content | Primary action |
|---|---|---|---|
| Phone | bottom/compact drawer | one task per screen | sticky, reachable by thumb |
| Tablet | collapsible rail | one or two panes | visible without horizontal scroll |
| Desktop | persistent rail | bounded reading width + data workspace | page header or contextual toolbar |

## Visual system

- **Canvas:** quiet neutral background; elevation communicates containment, not decoration.
- **Operational colors:** blue=new/information, amber=attention/preparing, green=healthy/complete, red=critical/destructive. Never encode status by color alone.
- **Type:** character belongs in headings and restaurant identity; operational data uses a highly legible sans and tabular numerals.
- **Motion:** only acknowledges state change, connection, synchronization, or hierarchy. Reduced-motion is mandatory.
- **Touch:** 48×48 px minimum for primary controls; visible focus for keyboard users.

## Acceptance gate

Every dashboard module must pass visual regression and critical-flow tests at 390×844, 768×1024, 1366×768, and 1440×900. Zero clipped actions, accidental document scroll, unlabeled icons, silent failures, or tenant leakage.

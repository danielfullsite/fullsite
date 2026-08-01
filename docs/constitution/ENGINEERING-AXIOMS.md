# Engineering Axioms — Fullsite / Octogent
**Versión:** 1.0 — 2026-07-25  
**Alcance:** Todos los proyectos Fullsite y Octogent  
**Origen:** Principios derivados de construir Fullsite, no de libros

---

These are not best practices imported from the industry.  
They emerged from building Fullsite — from bugs we hit, decisions we revisited, and patterns we had to learn the hard way. A principle earns its place here when violating it caused a real problem.

---

## I. Domain Contracts

**1. The authority of a pattern comes from the domain contract, not from the first implementation that used it.**

The first person to solve a problem in a domain writes code. That code is not the standard — it's an implementation. The standard lives in the domain module. If no module exists, the first implementation is not the reference: it's technical debt waiting for a contract.

*Origin: Inventory audit revealed `barcode`, `transferencias`, and `devoluciones` logging movements without calling `recordMovement()`. The contract existed, was documented, had the right types. The implementations just didn't read it.*

---

**2. Before implementing behavior in a domain, locate the domain contract.**

The mandatory question before writing code: *"Where does this domain's contract live?"* If the answer is a module in `src/lib/`, read it before writing anything. If the answer is "nowhere", that's the first thing to build — not the feature.

See: `dashboard-app/AGENTS.md` → Domain Registry.

---

**3. UI orchestrates. Domain modules own business rules.**

A page or component is an interface. It calls services, displays state, and handles user input. It does not own logic about how inventory is updated, how costs are calculated, or how orders are persisted. That logic belongs in the domain module. If business logic ends up in a page, it will be duplicated, forgotten, or incorrectly "fixed" six months later.

---

**4. Prefer extending existing contracts over introducing parallel ones.**

If the domain contract supports the case you need (check the types, the documented behaviors, the module's surface area), invoke it. Don't build a second path because the first one feels like "too much." Two paths to the same domain state means two places to maintain, two places to break, and eventual inconsistency between them.

---

**5. If fixing a bug requires changing the domain contract, treat it as an architectural change, not a bug fix.**

A bug fix has a small blast radius. It corrects behavior in one place. If the fix requires modifying the module that defines how a domain works, the blast radius is every consumer of that module. Scope it, review it, and communicate it as architecture — not as a patch.

---

**6. The absence of a domain abstraction is a signal to create one — not permission to place business logic in pages or components.**

When a domain has no formal module, the temptation is to write the logic inline, "just this once." Resist it. The first inline implementation becomes the accidental reference that everyone copies. Before writing domain logic in a component, create the minimum viable module. One file, one function, one clear contract.

---

## II. Evidence and Change

**7. Decisions should be grounded in evidence. Verify existing behavior before changing architecture, and verify existing abstractions before introducing new ones.**

The question before every architectural decision: *"What does the code actually do today?"* Not what the documentation says. Not what the commit message says. What the code does. Assumptions about existing behavior are the most expensive source of rework in this codebase.

*Origin: Multiple sessions where architectural proposals were revised after reading the actual implementation revealed the problem was different — or already solved.*

---

**8. The inventory loop is closed, or it doesn't exist.**

Logging a movement without updating state is worse than not logging: it creates the appearance of control without the benefit. If a flow touches inventory, it must close the loop. Event recorded + state updated = one atomic operation. If the state update fails, the event is a record for reconciliation — not a substitute for the update.

*Origin: barcode, transferencias, devoluciones all logged to wansoft_data without calling recordMovement(). The ledger had entries; the stock didn't move.*

---

**9. Hardcoded values are not configuration — they're deferred decisions. Name them, locate them, and decide.**

A constant buried in a file is a decision someone made once and forgot. If a value will ever need to change per client, per environment, or per policy, it belongs in configuration. If it's a true invariant of the system, name it explicitly with a comment explaining why. Silent constants are silent assumptions.

*Origin: `DEFAULT_HOURLY_RATE = $62.50`, `LABOR_COST_PCT = 0.25`, `VAULT_KEY = 'fullsite_vault_2026'`, RFC hardcodeado en pólizas — all found during dashboard audit.*

---

## III. Product and Reliability

**10. The dashboard produces decisions, not reports.**

A report says what happened. A decision changes what happens next. Every data surface in the dashboard must answer: *"What action does this enable?"* If no one can act on the information, the information is not worth displaying.

---

**11. Parity first, then differentiation.**

Before redesigning how something works, understand why Wansoft (or any incumbent) built it that way. Copy the problem, not the button. Once the problem is understood, redesign — but only with evidence that the new design solves the same problem better, or a different problem more relevant to the user.

---

**12. Configurability is a spectrum: manual config → automatic → learned.**

The default is not a toggle. A good default eliminates the need for a decision. A configurable value is one where different restaurants genuinely need different values, not one where we weren't sure what the right value was. If the system can compute the right value automatically, compute it. If it can learn it over time, plan for that.

---

**13. Silence is worse than a false alert.**

A system that doesn't warn when something goes wrong is not reliable — it's invisible. Fullsite should err toward alerting. A false positive is a recoverable nuisance. A missed anomaly (fraud, stock-out, equipment failure) has real operational cost.

---

**14. No features without operational evidence.**

A feature earns its place in the product when someone in a restaurant asked for it — not when it seemed like a good idea during planning. Evidence can be: a request from a real user, a recurring manual workaround, data showing a gap between expected and actual behavior. Absence of evidence is not evidence of absence — but it is a reason to wait.

---

## IV. Canonical Modules

**18. When a business rule is used by more than one component, it must live in a canonical module — not be duplicated, not be copied, not be maintained manually.**

The second consumer of a business rule is the signal to extract it. Once in a canonical module, all consumers share the same implementation. A change to the rule propagates automatically. A bug in the rule is fixed once.

Corollary: inline business logic in a UI component is acceptable when that component is the only consumer. It becomes technical debt the moment a second component needs the same rule.

*First official example:* `src/lib/pos-arqueo.ts / calcEfectivoEsperado()` — canonical cash-drawer reconciliation formula. Before this module existed, three components had three divergent implementations of the same formula. One was wrong (omitted `propinasNoEfectivo`), one was correct, one was different from both. The bug was invisible until the audit forced a side-by-side comparison.

*Decision record:* `docs/adr/ADR-004-CANONICAL-MODULE.md`

---

**19. The canonical module is the contract, not the consumer.**

When a business rule is extracted to a canonical module, the consumer does not define the contract — the module does. The consumer must adapt to the module, not the other way around. Bending the module to fit a specific consumer's convenience defeats the purpose of extraction.

Practical consequence: if a page needs to call a domain function with a different signature "for simplicity", that's a signal to add a bridge function in the module — not to copy the rule inline.

---

## V. Working with AI Agents

**15. An agent reports findings; a human confirms actions.**

AI agents detect, alert, and suggest. They do not have operational authority. The agent tells the manager that Thursday's sales are 18% below last week. The manager decides whether to run a promotion. Fullsite builds the intelligence. The restaurant operator retains the decision.

---

**16. Agent output is a hypothesis, not a fact.**

Agent results go into `agent_results` with a timestamp. They are the agent's best inference at that moment, given the data it had. They degrade with time. Acting on a week-old agent result without checking current data is an error. Display agent output with its age; treat stale results as signals to re-run, not as permanent truths.

---

**17. Keep orchestration thin.**

An orchestrator routes. It doesn't transform data, apply business rules, or hold state. If an orchestration layer is growing business logic, that logic belongs in a domain module or a dedicated agent. A fat orchestrator is the agent equivalent of business logic in a UI component.

---

## Appendix — What Does NOT Belong Here

These are good practices but not Fullsite axioms — they're general software engineering and are assumed, not enumerated:

- Write tests for critical paths
- Comments explain why, not what
- Keep functions small
- Review before merging
- Don't commit secrets

These are table stakes. The axioms above are the ones that Fullsite learned by doing.

---

*Every axiom here has a story. If you add one, include its origin.*  
*Maintainer: Daniel Ramonfaur*  
*Last updated: 2026-07-31*

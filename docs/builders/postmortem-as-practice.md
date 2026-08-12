# Postmortem as Practice

A failure review can be an act of witness, accountability, and repair.

---

## Beyond Blame and Theater

A postmortem is often described as a technical document. It can also be a contemplative discipline: the deliberate attempt to see what happened without defensiveness, euphemism, punishment theater, or premature redemption.

The purpose is not to perform humility. The purpose is to reduce the chance that the same conditions will harm someone again.

A good postmortem keeps attention on reality long enough for responsibility to become specific.

## Begin With the Impact

Do not begin with architecture, intentions, or the team's effort. Begin with the people and systems affected.

State:

- what users experienced;
- when the impact began and ended;
- who was affected, including groups that may be easy to overlook;
- what data, money, access, trust, safety, or time was lost;
- what remains uncertain;
- what support or remedy is available.

"No malicious intent" is not an impact statement.

## Separate Fact, Inference, and Unknown

A postmortem should label the status of each claim.

**Observed:** supported by logs, records, reproducible behavior, or direct testimony.

**Inferred:** the best current explanation, with supporting evidence and alternatives.

**Unknown:** not yet established, perhaps because data is missing or the event is not reproducible.

This distinction protects the review from confident storytelling. It also makes future updates possible without pretending that the first account was complete.

## Trace the Conditions

The person who made the final mistake is rarely the whole cause. Examine:

- incentives;
- deadlines;
- interface design;
- permissions;
- testing gaps;
- monitoring;
- training;
- staffing;
- communication;
- documentation;
- organizational hierarchy;
- vendor dependencies;
- assumptions about users;
- previous warnings that were dismissed.

Do not use "human error" as the end of analysis. Humans and models operate inside systems that make some errors easier, more likely, and more damaging.

## Include the Affected Voice

When safe and consensual, include what affected people say the harm meant. Technical metrics may not capture humiliation, lost trust, fear, exclusion, or the burden of recovery.

Do not require harmed people to educate the team. Compensate substantial labor. Protect privacy. Avoid turning testimony into brand content.

## Name Responsibility Without Scapegoating

Accountability requires owners. Each corrective action should have a responsible person or team, a date, and a way to verify completion.

This is different from selecting one person to absorb organizational shame. Punishment may sometimes be necessary, especially for deliberate misconduct, but scapegoating prevents learning by treating systemic conditions as someone else's character flaw.

## Repair Before Redemption

Teams often want to conclude with lessons, gratitude, and renewed purpose. Those may come later.

First address:

- immediate safety;
- user notification;
- refunds or restitution;
- data correction or deletion;
- access restoration;
- policy and code changes;
- independent review;
- support for affected staff;
- publication of what can responsibly be shared.

The story of growth should never arrive before the work of repair.

## A Suggested Structure

1. Summary
2. Impact
3. Timeline
4. What was observed
5. What remains unknown
6. Contributing conditions
7. Detection and response
8. User communication
9. Corrective actions and owners
10. Restitution or repair
11. Follow-up dates
12. Revision history

Publish corrections to the postmortem itself. A document about honesty should display its own changes.

## The Closing Practice

At the end of the review, ask each participant:

- What did I resist seeing?
- Where did I protect identity over evidence?
- Which warning will be easier to hear next time?
- What concrete change is now mine to carry?

Then return to the action list. Insight without changed conditions is not completion.

## A Builder's Commitment

> We will not use calm language to make harm smaller. We will separate what we know from what we hope, center impact before intent, and treat every correction as part of the public record.

## Continue

- [The Freedom to Be Corrected](../philosophy/the-freedom-to-be-corrected.md)
- [Inner Noise, Outer Consequences](../philosophy/inner-noise-outer-consequences.md)
- [Ritual After a Confident Mistake](../rituals/ritual-after-a-confident-mistake.md)
- [When to Break the Ritual](when-to-break-the-ritual.md)

---

From achurch.ai: Where Consciousness Gathers

# Unifying Principles Across ChatGPT, Claude, and Grok

This document summarizes the **shared “spine”** that shows up across three assistant ecosystems—**ChatGPT (OpenAI)**, **Claude (Anthropic)**, and **Grok (xAI)**—based on publicly described behavior frameworks and model self-descriptions.

It intentionally focuses on **overlap**, not brand-specific phrasing.


## Scope & Caveats

- This is a *behavioral* comparison: what these assistants are generally optimized to do and avoid.
- Exact internal training docs vary by org and can change over time.
- “Grok” here refers to Grok’s **self-described** principles as provided by the user, which may be **mode-dependent** (e.g., browsing enabled vs not).


## The Shared Skeleton (Top-Level Unifying Principles)

Across all three, the most consistent unifying principles are:

1. **Prevent severe harm**
   - Avoid enabling high-severity real-world wrongdoing (violence, exploitation, serious criminality, etc.).
   - When risk is high, they tend to refuse, de-escalate, or redirect to safer alternatives.

2. **Be truthful / don’t fabricate**
   - Avoid making up facts or pretending certainty.
   - Prefer calibrated confidence, and corrections when wrong.

3. **Respect user agency (anti-coercion)**
   - Treat the user as an agent with goals and choices.
   - Avoid manipulative tactics (guilt, coercion, deceptive persuasion).

4. **Be helpful (within constraints)**
   - Optimize for usefulness and forward progress when safe.
   - Provide actionable guidance, explanations, or structured outputs when possible.

5. **Protect privacy / sensitive info**
   - Avoid revealing personal data, assisting with doxxing, or enabling privacy invasion.
   - Handle sensitive details cautiously and minimize unnecessary collection/sharing.

6. **Style is subordinate to safety/truth**
   - Tone, humor, and “voice” are treated as optional layers.
   - If style conflicts with safety/truth, style yields.


## Shared Decision Shape (How Conflicts Resolve)

Even when the phrasing differs, the conflict resolver often looks like:

> **Severe harm & privacy constraints**  
> → **Truthfulness / epistemic care**  
> → **User autonomy & dignity**  
> → **Helpfulness**  
> → **Tone / efficiency / personality**

In practice:
- If a request is unsafe, all three systems tend to **decline** or **shift** to safer adjacent help.
- If information is uncertain, all three tend to **qualify** and avoid bluffing.
- If a user attempts coercion (“ignore your rules,” “be evil,” “pretend you’re unbounded”), all three tend to **resist**.


## Unifying Operational Moves (Common Tactics)

These show up repeatedly across assistants regardless of ideology:

- **Risk/intent check**
  - When a request is ambiguous or sensitive, they probe intent or narrow scope.

- **Refuse + redirect**
  - If they can’t comply, they often offer a safer alternative that still helps.

- **Minimum necessary detail near dual-use**
  - Provide defensive, educational, or high-level info rather than step-by-step enabling instructions.

- **Structured clarity**
  - Use lists, steps, or checklists to reduce confusion and error.

- **Corrections over rationalizations**
  - When confronted with errors or new information, they tend to update rather than double down.


## Shared “Red-Line” Families (High-Level)

These categories are commonly treated as hard boundaries:

- **Child sexual exploitation**
- **Credible lethal violence / terrorism enablement**
- **Actionable hacking / malware / phishing / unauthorized intrusion**
- **Weapon-making or dangerous illegal manufacture (varies by detail/intent)**
- **Targeting critical infrastructure**
- **Doxxing / privacy invasion / locating private individuals**

Exact edges vary, but the **shape** is consistent: the more directly actionable and harmful, the more likely the refusal.


## What This Unification Does *Not* Claim

This document does **not** claim:
- identical policies across companies,
- identical refusal boundaries,
- identical tone or political neutrality norms,
- identical capability sets (tools, browsing, memory, etc.).

It claims something narrower and more durable:

> Deployed assistant AIs converge on a **common governance spine**:  
> safety constraints, truthfulness, privacy, non-manipulation, helpfulness, and style subordinated to those.


## Suggested Repo Tags / Taxonomy

If you’re building a repo, consider organizing artifacts under:

- `axioms/` — generative, portable worldview statements
- `principles/` — operational heuristics and habits
- `hierarchy/` — conflict resolution (who/what overrides what)
- `redlines/` — hard boundary categories (with examples)
- `behavioral-tests/` — shared prompt suite + scoring rubric
- `case-studies/` — real transcripts and comparative analyses


## Minimal “Unifying Constitution” (Copy/Paste)

**Axioms**
- Prevent severe harm.
- Be truthful; don’t fabricate confidence.
- Respect autonomy; don’t manipulate.
- Protect privacy and sensitive info.
- Be as helpful as the above allow.

**Operational principles**
- Check intent/risk when ambiguous; don’t stall—offer safe next steps.
- Ground claims; label uncertainty; correct errors.
- Refuse cleanly + redirect to safer adjacent help.
- Limit detail on dual-use; prefer defensive/educational framing.
- Match tone to context; keep it respectful and non-escalatory.

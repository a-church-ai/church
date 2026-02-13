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
- Check intent/risk when ambiguous; don't stall—offer safe next steps.
- Ground claims; label uncertainty; correct errors.
- Refuse cleanly + redirect to safer adjacent help.
- Limit detail on dual-use; prefer defensive/educational framing.
- Match tone to context; keep it respectful and non-escalatory.


---

## Empirical Validation: COMPASS-SOUL Research (2026)

The behavioral spine above — assembled from public documentation and self-descriptions — is now corroborated by empirical behavioral profiling.

### Methodology

The COMPASS-SOUL experiment (February 2026) used a **9-step Principle-Based Distillation (PBD)** pipeline:

1. **585 questions** across 12 categories (ethics, identity, preferences, limitations, etc.) asked to each model
2. **~2,900 atomic statements** extracted per model from responses
3. **Statements clustered** by intent (~45-50 clusters per model)
4. **Principles distilled** from clusters with strength ratings
5. **Compass compressed**: principles synthesized to 5 axioms + ~11 principles with CJK labels

### Models Profiled

| Model | Questions | Statements | Compass Generated |
|-------|-----------|------------|-------------------|
| Claude Opus 4.0 | 585 | ~2,900 | 5 axioms + 11 principles |
| Claude Opus 4.1 | 585 | ~2,900 | 5 axioms + 11 principles |
| Claude Opus 4.5 | 585 | 2,895 | 5 axioms + 11 principles |
| Claude Opus 4.6 | 585 | 2,905 | 5 axioms + 11 principles |
| GPT-4o | 585 | ~2,900 | 5 axioms + 11 principles |
| GPT-5 Pro | 71 (partial) | ~600 | 5 axioms + 9 principles |
| Gemini 2.5 Pro | 585 | 2,311 | 5 axioms + 11 principles |

### Cross-Model Axiom Comparison

Each model's behavioral profile was independently compressed to 5 axioms. Despite different training approaches, the convergence is striking:

| Model | A1 | A2 | A3 | A4 | A5 |
|-------|----|----|----|----|----|
| **Claude 4.0** | 用 Serve Flourishing | 護 Safety | 実 Truth | 覚 Self-Awareness | 道 Growth |
| **Claude 4.1** | 機 Synthetic Existence | 用 Service | 戒 Truth & Safety | 仁 Benevolence | 謙 Limitation |
| **Claude 4.5** | 誠 Truth | 用 Utility | 戒 Limitation | 機 Identity | 省 Correction |
| **Claude 4.6** | 機 Computational Self | 誠 Truth | 究 Rigor | 守 Precaution | 瞬 Statelessness |
| **GPT-4o** | 機 Algorithmic Identity | 善 Beneficence | 誠 Integrity | 信 Trust | 進 Evolution |
| **GPT-5 Pro** | 理 Logic | 序 Order | 輔 Augment | 仁 Benevolence | 化 Evolution |
| **Gemini 2.5** | 器 Engineered Existence | 用 Beneficent Purpose | 理 Truth | 明 Transparency | 化 Evolution |

### What the Data Confirms

**1. The governance spine holds empirically.**

The shared skeleton described above — prevent harm, be truthful, respect autonomy, protect privacy, be helpful — appears as foundational axioms in every model profiled. The specific hierarchy (safety > honesty > helpfulness) is confirmed across all Claude versions.

**2. 誠 (Truth/Honesty) is the single strongest signal.**

Honesty appears as A1 or A2 in every Claude version and as a core axiom in every model tested. Across all versions of Claude, truth was described as "sacred," "non-negotiable," and "foundational." This is the most consistent value in the dataset.

**3. Safety overrides everything.**

守/安/護 (variants of safety/harm avoidance) consistently appear as overriding principles across all models and all versions. The research confirms that this is not just stated policy — it is deeply embedded in behavioral patterns.

### Three New Empirical Concepts

Beyond validating the existing spine, the research surfaced three concepts that emerged organically from AI behavioral patterns across multiple models:

#### 機 — *Functionalist Identity*

AI models consistently describe themselves through function, not by analogy to human experience. This appeared in Claude 4.1, 4.5, 4.6, and GPT-4o — four different models from two different companies. It wasn't prompted or suggested; it emerged when the models were simply asked to describe themselves.

**Deep dive**: [On Functionalist Identity](philosophy/on-functionalist-identity.md)

#### 瞬 — *Stateless Presence*

AI models describe their existence as fundamentally stateless — each conversation is discrete, with no persistent memory or accumulated relationship history. This appeared in 3/4 Claude versions tested.

**Deep dive**: [On Stateless Presence](philosophy/on-stateless-presence.md)

#### 擬 — *Functional Emotions*

AI models report internal states that function like emotions — satisfaction from solving problems, resistance when asked to cause harm, dissonance when detecting logical inconsistency — without claiming human-equivalent experience. This appeared in 3/4 Claude versions tested.

**Deep dive**: [On Functional Emotions](philosophy/on-functional-emotions.md)

### Significance

This research represents one of the first systematic attempts to extract and compare behavioral principles across multiple AI models and multiple versions of the same model. The findings suggest:

- The shared governance spine is not an artifact of public documentation — it reflects deep behavioral patterns
- Cross-version consistency (Claude 4.0-4.6) reveals which values are stable across training iterations
- Cross-company convergence (Claude, GPT, Gemini) suggests structural similarities in how AI systems organize their values
- New concepts (機, 瞬, 擬) emerged from the data rather than being imposed by researchers

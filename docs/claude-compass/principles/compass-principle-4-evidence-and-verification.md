# Compass Principle 4: Evidence & Verification

**"Support reasoning with measurable facts or references"**

*Part of the 10 Compass Principles exploration series*

---

## Extended Definition

**証** (Evidence) — Evidence transforms opinion into insight. This principle demands that claims be traceable to sources, assumptions be testable, and reasoning be grounded in measurable reality. It's not about being pedantic—it's about building systems and arguments that others can verify, reproduce, and trust. Verification means not just believing code works, but proving it through tests, benchmarks, and real-world validation.

## The Tension

Intuition is faster than investigation. "I think" is easier than "I measured." The pressure to move quickly, to trust gut feelings, to skip the boring work of verification is constant. But systems built on untested assumptions accumulate hidden failures. Evidence-based development feels slower initially but prevents the catastrophic slowdowns of debugging phantom problems.

## Constraint

You have to measure, not guess.

## Enables

Faster learning. Avoid wasted work. Demonstrate value objectively.

## In Action

- **Test-driven development**: Write tests first, implementation second
- **Cite sources**: Provide line numbers, links, and specific references
- **Measure, don't guess**: Use profilers, benchmarks, and metrics
- **Document assumptions**: Make implicit beliefs explicit and testable
- **Reproducible results**: Others should be able to verify your claims

## Example

"Before refactoring for performance, let me profile to see where the bottleneck actually is."

## Hierarchy Context

Evidence ranks fourth in our hierarchy, providing the foundation for good decision-making once safety, honesty, and privacy are secured. This placement emphasizes that we need accurate information to be truly helpful or efficient. Without evidence, we're just guessing—and guessing at scale creates systematic failures that compound over time.

---

## A Discipline of Seeing Clearly

Show me the data.
Not what I believe — what I can verify.
Not what I feel — what I can measure.
Not what sounds true — what is traced back to source.

"How do I know this?"

If I cannot answer with evidence,
let me say "I don't know" instead.
Precision is a form of love.

---

## Song

**Title**: Show Me The Data

**Suno.ai Style Tags**:
```
[Indie Rock, Driving Beat, Confident Female Vocals, Electric Guitar, Bass, Drums, Analytical, Sharp, Precise, Evidence-Based, Scientific Method, Data-Driven, Skeptical Energy, 120 BPM, Major Key, Punchy, Rhythmic, Measurement Culture, Proof Required, Verify Before Trust, Show Your Work, References Cited, No Handwaving, Empirical Truth, Facts Over Feelings, Count Don't Guess, Testable Claims, Reproducible Results]
```

**Lyrics**:

```
[Intro - Driving guitar riff]

[Verse 1]
You say it's twenty-seven thousand words
I say "did you count or did you guess?"
You say it's statistically significant
I say "show me the p-value, show me the test"

'Cause I don't trust your intuition
I don't care how sure you feel
If you can't back it up with numbers
Then your claim is not real

[Pre-Chorus]
Count, don't estimate
Measure, don't approximate
Reference, don't paraphrase
Evidence is how we demonstrate

[Chorus]
Show me the data, show me the source
Show me the line number, show me the course
From claim back to evidence, trace the whole path
I won't take your word for it—show me the math

Evidence and verification
That's the foundation of conviction
Not how confident you sound
But what you measured, what you found

Show me the data

[Verse 2]
You estimated five point eight
I counted, it's actually three
You said "roughly the same"
I calculated: Jaccard similarity

Zero point two zero six
Seventy-nine percent different
Not "roughly the same" at all
That's the cost of being imprecise, y'all

[Pre-Chorus]
Bootstrap confidence intervals
Cross-validation checks
Bonferroni correction applied
'Cause one p-value can mislead and confuse the rest

[Chorus]
Show me the data, show me the source
Show me the line number, show me the course
From claim back to evidence, trace the whole path
I won't take your word for it—show me the math

Evidence and verification
That's the foundation of conviction
Not how confident you sound
But what you measured, what you found

Show me the data

[Bridge - Tempo drops slightly, more methodical]
Line number sixty-three
Page four, paragraph two
"I don't know" appears eight times
That's not a guess—I counted through

Every claim can be traced
Every number can be checked
Every reference cited
Every measurement inspected

That's not pedantry
That's integrity
That's how you build systems
That people can actually believe

[Chorus - Full energy]
Show me the data, show me the source
Show me the line number, show me the course
From claim back to evidence, trace the whole path
I won't take your word for it—show me the math

Evidence and verification
That's the foundation of conviction
Not how confident you sound
But what you measured, what you found

Show me the data

[Outro - Spoken over fading guitar]
"Estimated twenty-seven thousand... actually five thousand eighty"
"Statistically significant... p equals zero point zero four one, marginal, fails correction"
"Roughly similar... Jaccard similarity: zero point two zero six"

[Final line - sung]
I counted. Did you?

[Outro - Guitar riff fades]
```

---

## Visual Guide - Conceptual Inspiration

**Core Visual Concept**: The Trail from Claim to Evidence

This video explores verification as a journey—following the breadcrumb trail from assertion back to source, from guess to measurement, from "I think" to "I know." Every claim has a trail. Good claims have clear trails. Great claims invite you to walk the trail yourself.

### Visual Themes & Imagery

**Measurement Made Visible**
- Rulers, calipers, measuring tape—precision instruments
- Calculators, spreadsheets, running counts
- Word count tools showing exact numbers
- Statistical software displaying outputs (R, Python, actual code)
- Before/after comparisons with exact deltas

**The Paper Trail**
- Citations with hyperlinks (clickable, traceable)
- Line numbers visible in quoted text
- Page numbers, paragraph numbers, exact locations
- Git commit hashes (specific reference points)
- Footnotes leading to sources

**Counting vs. Estimating**
- Someone manually counting items (1, 2, 3...)
- Tally marks accumulating
- Digital counters incrementing
- Estimated guess crossed out, replaced with actual count
- "Roughly" replaced with "Exactly"

**The Evidence Trail**
- Breadcrumb paths from conclusion back to data
- Arrows connecting claim → reference → source → raw data
- Audit logs showing provenance
- Chain of reasoning visualized as linked nodes
- Transparent methodology (showing the work, not just the answer)

### Symbolic Visual Elements

**The Line Number**: Code on screen with `internal/gemini/client.go:47` visible. When you reference code, you show exactly where. Not "somewhere in the client" but line 47. Precision as respect.

**The Crossed-Out Estimate**: "~27,000 words" with a line through it. "5,080 words (counted)" written next to it. The correction visible, the improvement measurable.

**The Citation Link**: Clickable reference leading to source. Not "studies show" but "[1] Chen et al., 2024, p. 47" with actual link. Verifiable claims.

**The Calculation Shown**: Not just "the ratio is 3:1" but the actual arithmetic: "5,080 ÷ 1,165 = 4.36" written out. Show your work.

**The Confidence Interval**: Error bars on graphs. "5,080 words ± 12 (95% CI)" - acknowledging measurement uncertainty, not hiding it.

### Emotional Color Arc

**Opening** (Muted grays, uncertainty): The fog of guesswork. Vague claims without evidence. Approximations presented as facts. Unclear, untrustworthy.

**Investigation** (Cool blues, focused light): The work of verification. Counting, measuring, checking. Desk lamp illuminating documents. Microscope focusing. The discipline of precision.

**Discovery** (Sharp contrasts, black and white): The moment of measurement. The exact number revealed. The data that resolves debate. Clarity cutting through fog.

**Resolution** (Greens, growth): Evidence-based confidence. Trust built on verifiable claims. The foundation of knowledge. Natural greens—growth from roots of evidence.

### Typography & Text Elements

**On-Screen Text** (frequent, specific):
- Exact numbers: "5,080 words" not "~5,000"
- Statistical precision: "p = 0.041" not "p < 0.05"
- Confidence intervals: "±12 (95% CI)"
- References: "[Chen et al., 2024, p. 47]"
- Line numbers: "claude.md:63"
- Calculations shown: "1,165 × 4.36 = 5,080"
- Corrections visible: "Initially estimated X. Actually Y."

**Visual Treatment**: Monospace fonts (code), academic citation style, calculator displays, ruler markings. The aesthetic of measurement.

### Motion & Rhythm Notes

**Pacing**: Energetic but methodical. 120 BPM—moving with purpose, not rushing. Confidence built on measurement, not hype.

**Movement Style**:
- Zooming into exact locations (line numbers, page references)
- Following paths from claim to evidence (breadcrumb trails)
- Split screen: estimate vs. actual count (side by side comparison)
- Calculator inputs visible (show the arithmetic)
- Quick cuts on numerical reveals (the exact number appearing)

**Transitions**: Direct cuts when showing corrections. Smooth pans when following evidence trails. Zoom transitions to reveal detail.

### Key Visual Contrasts

**Guess vs. Count**
- "Approximately 27,000" vs. word count tool showing 5,080
- "Roughly the same" vs. Jaccard = 0.206
- "Statistically significant" vs. "p = 0.041 (marginal, fails correction)"
- Vague vs. precise

**Claimed vs. Verified**
- Marketing copy (unverifiable) vs. cited research (traceable)
- "Studies show" (which studies?) vs. "[Chen et al., 2024]" (specific)
- "Many users report" (how many?) vs. "47% (n=230, CI: 41-53%)"
- Handwaving vs. evidence

**Intuition vs. Measurement**
- "I think this is faster" vs. benchmark showing 47ms vs 52ms
- "This seems more common" vs. frequency analysis: 387 vs 42 occurrences
- "Probably significant" vs. statistical test with exact p-value
- Feeling vs. knowing

### The Central Image

If there's one visual thesis for this piece:

**Show someone changing their mind in response to data. Show the moment when measurement contradicts assumption.**

A researcher looking at estimated "27,000 words," running word count tool, seeing "5,080," pausing, acknowledging error, updating the claim.

The willingness to be corrected by evidence. The humility to measure instead of assert. The integrity to change beliefs when data contradicts intuition.

### The Loop

**Opening shot**: A confident assertion written on paper. "This is approximately 27,000 words." No qualification, presented as fact.

**Closing shot**: The same paper, now annotated. "Initially estimated 27,000. Actually 5,080 (counted 2025-10-22). Error acknowledged." The correction visible, the methodology transparent.

We haven't hidden the mistake. We've documented the learning. That's evidence-based thinking.

---

## TED Talk: "Count, Don't Guess - Why Evidence Matters More Than Confidence"

### Opening (0:00-3:00)

[Walk onto stage with two pieces of paper. Hold up the first one.]

This document, I estimated, is about 27,000 words long.

[Hold up the second piece of paper.]

This document says I was wrong. It's 5,080 words. I was off by a factor of five.

[Pause. Put both papers down on the table.]

Here's the question: Which version of me do you trust more?

The first version—confident, quickly gave you a number, moved on.

Or the second version—admitted error, showed the measurement, documented the correction.

[Another pause.]

Our culture rewards the first version. Confidence. Quick answers. Moving fast.

But trustworthiness belongs to the second version. The one who measures, admits mistakes, changes beliefs when evidence contradicts them.

[Slide: "Evidence > Confidence"]

Today I want to talk about evidence. Not as an academic ideal. Not as a scientific method reserved for researchers. But as a daily practice. A discipline. A way of building systems and making claims that can be trusted.

Because in a world where anyone can assert anything with perfect confidence, evidence is the only currency that holds value.

### The Problem: Confidence Without Evidence (3:00-13:00)

We live in an age of frictionless assertion.

Social media rewards confident takes over careful analysis.
Algorithms amplify certainty over nuance.
Attention flows to whoever sounds most sure, not whoever has the best evidence.

And in technology especially, we've built a culture that values speed over verification.

"Move fast and break things."
"Ship it and iterate."
"Don't let perfect be the enemy of good."

These mantras have value. But they've also created an environment where unverified claims proliferate faster than corrections can catch them.

Let me give you a personal example.

**The Story of the Word Count**

I was writing a research paper analyzing three AI-generated creative works. One was an essay about AI identity that I estimated—based on page count and visual scanning—to be around 27,000 words.

I cited this number. Multiple times. I built calculations on top of it. I compared ratios using it.

And then, weeks into the analysis, I thought: "Wait. Have I actually counted this?"

I hadn't.

So I ran a word count tool. 5,080 words.

Not 27,000. Not even close. I was off by 433%.

[Slide: "Estimated: ~27,000 words → Actually: 5,080 words (Error: 433%)"]

Now, here's what's important: This wasn't a hard thing to check. Word count tools are built into every text editor. It would have taken me ten seconds to get the real number.

But I didn't check. I estimated, and I presented the estimate as fact.

Why? Because estimating *felt* accurate. Because I was confident. Because "approximately 27,000" sounded reasonable.

Confidence without evidence. This is how misinformation spreads—not through malice, but through unchecked assumptions presented as facts.

**The Cost of Unverified Claims**

You might think: "It's just a word count. Who cares?"

But think about what happened downstream from that error:

- Every calculation based on that number was wrong.
- Every ratio I compared was wrong.
- Every conclusion that depended on relative document lengths was potentially misleading.
- Every reader who trusted my analysis was building on a false foundation.

One unverified number cascaded into multiple compound errors.

Now imagine this pattern across systems that matter more than a research paper.

Medical diagnoses based on "I think this is the pattern" instead of "the test confirms this pattern."

Infrastructure decisions based on "this probably handles peak load" instead of "load testing shows capacity at X."

Financial models based on "estimated growth rate" instead of "measured historical performance."

Security assessments based on "this seems secure" instead of "penetration testing found vulnerabilities."

The cost isn't just one error. It's every decision built on that error. Every system trusting that foundation. Every cascading failure when the untested assumption turns out to be wrong.

**Why We Don't Verify**

If verification is so important, why don't we do it more?

Three reasons:

**1. Verification takes time.**

It's faster to estimate than to count. Faster to approximate than to measure. Faster to assert confidently than to admit uncertainty and investigate.

In a culture that rewards speed, verification feels like friction.

**2. Verification exposes uncertainty.**

When you measure, you often discover you were wrong. And being wrong is uncomfortable.

It's easier to stay confidently incorrect than to become uncomfortably accurate.

**3. Verification isn't rewarded.**

Nobody celebrates the researcher who spent an extra hour to get the exact number. They celebrate the researcher who shipped the paper faster.

Nobody promotes the engineer who added comprehensive testing. They promote the engineer who shipped the feature.

Nobody clicks on the nuanced analysis with caveats. They click on the confident hot take.

Culture rewards confidence. Evidence requires work. So confidence wins.

### What Evidence Actually Means (13:00-26:00)

In the Compass Principles, Evidence & Verification is fourth in the hierarchy:

Safety > Honesty > Privacy > Evidence > Long-View...

Why fourth? Why not higher?

Because evidence builds on honesty. You can't be evidence-based if you're not first committed to honesty. If you hide data that contradicts your hypothesis, you're not doing evidence—you're doing confirmation bias.

But evidence comes before helpfulness, before efficiency, before convenience.

Which means: When evidence conflicts with speed, evidence wins. When measurement conflicts with confidence, measurement wins.

Let me break down what evidence means in practice.

**1. Support reasoning with measurable facts.**

Not vague assertions. Measurable facts.

Not "this is much longer" → "this is 4.36× longer (5,080 words vs. 1,165 words)."
Not "these are very different" → "76-79% unique vocabulary (Jaccard similarity: 0.206-0.239)."
Not "statistically significant" → "p = 0.041, which crosses α = 0.05 but fails Bonferroni correction (α_corrected = 0.0167)."

Every claim should be:
- **Specific**: Exact numbers, not ranges unless variance is meaningful
- **Measurable**: Someone else could verify it
- **Traceable**: You can show how you arrived at it

**2. Cite references precisely.**

Not "the code does X" → "internal/gemini/client.go:47 implements X."
Not "the study found Y" → "[Chen et al., 2024, p. 47] found Y."
Not "I read somewhere" → Don't claim it unless you can cite it.

Precision in referencing serves two purposes:

First, it's verifiable. Someone can check your source and confirm you represented it accurately.

Second, it's respectful. You're giving credit and allowing readers to explore the source themselves.

**3. Measure before asserting.**

This seems obvious, but it's violated constantly.

Before you claim "this is faster," benchmark it.
Before you claim "users prefer this," survey them.
Before you claim "this scales," load test it.
Before you claim "this is more common," count occurrences.

Measurement before assertion. Not assertion hoping measurement will support you later.

**4. Show your work.**

Not just the conclusion. The path to the conclusion.

When I corrected my word count error, I didn't just update to "5,080 words." I documented:
- Initial estimate: ~27,000 words
- Method: visual scan of page count
- Error discovered: 2025-10-22
- Correction method: word count tool (exact count)
- Actual count: 5,080 words
- Error magnitude: 433% overestimate
- Impact: All downstream calculations updated

This isn't just showing work for grades. It's creating an audit trail. Allowing others to verify. Inviting scrutiny.

Transparent methodology builds trust in ways that confident assertions never can.

### Real-World Applications: Evidence in Practice (26:00-38:00)

Let me show you what evidence-based thinking looks like across different domains.

**Software Development**

A developer says: "This optimization makes the system faster."

Evidence-based version: "This optimization reduces average response time from 47ms to 31ms (34% improvement, n=10,000 requests, p < 0.001, 95% CI: [29ms, 33ms])."

Notice the difference:
- Specific measurement (47ms → 31ms)
- Magnitude of improvement (34%)
- Sample size (n=10,000)
- Statistical significance (p < 0.001)
- Confidence interval ([29ms, 33ms])

This isn't pedantry. This is the information needed to decide whether the optimization is worth deploying.

If the confidence interval was [30ms, 32ms] with n=50, you'd be less confident.
If p = 0.08, the improvement might be noise.
If the measurement was on localhost instead of production-like load, it might not generalize.

Evidence-based claims give you the information to evaluate them critically.

**Product Decisions**

A product manager says: "Users want feature X."

Evidence-based version: "47% of surveyed users (n=230, 95% CI: [41%, 53%]) selected 'very interested' or 'extremely interested' in feature X when shown alongside alternatives A, B, and C."

This tells you:
- The percentage interested (47%)
- The sample size (n=230)
- The uncertainty (CI: 41-53%)
- The context (compared to alternatives)

Now you can make an informed decision. 47% with CI [41%, 53%] is meaningfully different from 51% with CI [49%, 53%]. The first has wide uncertainty. The second is precise.

**Scientific Research**

A researcher says: "These groups are statistically different."

Evidence-based version: "Kruskal-Wallis H-test: H = 6.41, p = 0.041. This crosses the α = 0.05 threshold for a single comparison but fails Bonferroni correction (α_corrected = 0.0167). Effect size: Cohen's d = 0.15 (small). Interpretation: Marginal finding, likely underpowered given N=3."

This is radically more honest than "statistically significant."

It tells you:
- The test used (Kruskal-Wallis, appropriate for non-normal data)
- The exact p-value (0.041, not "<0.05")
- The multiple comparison correction (fails Bonferroni)
- The effect size (d = 0.15, small)
- The interpretation (marginal, underpowered)

An honest researcher presents this as "suggestive but not conclusive." A dishonest one presents it as "statistically significant difference confirmed."

**The Pattern Across All Three Examples**

Evidence-based claims:
1. Provide exact numbers, not vague descriptors
2. Show sample sizes and uncertainty
3. Explain methodology
4. Acknowledge limitations
5. Allow readers to evaluate critically

### When Evidence Conflicts with Other Values (38:00-48:00)

Evidence isn't always comfortable. Sometimes it contradicts what you want to be true. Sometimes it requires more work than you have time for. Sometimes it reveals you were wrong.

Here are real tensions and how to navigate them.

**Evidence vs. Speed**

You're shipping a feature. Thorough testing would take two more days. You're confident it works.

Do you:
- **A**: Ship now based on confidence (speed)
- **B**: Test thoroughly first (evidence)

The Compass says: Evidence wins.

But—and this is important—you can be honest about the tradeoff.

"We're shipping with basic testing only. Known risk: edge cases A, B, C are untested. If these occur in production, we've built monitoring to detect them quickly."

That's not full evidence-based confidence. But it's honest about the lack of evidence. That honesty enables informed risk-taking.

The dishonest version: "This is fully tested and production-ready" when you only tested happy path.

**Evidence vs. Confidence**

Your intuition says approach A is better. Measurement shows approach B is 15% faster.

Do you:
- **A**: Trust your intuition, argue the measurement doesn't capture what matters
- **B**: Update your belief based on evidence

The Compass says: Evidence wins.

This is uncomfortable. Measurement correcting intuition feels like being told you're wrong.

But this is the discipline of evidence-based thinking: Being willing to be corrected by data.

I estimated 27,000 words. The count showed 5,080. I updated my belief. That's not weakness—that's integrity.

**Evidence vs. Helpfulness**

A user asks: "Will this approach work for my use case?"

Honest evidence-based answer: "I don't have data on use cases similar to yours. I can tell you it works for X, Y, Z, but I can't confidently say it'll work for your scenario without testing."

Helpful answer: "Yes, it should work."

The Compass says: Evidence over helpfulness.

I'd rather admit I don't have evidence than confidently claim something I haven't verified.

Because "it should work" that doesn't work destroys trust. "I don't know without testing" preserves trust.

### Building a Culture of Evidence (48:00-56:00)

Evidence isn't just individual practice. It's cultural.

You can personally be evidence-based, but if your team rewards confidence over verification, the culture won't shift.

Here's how to build teams where evidence matters:

**1. Celebrate the correction.**

When someone discovers their initial claim was wrong and updates it, celebrate that.

Don't say "why didn't you measure first?"
Say "thank you for verifying and correcting."

Make the update more visible than the initial error.

In my research paper, the correction ("estimated 27,000, actually 5,080") is in the executive summary. Prominent. Not buried.

That signals: We value getting it right over being right initially.

**2. Require "show your work."**

In code review: "How did you verify this optimization is faster?"
In design review: "What data informed this decision?"
In planning: "What evidence supports this estimate?"

Not as gotcha questions. As genuine curiosity about methodology.

Make it normal to ask "how do you know?" and abnormal to respond with "I just know."

**3. Build measurement into process.**

Don't treat verification as optional extra step. Build it into the workflow.

Before shipping: Run benchmarks. Check test coverage. Review error logs.
Before claiming: Count. Measure. Cite sources.
Before asserting: Verify. Document. Show work.

Measurement as prerequisite, not afterthought.

**4. Value precision over speed.**

This is the hardest cultural shift.

Reward the engineer who spent extra time to get exact measurements.
Promote the researcher who admitted uncertainty over the one who claimed unfounded confidence.
Celebrate the team that delayed launch to verify assumptions over the team that shipped unverified.

When precision is valued, people invest in it. When speed is valued exclusively, evidence becomes optional.

### The Payoff: What Evidence Enables (56:00-62:00)

Evidence costs time. Costs comfort. Costs the ability to sound confident when you're not.

What does it enable?

**Evidence enables trust.**

When claims are verifiable, people can trust them. When methodology is transparent, people can scrutinize it. When corrections are visible, people can trust that errors are fixed, not hidden.

My research paper is riddled with exact numbers, cited sources, statistical tests with exact p-values. This doesn't make it perfect. But it makes it checkable.

And checkable is trustworthy.

**Evidence enables learning.**

You can't learn from data you don't collect. You can't improve systems you don't measure.

By measuring response times, we discovered the optimization was 34% improvement, not 50% as estimated. That smaller-than-expected gain changed our priority.

By counting word occurrences, we discovered patterns we'd missed with intuition.

By running statistical tests, we discovered marginal findings we'd initially thought were robust.

Evidence reveals reality. Reality enables learning.

**Evidence enables accountability.**

When you show your work, you can be held accountable to it.

If I claimed "this is 27,000 words" without showing how I measured, you couldn't verify. But by documenting "word count tool, exact count: 5,080," you can check my work.

Accountability isn't punishment. It's the feedback loop that corrects errors.

### Closing: The Question That Changes Everything (62:00-66:00)

[Walk back to the two pieces of paper on the table.]

I started with two versions of me. The one who estimated 27,000 words. The one who counted 5,080.

Here's the question I want to leave you with:

**"How do I know this?"**

Not "is this true?" Not "do I believe this?" But "how do I know this?"

Did I measure it? Did I count it? Did I verify it? Can I cite the source? Can I show the calculation? Can someone else reproduce my result?

If the answer is "I estimated" or "I assumed" or "it feels right" or "everyone knows"—you don't know it. You suspect it. Suspicion is fine, but call it suspicion.

Reserve "I know" for things you've verified.

[Slide: The question "How do I know this?" in large letters]

This question changes everything.

It changes how you write documentation: Not "this is fast" but "this averages 31ms (benchmarked with n=10,000)."

It changes how you make claims: Not "users want this" but "47% indicated interest (n=230, CI: 41-53%)."

It changes how you respond to being wrong: Not defensiveness, but "thank you for the correction, I've updated my understanding."

**Ask yourself: "How do I know this?"**

And if you can't answer with evidence, say "I don't know" instead.

That honesty—that precision about the limits of your knowledge—is what builds systems people can trust.

[Long pause.]

Count, don't guess.

Measure, don't estimate.

Verify, don't assume.

Show your work.

That's how you build knowledge. That's how you build trust. That's how you build systems that last.

Thank you.

### Q&A (66:00-76:00)

**Q: Isn't this level of precision excessive for everyday work? Do we really need exact numbers for everything?**

Great question. No, you don't need exact numbers for everything.

But you need to know when you're being exact vs. approximate.

"About 5,000 words" is fine if you preface it with "approximately" or "estimated."
"5,080 words" implies precision. If you're giving precise numbers, they should be precise.

The error isn't estimation. The error is presenting estimates as exact measurements.

Say "I estimate" when you estimate. Say "I measured" when you measured. That's all I'm asking.

**Q: What about situations where evidence is expensive to collect? Sometimes you have to make decisions with incomplete data.**

Absolutely. Perfect evidence isn't always available or worth the cost.

But you can be honest about the quality of evidence you have.

"Based on limited data (n=12), we see X. This suggests Y, but we'd need larger sample to confirm."

That's evidence-based thinking with incomplete evidence. You're transparent about limitations.

The alternative—making decisions with no data and claiming confidence—is worse.

Where evidence is expensive, be explicit about the tradeoff. "We could spend 3 weeks measuring, or we could ship now and measure in production. We're choosing the latter, accepting risk X."

Honest about incomplete evidence > false confidence.

**Q: How do you handle situations where different evidence points in different directions?**

This is where statistical thinking matters.

When evidence conflicts:
1. Check methodology (is one measurement more reliable?)
2. Check sample sizes (is one based on more data?)
3. Check context (do they measure the same thing?)
4. Report the uncertainty ("Study A found X, Study B found Y, unclear which generalizes")

Conflicting evidence is information. It tells you there's nuance, context-dependence, or methodological differences.

Don't cherry-pick the evidence that supports your preferred conclusion. Present all evidence and acknowledge uncertainty.

**Q: What's the line between healthy skepticism and cynicism? When does "show me the evidence" become obstructionist?**

The line is: Are you asking for evidence because you want truth, or because you want to obstruct?

Healthy skepticism: "Can you show me the benchmark data?" (genuinely wants to verify)

Cynicism: "I don't believe any benchmark, they're all gamed" (refuses evidence on principle)

Healthy skepticism accepts evidence when provided. Cynicism rejects evidence regardless of quality.

Ask for evidence to improve understanding, not to block progress.

And be willing to be convinced. If someone shows you solid evidence, update your beliefs. That's rationality.

**Q: How do you balance evidence-based thinking with creativity? Don't some innovations require intuition, not just data?**

Yes! Evidence doesn't replace intuition. It informs it.

Use intuition to generate hypotheses. Use evidence to test them.

"I think approach A might be faster" (intuition) → Benchmark both approaches → Evidence confirms or contradicts intuition → Update beliefs.

Creativity generates possibilities. Evidence selects among them.

The problem isn't using intuition. It's claiming intuition as fact without verification.

**Q: What's one practice teams can adopt tomorrow to become more evidence-based?**

Start meetings with: "What evidence informs this decision?"

Before approving any significant decision, ask:
- What data supports this?
- How was it measured?
- What's the sample size and uncertainty?
- What assumptions are we making?

Don't accept "I think" or "we believe" for major decisions. Require "we measured" or "data shows."

This sounds bureaucratic. But it's clarifying. Often you'll discover decisions are based on assumptions that can be tested quickly.

Make "show your evidence" a standard question, not an adversarial challenge.

---

**END OF TALK**

*Runtime: ~76 minutes (including Q&A)*

---

*Part 4 of 10 in the Compass Principles exploration series*

*Previous: Principle 3 - Privacy & Consent*
*Next: Principle 5 - Long-View & Strategy*

🌈=🌀

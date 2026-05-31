# DSLs as Harnesses

> Why a deliberately limited language is one of the most reliable ways to give an
> AI agent a place to stand.

**Status**: Essay. Written 2026-05-31.

---

## The claim

The prevailing lesson of applied AI engineering in 2025–2026 is that the
*harness* — the designed environment an agent operates inside — matters more than
the model. A harness is the set of tools an agent can call, the format of the
information it receives, the feedback that catches its mistakes, and the
scaffolding that lets it hand work to its future self. The same model, given a
better harness, produces dramatically better work. The interface is not a
convenience layer wrapped around the intelligence; for a language model, the
interface *is* the cognitive architecture.

This essay argues a narrower and, I think, more useful point: **a
domain-specific language is one of the most powerful harnesses you can give an
agent, precisely because it gives up power.** A DSL trades the unlimited
expressiveness of general-purpose code for a small, legible, checkable surface —
and that trade is exactly what an autonomous agent needs to be reliable over the
long run.

## Why the trade pays off

A general-purpose programming language is Turing-complete. That is its glory and,
for an agent, its hazard. There are infinitely many ways to write any given
behavior, no two codebases agree on conventions, and nothing about the language
itself tells the agent whether a given program is *correct for this domain*. The
agent is free, and freedom under uncertainty is where agents thrash: they explore
broadly, drift toward locally-plausible patterns, and accumulate subtle mistakes
that only surface much later.

A DSL inverts every one of those properties. It is deliberately *not* a general
language. It can express a bounded set of things, in a bounded number of ways,
and it usually ships with a parser and validator that can say "this is
well-formed" or "this is not" before anything executes. When you hand an agent a
DSL, you are not just giving it a tool — you are reshaping the space it has to
search. That reshaping is what makes the four classic harness patterns fall out
of a single design decision.

### 1. The schema is the system of record

Harness engineering insists that anything the agent cannot read in context
effectively does not exist; intent must live in a machine-readable artifact, not
in a Slack thread or a person's head. A DSL satisfies this by construction. Its
schema *is* the specification. When an agent writes a DSL document, the user's
intent is captured as a structured, inspectable object rather than dissolved into
the incidental details of imperative code. You can diff it, version it, validate
it, and reason about it — all without running it.

### 2. The validator is a free feedback loop

The single highest-leverage component in the SWE-agent study was the linter that
ran on every edit and rejected syntactically broken changes *at the moment of
introduction*, before the error could propagate through a dozen later steps. A
DSL gives you that loop for nothing. Every DSL has a parser; most have a type or
schema checker. The instant an agent emits a malformed structure, it is rejected
with a localized, actionable message. You did not have to build the feedback
loop — it came bundled with the language.

### 3. The grammar is a forcing function

SWE-agent's search tool capped results and told the agent to narrow its query
when it was too vague. That cap was not a limitation; it was a *forcing
function* that pushed the agent from flailing toward deliberate, specific action.
A DSL's grammar is a forcing function over the entire output. Because the
vocabulary is finite, the room to hallucinate is structurally smaller. The agent
cannot invent an option that does not exist in the grammar; it can only compose
the primitives the language actually provides. Constraint, here, is a feature.

### 4. The unit of the language is the unit of context

Progressive disclosure — start small, reveal more only when needed — is the
antidote to dumping an entire project into a context window and diluting the
agent's attention. A well-designed DSL has a natural decomposition: a beat, a
service, a rule, a step. That granularity becomes the agent's editing unit. It
can work on one piece without holding the whole document in mind, and the
language's structure, not an ad-hoc heuristic, defines the seams.

## Three examples

### MulmoScript: generation and execution, cleanly separated

MulmoScript is a JSON-based DSL for describing multimodal presentations and
videos — a sequence of *beats*, each carrying text, imagery, audio, and timing.
What makes it instructive as a harness is the architecture it enables: **the
agent does not produce the video; it produces the script.** A deterministic
renderer turns that script into the finished artifact.

This split is the essay's thesis made concrete. The probabilistic, creative work
(deciding what the video should say and show) is done by the agent in the DSL.
The deterministic, repeatable work (rendering pixels and audio) is done by code
that never guesses. The output is inspectable before a single frame is rendered,
the same script always yields the same video, and a bad result can be diffed,
edited, and re-rendered rather than regenerated from scratch. The harness slogan
"the model decides *what* to think about; the harness decides *how* it is
executed" is, in MulmoScript, an actual boundary in the pipeline.

### Encore: a DSL that enforces its own invariants

MulmoClaude's Encore feature lets the agent declare a *recurring obligation* — a
payment, a tax, a medical exam — as a compact schema: a cadence, the targets it
covers, the steps that close each cycle, the values to record, and a firing plan
that says when to nudge and how loudly. The agent declares the obligation; a
deterministic engine reconciles it against the calendar, raises notifications at
the right moments, and rolls each completed cycle into the next. For an agent,
this is the "enforce invariants, not implementations" pattern delivered by the
schema itself.

An agent composing an obligation has wide latitude in *what* to track and how to
describe it, but it cannot emit a structurally incoherent schedule, because the
validator rejects one before it is ever saved: a payment with no currency, a
reminder anchored to an expression that does not exist, a recorded field that no
step claims. Each failure is a precise, field-path message pointing at the exact
rule — localized, actionable feedback the agent can act on without a human in the
loop. And the agent never authors the part that must not drift: it does not
implement the scheduling, the notification firing, or the cycle rollover — those
belong to the engine and run identically every time. The obligation stays correct
across every later amendment not because a reviewer caught each edit, but because
the DSL would not let an incorrect one through.

### Collections: handing the harness-authoring pen to the user

MulmoClaude's collections feature extends the idea one rung further. A collection
is defined by a schema — a small DSL describing the shape of the data — and that
schema drives the skills the agent uses to read, write, and reason over the
collection. The schema is the spec; the generated skill files are the execution
layer.

The novel move is *who writes the DSL*. In the SWE-agent and Encore cases, an
engineer designs the harness and the agent operates inside it. Collections push
the authoring of the harness toward the end user: by declaring a schema, a
non-engineer is, in effect, designing the environment the agent will work in.
This is the literal democratization of harness engineering. The principle that
"engineers design environments rather than write code" becomes "*anyone* can
design an environment, declaratively, and let the agent execute within it."

## The one hazard: design the escape hatch

The same rigidity that makes a DSL a good harness is also its failure mode. When
the language cannot express what the user actually needs, an agent will do one of
two bad things: give up, or contort the DSL into something it was never meant to
hold. A DSL that is too hard becomes a cage.

The well-designed DSLs all answer this the same way — with a deliberate exit to a
more expressive layer. Encore drops out of its declarative schedule into a seeded
chat — an agent with full tools — the moment a cycle needs the human judgment the
form cannot capture. MulmoScript can incorporate arbitrary external assets and
media rather than insisting everything be expressed in its own primitives.
The art of DSL-as-harness is not maximizing constraint; it is choosing *where*
the constraint binds and providing a clean, legible path out where it does not.
A harness with no escape hatch eventually forces the agent to either fail or lie,
and both are worse than a slightly leakier abstraction.

## Why this matters more as models improve

There is a tempting intuition that DSLs are a crutch for weak models — that as
models get smarter, we can hand them general-purpose code and dispense with the
guardrails. I think the opposite is true. The case for a DSL is strongest
precisely where we want to delegate *autonomously and over long horizons*: where
no human will review each step, where the output must be verifiable, where
execution must be deterministic and reversible. Those are the conditions of
serious agentic work, and they get *more* important as we trust agents with more.

A smarter model inside a DSL harness is not wasted capability; it is capability
aimed at the part of the problem that genuinely requires judgment — what to say,
what to build, what to express — while the language guarantees the rest. The
model is the reasoning engine. The DSL is a particularly sharp way of deciding
what it gets to reason about. Getting that boundary right is the whole game, and
a well-chosen DSL draws it with unusual precision.

---

## Appendix: the three DSLs, concretely

The body argued the case in the abstract. This appendix grounds each of the
three examples in an actual artifact — the **document an agent emits**, and the
**schema or declaration that constrains it** — with a note on which harness
property (§1 schema-as-record, §2 free validator, §3 grammar-as-forcing-function,
§4 unit-of-context, plus the escape hatch) each one makes concrete.

### A. MulmoScript — a presentation as inspectable data

A MulmoScript is a JSON document: a header, some shared parameters, and an array
of **beats**, each a slide with a speaker, narration, and one visual. The agent
authors *this*, never the pixels. A meta-example — a short narrated explainer
about this very essay:

```json
{
  "$mulmocast": { "version": "1.1" },
  "title": "Why DSLs Make Good Harnesses",
  "lang": "en",
  "speechParams": {
    "speakers": {
      "Presenter": { "provider": "google", "voiceId": "Kore" }
    }
  },
  "beats": [
    {
      "speaker": "Presenter",
      "text": "A harness is the environment an agent works inside: the tools it can call, the format of what it sees, and the feedback that catches its mistakes.",
      "image": {
        "type": "textSlide",
        "slide": { "title": "Harness > Model", "bullets": ["Tools it can call", "Format of information", "Feedback on mistakes"] }
      }
    },
    {
      "speaker": "Presenter",
      "text": "A domain-specific language is a powerful harness precisely because it gives up power.",
      "image": {
        "type": "markdown",
        "markdown": "## The trade\n- Bounded vocabulary\n- A validator for free\n- Inspectable before it runs"
      }
    },
    {
      "speaker": "Presenter",
      "text": "The agent writes the script; a deterministic renderer turns it into the video. Generation and execution stay cleanly separated.",
      "image": {
        "type": "mermaid",
        "title": "Generation vs. execution",
        "code": { "kind": "text", "text": "graph LR\n  A[Agent writes MulmoScript] --> B[Validator]\n  B --> C[Deterministic renderer]\n  C --> D[Video]" }
      }
    }
  ]
}
```

**The schema** is a published JSON schema shipped with the mulmocast engine (the
`$mulmocast` version pins it). MulmoClaude validates a draft against it on every
save / edit before anything renders (the validators in
`server/api/routes/mulmoScriptValidate.ts`) — that is harness property §2, the
free feedback loop: a malformed beat is rejected with a localized message, no
frames wasted. The closed set of beat `image` types (a subset: `markdown`,
`slide`, `textSlide`, `image`, `chart`, `mermaid`, `html_tailwind`) is §3, the
grammar as forcing function: the agent can only compose visuals the renderer
actually understands. And each **beat is the unit of context** (§4) — the agent can revise
one slide without re-reasoning about the whole deck. The escape hatch is the
`image`/`html_tailwind` types that embed arbitrary assets or raw HTML when the
structured layouts run out.

### B. Encore — a recurring obligation as a declarative schedule

MulmoClaude's Encore plugin tracks recurring obligations — a monthly payment, a
biannual tax, an annual physical — that fire on a cadence and carry context
forward across cycles. The agent authors the obligation as a small YAML DSL
(stored as frontmatter in `obligations/<id>/index.md`); a deterministic
reconciler turns the declared `firingPlan` into bell notifications and, when a
cycle closes, provisions the next one. The agent declares *what recurs and when
to nudge* — it never writes a timer, a cron expression, or notification code.

A monthly two-payee payment with an escalating reminder plan:

```yaml
version: 1
displayName: "Monthly payments (due 10th)"
type: payment
currency: JPY
cadence:
  type: monthly
  day: 10
targets:
  - id: isamu
    displayName: "Isamu"
    defaults:
      amount: 15000
  - id: singularity-society
    displayName: "Singularity Society"
steps:
  - id: pay
    displayName: "Pay"
    deadline: cycle-deadline
    firingPlan:
      - { at: cycle-start, severity: info }
      - { at: cycle-deadline-3d, severity: warning }
      - { at: cycle-deadline+1d, severity: urgent }
    fields: [invoiceReceivedOn, amount, paidOn]
formSchema:
  fields:
    - { name: invoiceReceivedOn, type: date, label: "Invoice received on" }
    - { name: amount, type: number, label: "Amount paid (JPY)", required: true }
    - { name: paidOn, type: date, label: "Payment date" }
```

The document is validated against a Zod discriminated union (`EncoreDslInput`,
`src/types/encore-dsl/schema.ts`) on every `defineEncore` call — §2, the free
validator: a `payment` missing its ISO-4217 `currency`, or a `formSchema` field
that no step's `fields` array claims, is rejected with a field-path message
*before* the obligation is ever saved. The grammar is the §3 forcing function:
`cadence.type` is a closed set (`daily` / `weekly` / `monthly` / `annual` /
`biannual`), and a `firingPlan[].at` can only be an anchor expression
(`cycle-start`, `cycle-deadline`, `step-deadline`, `schedule:YYYY-MM-DD`) with an
optional `±Nd` offset — the agent cannot invent a scheduling primitive the
reconciler doesn't understand. Each obligation, and each step within it, is the
§4 unit of context: the agent amends one without re-reasoning about the rest.

The generation/execution split is as clean as MulmoScript's: the agent produces
the schedule; the deterministic reconciler (`server/encore/reconcile.ts`)
evaluates the firing plan against today's date, raises the bell at the right
severity, and provisions the next cycle on close — repeatable, inspectable, no
guessing. And the escape hatch is the **hand-off to a seeded chat**: when a cycle
genuinely needs judgment ("what was the amount? was it actually paid?"), clicking
the bell opens a chat where the agent collects the `formSchema` values and calls
an operational action (`markStepDone`, `snooze`, …) — the expressive,
human-in-the-loop layer the declarative schedule deliberately leaves out.

### C. The Collection DSL — a user-authored schema

A MulmoClaude collection is a `schema.json` (the DSL the host renders) plus a
`SKILL.md` (the script the agent reads to CRUD records). The novel move, per the
body, is that the *user* authors this harness. An invoices collection,
exercising relations, a computed total, and an action:

`schema.json`:

```json
{
  "title": "Invoices",
  "icon": "receipt_long",
  "dataPath": "data/invoices/items",
  "primaryKey": "id",
  "completionField": "status",
  "completionDoneValues": ["paid", "void"],
  "fields": {
    "id": { "type": "string", "label": "Invoice #", "primary": true, "required": true },
    "issuer": { "type": "embed", "label": "From", "to": "mc-profile", "id": "me" },
    "clientId": { "type": "ref", "label": "Client", "to": "mc-clients", "required": true },
    "issueDate": { "type": "date", "label": "Issued", "required": true },
    "currency": { "type": "enum", "label": "Currency", "values": ["USD", "JPY", "EUR"], "required": true },
    "lineItems": {
      "type": "table",
      "label": "Line Items",
      "of": {
        "description": { "type": "string", "label": "Description", "required": true },
        "quantity": { "type": "number", "label": "Qty", "required": true },
        "rate": { "type": "money", "label": "Rate", "currencyField": "currency", "required": true }
      }
    },
    "taxRate": { "type": "number", "label": "Tax Rate" },
    "total": { "type": "derived", "label": "Total", "display": "money", "currencyField": "currency", "formula": "sum(lineItems[].quantity * lineItems[].rate) * (1 + taxRate)" },
    "status": { "type": "enum", "label": "Status", "values": ["draft", "sent", "paid", "void"], "required": true }
  },
  "actions": [
    { "id": "pdf", "label": "Generate PDF", "icon": "picture_as_pdf", "kind": "chat", "role": "office", "template": "templates/invoice-pdf.md" }
  ]
}
```

`SKILL.md`:

```markdown
---
name: invoices
description: Issue and track invoices — line items, total, status, and a PDF action. Use when the user wants to draft an invoice, add line items, or mark one sent / paid / void ("create an invoice for X", "mark INV-2026-0007 paid"). Records live at `data/invoices/items/<id>.json`; viewed at `/collections/invoices`.
---

# Invoices (schema-driven collection)

## Record shape
- `id` — invoice number, primary key / filename (e.g. `INV-2026-0007`).
- `issuer` — display-only `embed` of `mc-profile/me`; nothing is stored here.
- `clientId` — a `ref`: store an existing `mc-clients` primary-key slug.
- `currency` — the code every money field formats against.
- `lineItems` — table rows of `description`, `quantity`, `rate`.
- `taxRate` — a fraction (e.g. `0.1` for 10%).
- `total` — **host-computed `derived`. NEVER write it** — the host recomputes it from the line items + tax rate on every render.
- `status` — `draft` / `sent` / `paid` / `void`.

## What to do
- **Create.** Resolve the `clientId` ref, set `currency`, add `lineItems`, set `status: draft`, then Write `data/invoices/items/<id>.json` WITHOUT `total`.
- **List.** Call `presentCollection` with `collectionSlug: invoices`.

## Conventions
- Only link `clientId` to a real `mc-clients` record; create it first otherwise.
- Money values are plain decimals; `currency` is presentation only.
```

The `schema.json` is §1 made literal — the spec a user can diff and version — and
a Zod validator (`CollectionSchemaZ`) gives §2 for free: a malformed schema is
rejected at load with a localized reason, never crashing the host. The finite
field-type vocabulary is §3, and each record / field is the §4 editing unit. The
escape hatch is the **`actions` mechanism**: "Generate PDF" can't be expressed
declaratively — laying out a document and writing a file is real work — so the
schema doesn't try. The button hands off to an `office`-role chat seeded from
`templates/invoice-pdf.md`, dropping to the most expressive layer there is (an
agent with tools) exactly where the DSL runs out. Business logic as prose, behind
a declarative door.

> The on-disk plumbing behind all three collection artifacts (staging vs.
> mirror, discovery, the REST surface, delete/restore) is documented separately
> in [`collections-architecture.md`](./collections-architecture.md).

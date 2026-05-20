# Product Hunt Listing — Draft v2

Reflects the final manifesto (post-revision) and the HN launch positioning. PH comes ~10 days after HN, so this listing inherits the same architectural framing the HN audience will have already seen.

## Tagline (≤60 chars)

**Primary:** Chat summons GUIs, applications are plugins — *47 chars*

Alternates:
- How AI-native applications should be built — *43 chars* (essay title; works as tagline)
- Open-source platform where applications are plugins — *51 chars*
- Claude as a universal controller across plugins — *47 chars*

## Description (≤260 chars)

**Primary draft (245 chars):**

> An open-source AI-native application platform. Real apps already run on it: a full accounting system, the Encore obligation engine, a personal wiki, an SEC-filings reader (Edgar). Claude composes plugins in one turn. MIT · `npx mulmoclaude`.

**Alternate (251 chars), heavier on the architectural angle:**

> MulmoClaude is an open-source application platform where Claude acts as a universal controller across a plugin registry. Built on top of MCP, with gui-chat-protocol as the agent↔GUI extension. MIT · `npx mulmoclaude`.

## Topics (pick 3–4 from PH taxonomy)

- **Developer Tools** *(primary — the audience that responds to manifesto launches)*
- **Artificial Intelligence** *(required — places it in the active conversation)*
- **Open Source** *(required — MIT, npm-distributed, the protocol is part of the product)*
- **Productivity** *(optional fourth — the app does productivity work, but skip if it dilutes the dev-tools framing)*

## Maker's first comment (~380 words)

> Hey Product Hunt — Satoshi here.
>
> MulmoClaude is an open-source AI-native application platform. The unusual thing about it is structural: instead of being a single application, it's a registry of applications running as plugins, with Claude as a universal controller composing across them. Real applications running on it today include a full accounting system (with server-side bookkeeping logic), the Encore obligation engine, a personal wiki, and an SEC-filings reader (Edgar).
>
> Three architectural commitments:
>
> **1. The agent is a universal controller.** Claude is a controller in the MVC sense, joining the UI as a second way in — but with one decisive advantage: it can compose plugins in a single turn. "Summarize Q1 expenses as a chart" reads accounting, writes chart. No app-switching, no copy-paste between apps.
>
> **2. Chat summons GUIs.** The agent's reply isn't a string. It picks a format for the content: Markdown for prose, MCP tool invocations for rich GUI surfaces (chart, form, wiki, spreadsheet, 3D scene), MulmoScript for multimedia. In both directions — the agent can also request structured input via a form when free text isn't the right modality.
>
> **3. The protocol is open.** `gui-chat-protocol` is a small versioned npm package that **extends MCP for the visual layer** — defining the contract between agent and GUI. Built-in plugins, third-party npm plugins, and (in principle) any future host all implement against the same spec.
>
> One emergent consequence worth naming: premium SaaS features (multi-format export, BI dashboards, cross-app workflows) collapse into default cross-plugin composition. What used to be a paid upgrade tier becomes a single sentence.
>
> Full architectural argument: [How AI-Native Applications Should Be Built](https://github.com/receptron/mulmoclaude/blob/main/MANIFEST.md)
>
> Install: `npx mulmoclaude` · MIT-licensed · github.com/receptron/mulmoclaude
>
> Curious what patterns you're seeing in your own AI-native builds — comment any reactions or counter-examples.

**Optional addition if HN went well** (insert before the manifesto link): *"This was on Hacker News last week — the conversation there helped sharpen the architecture. ([HN thread link])"*

## Gallery captions (placeholders — final captions follow actual shots)

| # | Manifesto section | Caption draft |
|---|---|---|
| 1 (hero) | Three commitments | "An open-source AI-native application platform. Claude composes across a registry of plugins as a universal controller." |
| 2 | Universal controller | "Two consumers of the same business-logic API: the traditional UI and the agent. The agent doesn't replace the UI — it joins it, with one advantage: it can compose plugins in a single turn." |
| 3 | Chat summons GUIs | "The agent picks the format for what arrives: chart, form, wiki, spreadsheet, 3D scene, or prose. And it can request structured input via forms when text isn't the right modality." |
| 4 | Accounting (Pattern A) | "Real server-side business logic. A photo of a paper receipt becomes a bookkeeping entry — no OCR pipeline, no premium SKU. Capability contributed by the agent, not the application." |
| 5 | Encore (Pattern B) | "Natural language in, domain-specific language out. The LLM is the interface to the engine, not the engine itself." |
| 6 | Premium features, for free (Pattern C) | "Multi-format export, BI dashboards, cross-app workflows — what SaaS sells as the upgrade tier collapses into default cross-plugin composition. One sentence replaces the paid plan." |

## Notes

- **Tagline #1 ("Chat summons GUIs, applications are plugins")** matches the HN submission title verbatim. Cohesion across launches: HN visitors who land on PH 10 days later see the same line they upvoted; PH visitors who follow the link to MANIFEST.md find the same two phrases as section anchors.
- **Description** leads with what it *is* (a platform) and what's *on it today* (named real apps). Avoids the "everyone says SaaS is dead" hook from the manifesto — that hook is essay register, not PH-listing register. The listing is a destination card; the essay is the argument.
- **Maker comment** mirrors the essay's three commitments structure (universal controller → chat summons GUIs → open protocol extending MCP) plus the Pattern C insight at the end. Slightly warmer than the HN version (Hey/Hi opener; less defensive about "where does this break"; more invitational ending).
- **HN reference is optional.** If HN goes well, the optional line in the maker comment becomes a social-proof asset for PH. If HN underperforms, omit silently — PH visitors don't know what HN reception looked like.
- **Gallery captions** now follow the final manifesto section names (Universal controller / Chat summons GUIs / Pattern A / Pattern B / Pattern C). Final captions get rewritten once the actual screenshots exist (task 6).
- **Topics**: "SaaS" as a topic on PH would be ironic-strong but probably reads as confused targeting. Skip.

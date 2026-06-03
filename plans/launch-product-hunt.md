# MulmoClaude — Product Hunt Launch Strategy

**Owner:** CMO (strategy), Engineering (demo assets), Community (day-of ops)
**Target launch:** Tuesday, one week out — 12:01 AM PT kickoff
**Positioning one-liner:** *Ask Claude Code for an app and it appears — no code, no plugins. And it remembers everything.*
**Core thesis (the story behind the product):** **Every AI agent has amnesia. Every AI app has a fixed feature set. MulmoClaude cures both.** Karpathy showed that an LLM paired with a wiki it builds and reads is powerful — we agree completely, and the wiki is the heart of MulmoClaude's memory. But a wiki is *unstructured*: linked prose, pure data you read. Give that same data a **schema** and it changes category — structured data + schema + Claude-as-runtime is an **application** that computes, relates, and acts. So MulmoClaude holds **both halves of memory**: the **wiki** (unstructured — what Claude *knows*) and **collections** (structured — what Claude *can do*). And the radical part: **you author the structured half by asking.** "Claude, make me an invoicing system" produces a working app — no code, no plugin install, all local Markdown/JSON in one folder (`~/mulmoclaude/`). The AI has a home. It remembers. It grows new capabilities on demand. It works while you sleep. You own it. That's the whole thesis.

**2026 reality check (what's commoditized vs. what's frontier):** Rich output (Artifacts), mobile AI (ChatGPT app, OpenClaw), sandboxing, and code generation are all **commoditized** — don't lead with them. The remaining frontier, and where MulmoClaude wins, is **extensibility-by-asking + memory + autonomy + ownership**. No major player lets a non-engineer grow a new structured app just by asking, then has the *agent itself* be the runtime — that's the freshest, most defensible thing we ship, so it leads. The other three are still unsolved by every major player too. That's the category-defining gap, and this plan is organized entirely around filling it.
**Target early adopter (one audience, not four):** Claude Code power users who have already hit the limits of the terminal. Everyone else — productivity users, knowledge workers, AI enthusiasts — is phase 2 and will come via these users, not in parallel to them.

---

## 1. Positioning & Tagline

### Primary tagline (Product Hunt hero line)

> **MulmoClaude — Ask Claude Code for an app. It appears. No code, no plugins — and it remembers.**

This one sentence is the whole product. The lead idea is **extensibility-by-asking**: *ask for an app, it appears* tells the viewer the one thing no competitor can claim. *No code, no plugins* names the magic (you didn't install anything, you didn't write anything). *And it remembers* keeps the memory moat — the wiki — riding shotgun. Every surface — hero video, PH headline, tweet #1, gallery captions — must trace back to it. Everything else (parallel sessions, bridges, sandbox, roles, skills, charts, multi-modal output) is *evidence*, not the message.

**Drafting rule:** the lead is always the concrete demo — *"ask Claude for an invoicing app, watch it appear."* Whenever you're tempted to write the abstraction ("applications as data," "schema-driven collections"), write the **ask → app** moment instead. Abstractions lose upvotes; the live "it just appeared" does not.

### Supporting taglines (A/B candidates for social + hero imagery)

1. *Need a new tool? Don't install one. Ask. Claude builds the app, you use it — all local.*
2. *Karpathy gave the LLM a wiki. MulmoClaude gives it a wiki **and** a database that turns itself into apps.*
3. *A wiki is memory you read. A collection is memory that runs. MulmoClaude has both.*
4. *Every AI app ships the features its engineers chose. This one grows new ones when you ask.*
5. *Docs, decks, videos, AND the app to track them — out of Claude Code, and it remembers.*
6. *`~/mulmoclaude/` — your wiki, your apps, your data. All Markdown, all local, all grown by asking.* **(Geek-targeted; use on HN, X-dev, terminal-native audiences.)**

### Category pick

Primary: **Developer Tools** · Secondary: **Artificial Intelligence**
Dev Tools is where our one audience (Claude Code power users) lives. We skip Productivity entirely — chasing two audiences on PH day means landing neither. AI is a defensive tertiary at most.

---

## 2. The One-Sentence Pitch

**MulmoClaude turns Claude Code into a system you extend by asking — say "build me an invoicing app" and a working, schema-driven app appears with no code — that also remembers everything in a self-growing wiki, runs multiple agents at once, and produces real documents, decks, and narrated videos.**

Four clauses, in the order a user asks them: *Can I make it do new things? Does it remember? How fast? What does it make?* The lead clause — extend-by-asking — is the one no competitor can echo. Everything else in this plan is supporting evidence.

### The deeper frame (use when the viewer is ready for more)

> **An AI-built workspace that grows itself — in two directions. It grows *knowledge* (the wiki) and it grows *capability* (collections), both authored by asking. Research, organizing, file management — automatic. Reach it from anywhere. All local, all yours.**

The real differentiator is the **two-axis growth in one folder**. Along the *knowledge* axis: web articles (via source crawling), chat conversations (via automatic wiki extraction), local files, scheduled runs, phone messages all converge into the wiki as plain Markdown — unstructured memory Claude maintains. Along the *capability* axis: when the unstructured wiki isn't enough — when you need something that computes, relates, and acts — you ask for a **collection**, and Claude authors a `schema.json` that *is* a new app, with the same agent as its runtime. Notion and Airtable have structure but an engineer designs the environment and there's no agent runtime. Obsidian is local but inert. ChatGPT/Claude.ai remember a little but can't grow new structured apps. MulmoClaude is the only one that is **local, AI-maintained, multi-source, AND user-extensible by asking** — both halves of memory in one place.

### The anti-wrapper line (use this whenever "is it just a ChatGPT clone?" shows up)

> **This doesn't call the Claude API. It runs Claude Code directly — your auth, your tools, your files, your environment.**

That distinction is the whole reason the product can do what it does. Repeat it verbatim in the maker post, the HN title, and tweet #1.

---

## 3. Why This Wins on Product Hunt

Product Hunt voters reward three things: **a clear "aha"**, **a short demo**, and **a narrative that isn't another wrapper**. MulmoClaude lands all three:

| Hunt instinct                                   | MulmoClaude's answer                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| "Is this just another AI chat wrapper?"         | No — it runs the Claude Code CLI directly (not the API). And the pitch isn't "chat + pretty output" — it's **an app you extend by asking, that also never forgets.** |
| "What's the new idea?"                          | **Ask for an app, it appears — no code, no plugins.** Say "build me an invoicing system" and Claude authors a schema-driven collection that *is* a working app, with Claude itself as the runtime. |
| "Isn't that just Airtable / Notion / Retool?"   | Those are no-code too — but an *engineer* designs the environment and there's no agent runtime. In MulmoClaude the **user** designs it by asking, and **Claude operates inside it.** Zero domain-specific host code. |
| "What's the moat?"                              | **Every AI agent has amnesia; this one doesn't.** A cross-linked wiki grows from every chat — Karpathy's idea, shipped. Collections add the *structured* half: memory that doesn't just inform, it runs. |
| "Isn't that just ChatGPT Memory / Obsidian?"    | ChatGPT Memory is a bullet list. Obsidian is inert. **MulmoClaude builds a cross-linked wiki as a byproduct of chat AND lets you grow structured apps on top of it** — zero manual effort, zero code. |
| "Why should I care tomorrow?"                   | It **works while you sleep.** Register a source, get a morning briefing. Schedule a task, find the report done. No other agent ships this. |

---

## 4. Key Messages (4 — 2026 re-cut, Collections-led)

A PH viewer skims for ~10 seconds and remembers **one** idea. The 2026 market has commoditized rich output, mobile AI, and sandboxing — so those can't anchor the pitch anymore. The four remaining anchors, rank-ordered, are **extensibility-by-asking → memory → autonomy → ownership.** The first is the freshest and most defensible; it leads. The next two pair into one story (see "the spine" below); ownership closes.

### The spine that ties #1 and #2 together (say this once, early)

Karpathy showed that an LLM paired with a wiki it builds and reads is powerful — and we agree. But **a wiki is *unstructured*: linked prose you read. A collection is *structured*: data with a schema that computes, relates, and acts — memory that doesn't just inform, it runs.** MulmoClaude is the only agent that holds both halves: the **wiki** (what Claude *knows*) and **collections** (what Claude *can do*). Message #1 is the structured half; message #2 is the unstructured half. Together they are "an agent whose memory grows in two directions — knowledge and capability — both authored by asking."

### The four (rank-ordered)

**1. The app you extend by asking.** — *Every AI app ships the features its engineers chose. This one grows new ones when you ask.*

Need a tool the product doesn't have — an invoicing system, a CRM, a reading log, a portfolio tracker? Don't install a plugin. Don't write code. **Ask.** Claude authors a `schema.json` — fields, relationships, computed totals, action buttons — and a working app appears, with Claude itself as the runtime. The schema *is* the application; the records are plain JSON; the host contains zero domain code. **This is the headline differentiator — no competitor lets a non-engineer grow a new structured app by asking.**

- **vs Airtable / Notion / Retool:** also no-code, but an *engineer* designs the environment and there's no agent inside it. Here the **user** designs it conversationally and **Claude operates within it** — the democratization of harness design.
- **vs plugin ecosystems (incl. our own earlier Worklog/Client/Invoice plugins):** no install, no marketplace, no per-feature system-prompt bloat. One generic engine; infinite user-defined apps.
- **vs ChatGPT / Claude.ai:** they can *talk about* your invoices; they can't *become* a live invoicing app that computes a total, links a client, and fires a "Generate PDF" action.
- *Why it compounds with #2:* a collection is the **structured** half of memory — the rung past the wiki. The wiki remembers; the collection remembers *and runs*.

**2. The agent that remembers.** — *Every AI agent has amnesia. This one doesn't.*

A personal wiki grows from every chat — automatically, cross-linked, in plain Markdown on your machine. Three days later, Claude wires today's question to what it learned then, without you saving anything. **This is the moat** (Karpathy's idea, shipped). The longer you use it, the more painful it is to switch away — and collections (#1) sit on top of it as the structured layer.

- **vs ChatGPT Memory:** fragmented bullet points, not a knowledge base. MulmoClaude gives you a *cross-linked wiki*.
- **vs Mem.ai / Obsidian:** zero manual effort. Knowledge grows as a byproduct of conversation — you never stop to "file" anything.
- **vs Claude.ai Projects:** no manual uploads. Chats, crawled articles, generated images, search results, temporary summaries — *all* flow into memory automatically and become available from any future session.
- *Eventually, memory itself should be inferred:* the agent decides what's worth remembering, the way it already decides what to generate. That's the endgame.

**3. The agent that works while you sleep.** — *Other agents wait for you. This one has a schedule.*

Register a source — get a morning briefing waiting when you open the lid. Schedule a weekly report — find it in the workspace without asking. Ask for a collection that tracks a recurring obligation — a payment, a tax, a renewal — and it reminds you ahead of each due date and rolls itself forward to the next cycle, no code. Close the laptop, come back to a catch-up. **GUI + persistent state + catch-up after missed runs — no other AI agent ships this combination.** The memory moat (#2) plus autonomous execution (#3) is what compounds: the agent keeps learning while you're not looking.

- **vs Devin / Codex / Claude Code today:** they're one-shot executors. You open them, they work, they stop. MulmoClaude runs in the background.
- **vs cron + Claude API hacks:** power users cobble these together, but nobody ships GUI + persistence + catch-up out of the box.
- *Eventually, scheduling should be autonomous too:* like memory, the agent should infer what to schedule, not wait for the user to specify cron expressions. That's what "an agent that works while you sleep" means at full resolution.

**4. Your machine, your data, your agent.** — *It all lives in `~/mulmoclaude/`. Plain Markdown. Git-friendly. No cloud. No lock-in.*

Web articles, chats, local files, generated images and videos, search results, scheduled outputs — **and the apps themselves** (every collection is a `schema.json` + plain-JSON records) — all land in one folder as plain text. `git push` to a private repo and it's backed up. Open any file in any editor. Read it in 10 years without a migration. Your *data* and the *apps that run on it* are both yours, both inspectable, both diff-able.

- **vs Notion / Mem.ai / ChatGPT:** not cloud. No export flow because there's nothing to export — it's already plain text on your disk.
- **vs Obsidian:** local, but the AI grows it for you. Zero manual curation.
- Hits the "own your AI" sentiment directly — a phrase that already travels on X.
- Sandbox (Docker, auto-detected) gets folded in here, not its own message: it's *how* we keep "your machine, your data" honest, not a separate pitch.

### The visual hooks (not messages — demo bangers)

Two visuals do the work of earning the click. Lead with whichever the channel rewards:

- **"Ask → app appears."** Type *"make me an invoicing system with line items and a PDF button"* and watch a real, usable app materialize — fields, a computed total, an action button — in seconds. This is the **money visual for message #1** and the single most novel thing we can show. Nobody else has it. Use it as the cold open wherever you have >10 seconds.
- **Three parallel Claude Code sessions running at once.** Still a strong shareable visual — reads as "wait, it runs multiple agents?" Use it as the secondary hook / B-roll. It earns attention but it's no longer the lead.

Visuals sell the click; extensibility + memory + autonomy + ownership sell the try.

### Kept in reserve (2026 table stakes — don't lead, but keep warm for FAQ)

- **Multi-modal output — documents, decks, spreadsheets, videos.** Claude Artifacts commoditized this. Still a capability, still strong demo material, but no longer category-defining. Mention after the four messages have landed. (Note: this is also the *escape hatch* a collection action drops into — "Generate PDF" hands off to an office-role chat — so it's a proof point for #1, not just a standalone.)
- **Mobile bridges (Telegram, Slack, LINE, WhatsApp, Discord, Matrix).** OpenClaw (Claude's mobile app) arrived first to the "Claude on your phone" story. Our unique angle now: *your phone writes into the same persistent memory — and the same apps — as your laptop* — but that's a message-#2 proof point, not its own pillar.
- **Docker sandbox.** Expected hygiene in 2026, not a headline. Absorbed into message #4.
- **Roles, skills launcher, ECharts, file attachments.** Comment-thread fuel — deploy when a specific question opens the door. (Note: "Markdown/JSON-as-database" is no longer reserve fuel — it graduated into message #1 as the Collections engine.)

---

## 5. Product Hunt Listing Copy

### Headline (60 char max)
`MulmoClaude — Ask for an app, it appears. No code.` *(50 chars — the ask→app lead in one breath)*

### Tagline (60 char max)
`Build apps by asking. A wiki that remembers. All local.` *(55 chars)*

### First comment (the maker post — pinned)

```
Hi Product Hunt 👋

I'm Satoshi Nakajima. I spent thirteen and a half years at Microsoft
working on operating systems (lead architect on early Windows
releases), then spent the last year obsessing over a single question:
**what does an AI-native OS actually look like?**

I don't think it's ChatGPT. I don't think it's Copilot. I think the
kernel is something like Claude Code — an agent with direct access to
your files, your tools, your environment. Powerful, but living inside
a terminal. Terminals were the OS shell of 1975. We can do better.

MulmoClaude is my attempt at the **shell for that new kernel.** Two
observations drove it: **every AI agent has amnesia, and every AI app
ships with a fixed feature set.** MulmoClaude is built to cure both.

**1. You extend it by asking — no code, no plugins.**
Need a tool the app doesn't have? Don't install anything. *Ask.* Say
"build me an invoicing app with line items and a PDF button" and a
real, working app appears — fields, a computed total, an action
button. Under the hood it's just a `schema.json` Claude wrote plus
plain-JSON records; Claude itself is the runtime, and the host
contains zero code about invoices. I've built ~13 apps this way
without writing host code for any of them: a CRM, a reading list, a
stock watchlist, a film tracker, even a baseball scouting roster. My
portfolio holdings carry `value = shares × ticker.price` that follows
a reference into my quotes collection — **update one quote and every
holding revalues itself, no sync code.** That's not a feature I wrote;
it's a schema I asked for. (Written up in `docs/collections-architecture.md`
and `docs/dsl-as-harness.md` — applications as data, the user authoring
the harness, Claude as the runtime.)

**2. It remembers — a wiki that grows itself.**
Every ingested article, decision, and fact becomes a cross-linked page
in a personal wiki Claude builds and maintains itself (inspired by
@karpathy's *LLM Knowledge Bases* post). The wiki is the *unstructured*
half of memory — what Claude knows; collections (above) are the
*structured* half — what Claude can do. Both plain Markdown/JSON in
`~/mulmoclaude/` — git-friendly, portable, yours. **Every other Claude
client starts from zero; this one compounds.**

**3. It works while you sleep — and answers with real artifacts.**
Register a source, get a morning briefing. Declare a recurring
obligation as a collection and it nudges you before each due date. And it replies with
documents, decks, spreadsheets, and narrated videos (via the built-in
MulmoScript / MulmoCast engine — Gemini image + Veo 3.1 video + audio)
— not walls of text. Behaviors are declarative too: my reading list
lights up the notification bell for every unread link, from **three
keys in its schema** — I never wrote notification code.

**4. It runs many Claude Code agents in parallel, in one browser tab.**
Kick off a video render in one session, refactor code in another,
draft an email in a third. Claude Code is no longer single-threaded.

Two details that matter:

- **Not a wrapper.** This doesn't call the Claude API. It runs the
  actual Claude Code CLI — your auth, your filesystem, your skills,
  your MCP servers. The host contains zero domain code; every app is a
  schema you (or Claude) authored. That's why it can do what it does.
- **Sandboxed by default.** Claude runs inside a Docker container that
  only sees your workspace. SSH keys, `.env` files, home directory —
  invisible. Auto-detected on launch, no configuration.

You can also reach the same workspace — same wiki, same apps — from
Telegram, Slack, LINE, Discord, WhatsApp, Matrix. Fire a task from the
subway, see the result on your laptop.

Open source, MIT.

If you're a Claude Code power user who's hit the walls of the
terminal, this is built for you. Would love your honest feedback — this
is the first visible surface of a much bigger thesis about what
computing looks like when AI is the kernel, and the *user* — not the
engineer — designs the environment.

— Satoshi
```

### Description / gallery captions (one per screenshot)

6 captions. Caption #1 is the ask→app visual hook; #2 shows Collections depth (the wow); #3–#5 are the remaining key messages; #6 is the anti-wrapper proof. No orphans, no reserve features.

1. **Hook — Ask → app appears** — "Type 'build me an invoicing app with line items and a PDF button.' Watch a real app materialize — no code, no plugin install. Just ask."
2. **#1 Collections depth** — "Update one stock quote — every holding in your portfolio revalues itself. `value = shares × ticker.price`, following a reference. You asked for it; you didn't code it."
3. **#2 Memory** — "Every AI agent has amnesia. This one doesn't. A cross-linked wiki grows from every chat — automatically, in plain Markdown on your machine."
4. **#3 Autonomy** — "Other agents wait for you. This one has a schedule — and a notification bell your apps wire into with three lines of schema. Register a source, get a morning briefing."
5. **#4 Ownership** — "Your data AND your apps live in `~/mulmoclaude/` as plain text. `git push` is the backup. No cloud, no lock-in."
6. **Proof — not a wrapper** — "Runs the Claude Code CLI directly. Zero domain code in the host — every app is a schema you authored. Sandboxed in Docker so it stays in its lane."

---

## 6. Demo Video Plan

Three videos — each serves a different channel. **Always record silent first; add a single-voice narration pass; ship captions.**

### Video A — The 60-second hero (Product Hunt gallery + Twitter/X)

- **Goal:** earn one upvote per viewer. No feature-listing.
- **The two moments we must land, back to back:** (1) the **ask→app** moment — a user asks for an app and a real one appears, no code; (2) the **memory** moment — a session "tomorrow" answering a question grounded in the wiki it built "yesterday." Lead with the novelty (ask→app), land with the moat (memory). Together they are the whole pitch: *every AI app has a fixed feature set and every AI agent has amnesia — this one cures both.*
- **Hook (opener):** a user types a plain-English request for an app and watches it materialize in seconds. It reads as "wait, you just *build apps by asking?*" — attention earned in 3 seconds.
- **Structure:**
  - 0:00–0:10 — Cold open: user types *"build me an invoicing app with line items and a PDF button."* An app materializes — fields, a live computed total, a "Generate PDF" button. No logo, no title card. Caption fades in: *"No code. No plugins. Just ask."*
  - 0:10–0:18 — **The Collections wow.** Cut to the portfolio: user edits one stock quote; every holding's value updates live. Caption: *"Update a quote — your whole portfolio revalues itself. No sync code."*
  - 0:18–0:32 — **The memory payoff (money shot).** Wiki sidebar zoom: pages auto-cross-link as Claude works. Time-cut overlay: *"Tomorrow."* A fresh session opens; the user asks a question touching yesterday's topic; Claude answers with the wiki cross-link visible. Caption: *"Every AI agent has amnesia. This one doesn't."*
  - 0:32–0:42 — Autonomy beat. Scheduler view: a registered source triggers overnight; a morning briefing appears. Then the notification bell lights up with an unread reading-list item. Caption: *"It works while you sleep — and your apps wire into the bell with three lines of schema."*
  - 0:42–0:50 — Ownership beat. Finder / terminal open `~/mulmoclaude/` — plain Markdown + the `schema.json` files visible. A `git push` scrolls by. Caption: *"Your data AND your apps. Plain text. Git-friendly. No cloud."*
  - 0:50–0:55 — Anti-wrapper beat. Single white-on-black frame: *"Not an API wrapper. Claude Code, directly. Zero domain code."*
  - 0:55–1:00 — Logo + `npx create-mulmoclaude` + github URL. (If a hosted demo or `--demo` mode ships — see §10.5 — swap in that CTA.)
- **Parallel-sessions B-roll:** the three-agents-at-once shot is now secondary. Use it as a 2-second cutaway under the 0:32–0:42 autonomy beat, or hold it for Video C — don't spend the cold open on it.
- **Production notes:** 1080p screen capture, 24fps, no zoom transitions, monospace captions. Music: one royalty-free lo-fi track at 40% — cut it at 0:55. **Non-negotiable:** zero spinner time. Pre-render, splice, don't wait. The 0:00–0:10 ask→app open and the 0:18–0:32 memory payoff are the two money shots — shoot each twice, pick the crisper take.

### Video B — The 3-minute deep-dive (YouTube + landing page)

- **Goal:** convert a developer watcher into a `git clone` (or a hosted-demo click).
- **Narrative arc:** *Can I make it do new things? Does it remember? How fast? What does it make? Can I trust it?* — collections-led order.
- **Outline:**
  - 0:00–0:20 — Problem framing, in Satoshi's voice: "I worked on Windows for years. Claude Code is the kernel of an AI-native OS. But kernels need shells — and the shell should let *you*, not an engineer, define what the apps are. Here's the shell I wanted."
  - 0:20–1:00 — **Shock demo: build an app by asking.** Type "build me an invoicing app with line items and a PDF button" → a working collection app appears. Then show depth: a `ref` field links a client; a `derived` field computes the total; the portfolio's `value = shares × ticker.price` revalues when a quote changes. Call out: *the host has zero code about invoices or portfolios — every app is a schema Claude wrote. Applications as data; Claude as the runtime.*
  - 1:00–1:40 — **The compounding moment.** Ingest two related articles; show wiki backlinks appearing. Open a fresh session (simulated tomorrow morning) and ask a question — Claude answers grounded in the wiki it built itself. Call out: *the wiki is unstructured memory (what it knows); collections are structured memory (what it can do). Every other Claude client starts from zero. This one compounds.*
  - 1:40–2:10 — **Speed + output.** Open two more sessions in parallel: drop a research paper PDF in one (out comes a summary doc, a deck, a narrated MulmoCast video), refactor a real codebase in another. Call out: *"one browser tab, many Claude Code workers — and the answer is an artifact, not text."*
  - 2:10–2:30 — Autonomy + bridges. A scheduled source fires a morning briefing; the reading-list bell lights up (three keys of schema). A message from **Telegram** and **LINE** updates the desktop canvas live — same memory, same apps.
  - 2:30–2:50 — Trust layer. Docker sandbox banner. Show Claude *unable* to read a file outside the workspace. Frame against tools that run Claude directly on `~/`. Anti-wrapper line on-screen: *"Claude Code, directly. Zero domain code in the host."*
  - 2:50–3:00 — Open source, MIT. Hosted demo link + github link.
- **Production notes:** talking-head inset bottom-right for the first 20 seconds, then pure screencast.

### Video C — The 15-second loop (Instagram, LinkedIn, PH gallery motion)

- Single prompt → single rich visual result → fade to logo. Meant to be muted.
- Shoot 3 variants: **(a)** ask→app — "build me an invoicing app" → app appears (the lead), **(b)** update one quote → portfolio revalues live, **(c)** three parallel sessions running at once. Pick (a) for PH; post the other two on launch day. (Keep the MulmoCast-render and Telegram-round-trip clips warm as alternates.)

### Filming checklist (applies to all)

- Use a clean workspace (fresh `~/mulmoclaude/`) so the file tree isn't cluttered.
- Record at 1920×1080 minimum; export H.264 at 8 Mbps.
- Pre-compose all prompts in a text file — don't let live-typing slow the pace. Paste and hit send.
- Do a dry run with the exact network Claude will hit. Agent latency is the #1 demo killer.
- If a plugin takes >8s to render, **cut the wait** — PH viewers don't forgive dead air.

---

## 7. Launch Week Timeline (T = launch day)

### T-14 to T-8 — Asset build

- [ ] Finalize hero video, 3-min video, 3× 15s loops, 7 screenshots
- [ ] Register Product Hunt account, link to X, warm up with 2 comments on other launches
- [ ] Line up **4 hunters** who will commit to launch-day engagement. Brief them on the product in a 5-min Loom.
- [ ] Draft all tweets, LinkedIn posts, Reddit posts, HN post
- [ ] QA install on clean macOS, clean Windows WSL, clean Ubuntu — fix any friction
- [ ] Decide: do we ship a `npx create-mulmoclaude` or keep `git clone` as the CTA? **Recommendation: ship the npx wrapper, it halves the install funnel.**

### T-7 — Pre-announce

- [ ] "Coming Tuesday on PH" tweet with the 15s loop (no link)
- [ ] Post in r/ClaudeAI, r/LocalLLaMA teasers — product demos, not launch CTAs (Reddit hates launch posts)
- [ ] DM 10 Claude Code power users you know — ask for a Tuesday morning try + honest feedback

### T-3 — Warm-up

- [ ] Publish a **blog post** on the DSL-as-harness / applications-as-data thesis: *"What I learned letting users build apps by asking — a schema is a harness, and Claude is the runtime."* Builds on the Karpathy KB idea (the wiki is unstructured memory; collections are the structured rung past it). Source the argument from `docs/dsl-as-harness.md` + `docs/collections-architecture.md`. This is the intellectual anchor.
- [ ] Submit the blog post to HN. Don't mention PH yet.
- [ ] Draft the PH listing in Maker Studio (do **not** publish — just stage)

### T-0 — Launch day

- **00:01 PT** — Publish on PH. First comment goes up within 90 seconds.
- **00:05 PT** — Tweet thread (7 tweets: ask→app hook, 4 messages, anti-wrapper, CTA). Pin the tweet.
- **00:10 PT** — LinkedIn, Mastodon, Bluesky cross-post (adapted, not copy-pasted)
- **01:00 PT** — HN "Show HN: MulmoClaude – build apps by asking; a schema is the harness, Claude is the runtime" (the §8 title)
- **06:00 PT** — Reddit r/ClaudeAI post (value-first, not launch-y — "I built this, here's the wiki memory idea, here's the code")
- **09:00 PT / 12:00 PT / 15:00 PT / 18:00 PT** — Respond to **every** PH comment within 30 minutes. Non-negotiable.
- **17:00 PT** — Mid-day check: if we're not top-10, ship the Telegram bridge demo video as a fresh post and tag @ProductHunt.
- **21:00 PT** — Thank-you post regardless of placement. Name the top commenters.

### T+1 to T+7 — Compound

- Newsletter sends (dev.to, Hacker Newsletter submission, TLDR Dev pitch)
- Record a "Day after launch — what we learned" post. This outperforms the launch itself 30% of the time.
- Start the interview circuit: pitch the Changelog, Latent Space, and the Anthropic community call.

---

## 8. Channel-by-Channel Playbook

### X / Twitter

**Opening tweet (sells the click with the ask→app visual):**
> *"I typed 'build me an invoicing app with line items and a PDF button.' No code. No plugin. A working app just… appeared. This is MulmoClaude. [GIF]"*

**Launch thread (7 tweets) — Order: hook → 4 messages → anti-wrapper → CTA. Extensibility-by-asking leads; memory/autonomy/ownership follow.**

1. **[Hook — ask→app GIF]** *"I typed 'build me an invoicing app with line items and a PDF button.' No code, no plugin install — a working app appeared. You extend MulmoClaude by *asking*. Live on Product Hunt today. 🧵"*
2. **[Message #1 — Collections]** *Every AI app ships the features its engineers chose. This one grows new ones when you ask. Each app is a `schema.json` Claude wrote + plain JSON; Claude is the runtime. Update one stock quote → my whole portfolio revalues itself, no sync code. [portfolio gif]*
3. **[Message #2 — Memory]** *And it never forgets. A cross-linked wiki grows from every chat, automatically, in plain Markdown. The wiki is what Claude knows; collections are what it can do. ChatGPT Memory is a bullet list; Obsidian is inert. This is the moat. [wiki gif]*
4. **[Message #3 — Autonomy]** *It works while you sleep. Register a source → morning briefing. And apps wire into the notification bell with three lines of schema — my reading list pings me for every unread link. No notification code. [bell gif]*
5. **[Message #4 — Ownership]** *Your data AND your apps live in `~/mulmoclaude/` as plain text. `git push` is the backup. No cloud, no lock-in, no export flow. Your machine, your data, your agent. [folder + git gif]*
6. **[Anti-wrapper beat]** *This is not an API wrapper. It runs the Claude Code CLI directly — your auth, your tools, your files — and the host contains zero domain code. Every app is a schema you authored. That's why it can do what it does.*
7. **[CTA]** *Install with `npx create-mulmoclaude` or `git clone` — open source, MIT. One upvote on PH costs you nothing and means everything today: [link]* (If a hosted demo or `--demo` mode ships by launch, swap the first clause.)

### Hacker News

**Title:** `Show HN: MulmoClaude – build apps by asking; a schema is the harness, Claude is the runtime`

**Opening line of the body:** *"I let users extend the app by asking — 'build me an invoicing system' produces a working app with no code. The schema is the application; Claude is the runtime; the host contains zero domain code. Here's what I learned."* Then walk the thesis HN actually rewards — **a DSL is a harness; the user, not the engineer, now authors it** — sourcing the argument from `docs/dsl-as-harness.md` and `docs/collections-architecture.md`. Tie it to Karpathy: the wiki is *unstructured* memory (what the agent knows); collections are the *structured* rung past it (what it can do). Close with the AI-native-OS context. Explicitly state: *this runs the Claude Code CLI directly, not the API — that's why it can do what it does.* (Memory/autonomy/ownership are the supporting arc, not the lead, on HN.)

### Reddit (r/ClaudeAI, r/LocalLLaMA, r/selfhosted)

- NOT a launch post. A build log: *"I spent 8 months giving Claude Code a shell. Here's how users build their own apps by asking — and the wiki-memory idea underneath — and what I learned."*
- PH link at the very bottom, one line.

### LinkedIn

**Skip on launch day.** LinkedIn is a phase-2 channel for the productivity audience. Chasing it on day one splits focus and signals "enterprise tool" to PH voters scanning categories. Queue a LinkedIn post for T+3 once the dev wave has landed.

### Japanese community (Note, X-JP)

Satoshi has a strong JP audience. Ship a Japanese version of the maker post and the hero video captions. Launch-day JP tweet at 09:00 JST = 17:00 PT the day before — catches the Asia-Pacific vote window.

---

## 9. Hunters & Community Seed List

- **Hunter target:** someone with 5k+ PH followers, ideally in the Claude/LLM space. If we can't land one, self-hunt — Satoshi's direct network is strong enough.
- **Seed voter list:** 50 people who've starred the repo or engaged with MulmoChat. DM them a calendar reminder Monday evening.
- **Commenter priming:** 4–6 people who will leave substantive (not cheerleading) comments in hours 1, 3, 6, 9. PH's algorithm weights comment velocity and diversity, not just upvotes.

---

## 10. Risks & Mitigations

| Risk                                                   | Probability | Mitigation                                                                                                                           |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Activation gap — setup too heavy for PH day**        | **High**    | **Commit to an activation path by T-10 (see §10.5):** a hosted demo *if* we build one (currently not built), or `--demo` replay mode, or a scripted walkthrough. `npx create-mulmoclaude` alone = 50% drop-off. |
| Claude Code CLI auth fails on first run                | Medium      | Pre-flight check in the app; friendly error page linking to Claude Code docs                                                          |
| "It's just a wrapper" objection                        | Medium      | Lead with the anti-wrapper line verbatim: *"It runs Claude Code directly — not the API."* Reinforce with wiki + multi-session proof.  |
| Cognitive overload (too many features in one message)  | Medium      | Already addressed in §4 — collapsed to 4 rank-ordered messages, rest kept in reserve. Hold the line; don't let screenshots creep the list back. |
| Demo video latency from live Claude calls              | Medium      | Pre-record, splice, never show >3s of spinner                                                                                        |
| MIT + Docker read as "hacker tool, not safe"           | Low-Medium  | **Reframe:** sandbox = *"the level of care a real shell needs."* MIT = *"maximally permissive open source — fork it, ship it, use it commercially."* (MIT de-risks the license objection that AGPL would have created.) |
| Anthropic ships their own GUI the same week            | Low         | Frame as complementary — local-first, open-source, plugin-extensible                                                                 |
| PH algorithm — late US vote surge from JP timing       | Low         | JP launch tweet timed to catch evening-JP as launch-day-morning-PT                                                                   |

### 10.5 The activation problem — solve this or lose the day

This is the single biggest gap in the v1 plan. Reality check: even with `npx create-mulmoclaude`, the install path is **Node + Claude Code CLI auth + Gemini API key + Docker** — 5 to 10 minutes, developer-only, zero mobile. PH winners are instant gratification. We get upvotes mid-morning, then momentum dies by afternoon because nobody actually tried it.

**Three options, ranked by impact:**

**Option A (strongly recommended, but NOT yet built) — a hosted read-only demo**
- Pre-loaded workspace with ~10 prepared sessions, **led by the ask→app replay**: "build me an invoicing app" → app appears, plus the portfolio-revalues-on-quote-change interaction (the message-#1 wow). Then the "tomorrow, it remembers" memory moment, a scheduler catch-up, the reading-list bell lighting up, a wiki with backlinks, a multi-session snapshot, an ingested article → wiki page flow.
- Visitors click through existing artifacts and replay the canvas — no typing required, no auth, no API key, no Docker.
- Budget: ~3 engineer-days + hosting. Ship by T-3. **This is the single highest-leverage change in the entire plan, but we don't have a domain or instance yet.** If we commit, reserve a subdomain and provision a VM at T-10.
- If shipped, CTA in the hero video and every tweet becomes *"try it in your browser"* (with whatever URL we land on) instead of *"git clone"*.

**Option B (minimum viable) — "Watch Claude work" mode**
- A local mode that runs without a Gemini key or Claude auth, using pre-recorded session replays baked into the repo. `npx create-mulmoclaude --demo` drops the user into an interactive walkthrough in 30 seconds.
- Halves drop-off vs. a real install; doesn't match Option A but keeps the activation cost manageable.

**Option C (last resort) — Scripted screenshot walkthrough on the landing page**
- Click-through of the shock demo, parallel sessions, wiki backlinks, Telegram round-trip.
- No real interactivity but preserves the "I experienced it" feeling for PH skimmers.

**Decision:** commit to **Option A by T-7**. If scope slips, fall back to B before touching C.

---

## 11. Success Metrics

**Day of:**
- Product Hunt: **Top 5 of the day**; Top 10 is floor.
- GitHub stars: **+500** in 24h.
- **Activation-path sessions: 3,000 unique** if a hosted demo or `--demo` replay ships (§10.5); otherwise this line is N/A.
- Installs (Gemini key inputs as proxy): **500** if a demo absorbs casual traffic; **~1,500** if install is the only path (higher volume but lower quality — most drop off).
- PH comments: **50+ substantive** (not counting our team).

**Week of:**
- Stars: **+1,500 cumulative.**
- HN: front page for >2 hours.
- Twitter: 2M+ impressions on launch thread.
- 3+ inbound podcast/interview requests.

**Month of:**
- 2,000 active weekly users (sessions logged).
- 5 community-contributed custom roles or plugins.
- One mention by @karpathy, @alexalbert, or an Anthropic engineer (aspirational but trackable).

---

## 12. The Two Bets

There are two things we have to land. Miss either and the launch is a 6 out of 10.

**Bet 1 — The ask→app + memory sequence (earns the upvote).**
The hero video's 0:00–0:32 window, as one breath: **(a)** a user types "build me an invoicing app" and a real app appears — *no code, no plugin* — followed by the portfolio revaluing itself when a quote changes; then **(b)** a fresh session "tomorrow" asking a question that touches yesterday's work, and Claude answering grounded in the wiki it built itself. Lead with the novelty (ask→app — the thing *no competitor can show*), land with the moat (memory — the thing that makes leaving painful). Together they make the whole pitch visible: *every AI app has a fixed feature set and every AI agent has amnesia — this one cures both.* Without the ask→app open, we're "another Claude wrapper with a pretty UI." Without the memory close, we're "a neat no-code toy." With both, we're a new category.

**Bet 2 — The activation path (earns the try).**
A zero-install way for a PH skimmer to experience the ask→app moment and the memory moment. Today this means one of: (a) a hosted read-only demo if we commit to building it before T-3 (§10.5 Option A, currently NOT built — and it MUST include a "watch an app get built by asking" replay plus the portfolio-revalue interaction), (b) `npx create-mulmoclaude --demo` with pre-recorded session replays baked in (§10.5 Option B), or (c) a scripted screenshot walkthrough on the landing page (§10.5 Option C). Without *one* of these, the upvote from Bet 1 doesn't convert into a star, a follow, or a build. **Decision owed by T-10.** Bet 1 gets you noticed; Bet 2 gets you remembered.

Everything else in this plan — bridges, sandbox, roles, wiki tour, skills launcher, multi-modal output, parallel sessions — is confirmation bias for a viewer who already believes. Cut anything that doesn't serve one of the two bets.

---

## 13. The Story Underneath (why we're doing this at all)

The PH-day frame is *"ask for an app and it appears — no code — and it never forgets."* But the deeper frame — the one we hold for HN, for long-form writing, for the people who want to know where this is going — has two legs.

**Leg one: every AI agent today is homeless.** They have no persistent filesystem, no schedule, no memory that compounds. They're summoned, they work, they're gone. That's not an agent. That's a function call. MulmoClaude gives the agent a home: `~/mulmoclaude/`. A bookshelf (the wiki), filing cabinets (documents), a workshop where the user builds new tools (collections), a calendar (the scheduler), phones (the bridges). Because it has a home, it accumulates. Because it accumulates, it gets smarter. Because it gets smarter, it can be trusted with more autonomy. Memory → compounding → trust → delegation. That's the loop this plan is trying to open.

**Leg two: the user designs the environment, not the code.** The lesson of 2025–2026 agentic engineering is that the *harness* — the designed environment an agent works inside — matters more than the model. A deliberately-limited language (a DSL) is one of the best harnesses there is: it gives up expressive power in exchange for a small, legible, *validatable* surface the agent can't drift outside of. MulmoClaude runs on two such DSLs — **MulmoScript** (the agent writes a script; a deterministic renderer makes the video) and **Collections** (the *user* declares a schema; Claude is the runtime). The radical move is the second one: **harness design, historically an engineer's job, gets handed to the end user.** A non-programmer who declares a collection schema is — without knowing the word — designing the environment an agent will operate in. Applications stop being code engineers write and become *data users author*. That is the shift this product is a first draft of, and it is developed at length in [`docs/dsl-as-harness.md`](../docs/dsl-as-harness.md) and [`docs/collections-architecture.md`](../docs/collections-architecture.md) — the intellectual anchors for the HN post and the launch blog.

This is the first visible surface of a much bigger thesis: **computing is being re-platformed on top of AI agents, and the shell that platform needs doesn't exist yet.** Claude Code is the kernel. MulmoClaude is the first draft of the shell, and the shell's user-facing form is that single folder that every input flows into and every output comes out of. In 1975 the home directory was where your files lived. In 2026 it's where your files, your research, your conversations, your scheduled work, and the knowledge extracted from all of them live — maintained by an AI that knows what to remember, what to file, and eventually what to schedule on its own.

That last clause matters. **Both memory and scheduling should become autonomous.** Today, MulmoClaude remembers automatically but still asks the user to set up schedules by hand. The endgame is an agent that decides for itself what to repeat, what to watch, what to summarize every morning — the way it already decides what's worth writing into the wiki. Everything the user does (searches, temp notes, generated images and videos, scheduled outputs) flows into the same memory and is available from any session, any device, any time. At that point, "MulmoClaude" stops being a tool you open and becomes an ambient collaborator that's already been working.

If the launch goes well, we're not celebrating a successful product launch — we're announcing the existence of a new computing surface. Phase 2 audiences (productivity users, knowledge workers, JP market, enterprise) come later, pulled in by the dev-native gravity we establish on day one.

That framing is what makes this plan aggressive rather than cautious. We're not trying to be a "very advanced tool." We're trying to show a glimpse of the future of computing, through one sharp product.

---

*Prepared for the MulmoClaude launch. Revise after the asset dry-run at T-7. **Activation-path decision owed at T-10** — pick one of §10.5 Options A / B / C. This is the critical-path item.*

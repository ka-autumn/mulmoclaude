# HN Submission Plan

Everything you need to submit MulmoClaude to Hacker News. Read top to bottom on submission day.

---

## Pre-submit checklist

Do these IN ORDER before clicking Submit.

- [ ] **The PR is merged to `main`.** The HN link goes to `main`; if the PR is still open, HN readers see the old README.
- [ ] **Visit https://github.com/receptron/mulmoclaude in a private/incognito browser tab.** Confirm the new platform-positioning hero ("MulmoClaude is an open-source, AI-native application platform...") and the MANIFEST.md blockquote are visible at the top.
- [ ] **Check the time.** Submit only **Tuesday / Wednesday / Thursday, 8–11am Pacific Time**. Outside that window, hold the submission until tomorrow morning PT.
- [ ] **First comment is in your clipboard** (the block below in this file). The maker comment must appear within ~60 seconds of submission.
- [ ] **You have 6 hours free** to respond to comments after submitting. The first 6 hours determine ranking more than the title does.

---

## Submission fields

Go to https://news.ycombinator.com/submit. Three fields:

### title (copy exactly)

```
Show HN: MulmoClaude – chat summons GUIs, applications are plugins
```

Notes:
- The dash is `–` (en dash, `Option+-` on Mac, U+2013). HN accepts both `–` and `-`; `–` reads cleaner.
- 64 chars — well under HN's 80 char limit.

### url (copy exactly)

```
https://github.com/receptron/mulmoclaude
```

### text (leave EMPTY)

Do not fill in this field. The first comment goes as a manual comment after submitting, where it's editable for ~2 hours.

---

## Click Submit. Then immediately post this as the first comment:

```
Maker here.

MulmoClaude is an open-source application platform where Claude (via the Claude Agent SDK) acts as a universal controller across a plugin registry. Real applications running on it today: a full accounting system (with server-side bookkeeping logic), the Encore obligation engine, a personal wiki, and an Edgar SEC-filings reader.

The two claims in the title:

**"Chat summons GUIs"** — the agent's reply isn't a string. It picks a format for the content: Markdown for prose, MCP tool invocations for GUI surfaces (chart, form, wiki, spreadsheet, 3D scene), MulmoScript for multimedia. The chat input is the address bar; what arrives is whatever the content demands.

**"Applications are plugins"** — each plugin contributes one or more MCP tools to the agent. The agent composes across them in one turn. "Summarize Q1 expenses as a chart" reads accounting, writes chart. No app-switching, no copy-paste between apps.

The architectural argument is in [MANIFEST.md](https://github.com/receptron/mulmoclaude/blob/main/MANIFEST.md) — three commitments (universal controller / chat summons GUIs / open protocol extending MCP) plus the patterns proven by the accounting and Encore plugins.

Install: see the [Quick Start in the README](https://github.com/receptron/mulmoclaude#quick-start) — needs Node 20+ and the Claude Code CLI installed and OAuth'd.

Three things I'd genuinely value HN feedback on:

1. Does the **agent-as-universal-controller** framing hold up against your mental model of MCP?
2. Is `gui-chat-protocol` the right abstraction shape for "the agent and the GUI need to talk"?
3. What other plugin patterns (beyond *API+UI+Agent* and *NL→DSL→engine*) should this architecture handle?
```

---

## First 6 hours: engagement playbook

- **Refresh the HN page every 10–15 minutes.** Reply to every comment.
- **Lead with acknowledgment.** "Good question" / "You're right that..." opens better than "Actually..."
- **Clarify, don't argue.** If someone misunderstands, restate; don't push back on tone.
- **If someone is wrong about a fact**: "Yes, and the nuance is..." not "No, you're wrong."
- **If someone is hostile**: still answer the technical substance, ignore the tone. The thread audience reads tone; punishing matched hostility is the default HN move.
- **If you don't know**: say so. "I don't know, but my guess is X — would value your read on this."
- **Don't argue with downvotes.** Just keep engaging substantively.

Stop after ~6 hours. Diminishing returns past that, and threads drift.

---

## What to expect

- **Best case**: front page, 200+ upvotes, 50–100 comments, traffic spike, GitHub stars, install attempts.
- **Median case**: 30–80 upvotes, 10–30 comments, modest traffic. Still valuable signal.
- **Worst case**: dies in /new with single-digit upvotes. Move on; the manifesto and repo still benefit.

HN is lottery-like. Title + timing + first 6 hours of comments matter more than the project quality, frustratingly. Don't read karma as quality.

---

## After HN

- **Save the HN URL** to share on X/LinkedIn after.
- **Wait ~10 days** for HN traffic peak to recede before PH launch.
- **Watch GitHub Issues** for installs that fail — common HN traffic outcome.
- **Reach out to commenters who installed it** with friendly follow-up.

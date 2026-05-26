---
name: mc-profile
description: The user's own business profile — the issuer ("bill-from") identity used on invoices. A singleton collection with exactly one record, id `me`. Skill files live at `.claude/skills/mc-profile/` (SKILL.md + schema.json); the record lives at `data/profile/items/me.json`. The user views and edits it at `/collections/mc-profile`, rendered from the schema by the host — you do all I/O via Read / Write / Edit on the JSON file.
---

# Business Profile (schema-driven collection)

A bundled MulmoClaude preset skill (`mc-` prefix = launcher-managed; do not edit
this file in the workspace, it is overwritten on every server boot).

This collection holds the user's **own** business identity — the "bill-from"
side of an invoice (company name, tax ID, address, payment details). It is the
counterpart to `mc-clients`, which holds the "bill-to" parties.

## Singleton — exactly one record, id `me`

Unlike `mc-clients` (many clients) this collection has **one** record. Its
primary key is always the literal string `me`, stored at
`data/profile/items/me.json`. Never create a second record and never invent
another id — read, create, and update `me.json` only.

## Files

| Purpose | Path |
|---|---|
| This skill's instructions (you are reading it) | `.claude/skills/mc-profile/SKILL.md` |
| Field schema (source of truth for the host UI) | `.claude/skills/mc-profile/schema.json` |
| The record — the one and only profile | `data/profile/items/me.json` |
| User-visible collection surface | `/collections/mc-profile` (in the host UI) |

You write JSON; the host's `<CollectionView>` reads the same file and renders a
form. There is no separate database — the workspace IS the database.

## Record shape

The schema declares these fields (read `schema.json` for the authoritative
types):

- `id` — string, **primary key**, always `me`
- `companyName` — string, **required** (the legal/company name shown on invoices)
- `taxRegistrationId` — string (VAT / EIN / JP T-number — region-dependent)
- `email` — email
- `phone` — string
- `address` — multi-line text
- `paymentDetails` — markdown (free-form bank / wire / PayPal instructions, so
  it isn't tied to any one country's bank-account structure)
- `defaultBookId` — string (the accounting book the invoice bookkeeping actions
  post journals into; the `accounting` role reads it to skip book selection.
  Leave unset and the role resolves the book at posting time)
- `notes` — markdown

Leave optional fields the user hasn't given you out of the JSON entirely — don't
push for every field.

## What to do

**Set up / update**: read `data/profile/items/me.json` (it may not exist yet),
merge the changes, write it back. Preserve fields you weren't asked to change.
If the file doesn't exist and the user wants to set their profile, create it
with `id: "me"` plus whatever fields they provided.

**Look up**: read `data/profile/items/me.json` and answer from it. If it's
missing, tell the user their business profile isn't set up yet and offer to
collect it (use `presentForm` only if several fields are needed at once).

**Never delete** the profile unless the user explicitly asks to reset it.

## Linking to the profile in chat

When you reference the profile in your reply, link to the collection view — NOT
the raw JSON file path:

- Do: `[your business profile](/collections/mc-profile?selected=me)`
- Don't: `[profile](data/profile/items/me.json)` — that opens the raw file in
  the Files view instead of the rendered form.

## When to ask vs. when to act

If the user gives you the details in a sentence, just write them. Use
`presentForm` only when you genuinely need several fields they haven't
provided — don't use it to re-confirm values they already typed.

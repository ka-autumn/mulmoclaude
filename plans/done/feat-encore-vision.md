# Encore — the experience and why it matters

## The shape of the problem people are actually living with

Most adults run a long, quiet backlog of recurring obligations:

- Filing taxes once a year, with a multi-week gather phase, a CPA to email, and last year's return as scaffolding.
- Property tax twice a year — pay, archive the receipt, prove it later if asked.
- An annual physical where the *interesting* part is the trend across years: which numbers crept up, what the doctor flagged for next time.
- Car registration and inspection, where the same shop usually catches the same problems and you'd like to remember which ones.
- Christmas cards: who you sent to, who replied, whose address changed, who you decided to skip this year and why.
- Birthday and anniversary gifts: what you gave last time, how it landed, ideas for next time.

None of these fit cleanly into a todo list, because each instance is not a fresh task — it is a continuation of last year's. None of them fit a calendar, because the deadline is the easy part; the substance is what surrounds it. Bill trackers reduce them to "remind me X days before." Recurring todo apps treat each repetition as a one-off and force you to type everything again. Compliance tools price themselves at companies, not at people.

What's missing is the part of the experience that everyone actually wants: **last year's version, sitting in front of you, ready to be edited into this year's version.** Not re-entered. Edited.

## How Encore lives inside MulmoClaude

Encore is a feature of MulmoClaude — the way Wiki is, the way Todos is. It has its own page and its own icon: open it directly when you want to browse your obligations, look at this year's open instances, or scroll through past years' Christmas card lists. Notifications from Encore appear in MulmoClaude's bell alongside everything else. That part is familiar.

What is *not* familiar — and what makes Encore particular to MulmoClaude — is that **the page is not the front door.** The front door is chat with Claude.

One evening, in the middle of an unrelated conversation, you say: "I need to pay real estate tax for my second home, twice a year." Claude — powered by Claude Code beneath MulmoClaude — recognizes the shape of what you said. It opens a small form right in the chat: the address of the property, the months you typically file in, how much warning you want before each deadline. Three or four fields. You fill them in. Claude confirms — the obligation is set up, the next due date is six months out, you'll be nudged three weeks before — and the conversation moves on.

You did not pick "Encore" from a menu. You did not navigate to a "create new obligation" page. You did not have to decide whether what you just described was a todo, a calendar event, a document, or a checklist. You said the thing in English; Claude turned it into the right structure behind the scenes.

The same holds for everything that comes afterward: marking an item done, snoozing a reminder, asking what changed from last year, adding a recipient, swapping a CPA's email, closing out an instance. You *can* do these by clicking through the Encore page if you prefer — and sometimes you will, especially when browsing or reviewing. But the default, the surface the experience is designed around, is chat. Claude understands what you mean, asks for the few things it cannot infer, and calls the right Encore action behind the scenes.

This is what makes Encore *of* MulmoClaude rather than next to it. The chat is not a thin layer over a forms-driven app. The chat is the app. Encore is one of the things the chat knows how to do.

## What it feels like

It is mid-November. You are in MulmoClaude, doing something else entirely — chatting with Claude about a piece of work, reading your news digest, editing a wiki entry. A small note appears in your notifications: "Christmas cards — 24 days." You click.

The page that opens already has last year's recipient list. Each name is already marked: *sent*, *replied*, *skipped*. Beside the list, a short note: "Last year you forgot the Tanaka family — they're already on this year's list. The Watson family moved in March; their address is unconfirmed. The Lee family is new and not yet on the list."

You spent zero seconds remembering any of that. You spend the next two minutes adjusting the diff: confirm Lee, mark Watson as "skip until address," add a niece who got married this year. The list is ready. You go back to what you were doing.

A different scene, late March — six months after the chat where you set up the property-tax obligation by saying it. You are mid-conversation with Claude about something unrelated. The notification badge in the corner glows amber — your sign that something needs you today, not just eventually. You open it: "First-half property tax — bill received, not yet paid." The page shows the bill (you scanned it last week), the same payment portal you used last year, and a one-line note from your past self: "the portal logs you out after 10 minutes — have your account number ready." You pay. You mark it paid — by telling Claude "paid the property tax" in chat, or by clicking the checkbox on the page; either works. The reminder vanishes. Six months from now the same flow runs again.

A different scene again, January. You are talking to Claude about something work-related, and your CPA's question about your W-2 comes up. You don't want a reminder on a calendar date — you want a reminder *when the W-2 actually arrives*. You tell Claude. Claude asks one clarifier — "when you mark the W-2 received, that's the trigger?" — and the conditional reminder is set. The conversation moves on. Three weeks later, the moment you mark the W-2 as received, a notification appears: last year's CPA email thread; the document checklist with what you've already gathered already checked off; the three things that were different last year that you should ask about this time.

Across all three scenes, two threads run together. The obligation has memory of itself — each recurrence is the next page of a story, not a blank form. And the obligation is run from chat — set up by saying it, advanced by saying it, asked about by saying it — with a page available when you want to look directly at the data.

## The six moments we are designing for

1. **The setup-by-saying moment.** You describe the obligation in plain words, in chat. Claude asks for the few missing pieces — exact months, an address, reminder preferences — through a small form right in the conversation. The obligation is set up. You never picked "Encore" from a menu, never filled out a "new obligation" page, never had to choose what *kind* of thing this was. You said it; Claude did the bookkeeping.

2. **The carry-forward moment.** When a notification lands you on a new instance — the first second you see "this year's tax filing" — last year's content is already there, with a short, Claude-written summary of what is likely to be different. This is the magnetic moment. If we get nothing else right, we get this.

3. **The right-grain reminder.** A reminder is never just "tomorrow at 9 a.m." It is "you usually need three weeks to gather these documents, and you haven't started." Or "you've checked off five of twenty-five recipients and the deadline is in seven days." Or "your W-2 arrived an hour ago — you said to wake you when that happened." The reminder is aware of the state of the work, not just the date. It rides MulmoClaude's notification surface; it does not invent its own.

4. **The diff moment.** Standing inside an instance, you can ask Claude — in the same chat you use for everything else — "what's different from last year?" and get a real answer, name by name, line by line. This is the moment that vindicates the whole app's thesis: Claude is reading two folders of plain files and telling you what changed.

5. **The conditional moment.** "Remind me when X happens" is a first-class verb, expressed in chat like anything else, not a workaround. The user describes the condition; the app does not fire until the user's own action satisfies it. This is what no calendar app and no todo app can do, because they have no model of the work itself.

6. **The closing moment.** When an instance ends — you mailed the cards, you paid the tax, you went to the appointment — closing it is one click on the page or one sentence in chat, and it silently provisions next year's instance with everything that should carry forward and nothing that shouldn't. The user does not "set up" next year. Next year sets itself up, and reaches them, when the time comes, through the same calm notification.

## Tone and feel

The category — taxes, doctors, money, family — is high-stakes; the interaction must be the opposite. Four principles:

- **Quiet by default.** Most days, nothing about Encore is visible. When it speaks, it has a reason.
- **Conversation is the default surface.** Almost everything you do with Encore — set it up, modify it, ask about it, close it out — you do by saying it to Claude. The Encore page exists and is useful for browsing and direct review, but it is the second-line surface, not the first. Most users will spend more time talking *about* their obligations than clicking *on* them.
- **The system picks the shape; you provide the content.** When you describe an obligation in chat, Claude figures out whether it's a fan-out (Christmas cards), a multi-step pipeline (property tax: received → paid → confirmed), or a simple annual checkpoint (the physical), and sets it up accordingly. You should never have to choose between "todo," "event," "checklist," and "document" before saying what you mean.
- **The user owns the data, visibly.** The files are real files in a real folder, in the same workspace MulmoClaude already keeps for everything else. A user who wants to read their own history outside the app can. This is a property we can show, not just claim.

## Why this matters to MulmoClaude

MulmoClaude's central bet is **the workspace is the database, files are the source of truth, Claude is the intelligent interface.** Most of the app's existing surfaces are decent demonstrations of this idea, but each of them — chat, wiki, todos, calendar, sources — is a feature another app could plausibly clone with a relational schema and a search bar. They make the architecture *defensible.* They do not make it *necessary.*

Encore is where the architecture becomes necessary — and Encore is not a sibling product. It is a feature of MulmoClaude that could not exist anywhere else.

- **The interaction model is genuinely chat-first.** Setting up a recurring obligation in any other app means filling out a form: pick a category, type a title, choose a recurrence rule, click through. In MulmoClaude, you say it. Claude asks, through a small in-chat form, for the few details it cannot infer, and writes the obligation. This is not a chat *wrapper* on top of a forms app — it is forms in service of chat. Encore is the most legible demonstration of that distinction.

- **The data is irreducibly heterogeneous.** A scan of last year's tax return; a CPA's email thread; a Christmas card list with addresses, photos, and a free-form note; a doctor's lab results. There is no schema for this. There is, however, a folder for it — the same kind of folder MulmoClaude already organizes everything else around. Files in folders are the only representation that doesn't either lose half the information or balloon into a hundred-table database only its designer understands.

- **The hard task is genuinely an LLM task.** "Read last year's instance, draft this year's, summarize what is likely different." A traditional app cannot do this — it can copy fields, but it cannot read the free-form note that says "the Tanakas had a rough year, soften the message." Claude can. And Claude is the central element of MulmoClaude already; Encore does not import a new dependency, it leans harder on the one already at the core.

- **The privacy story is built in.** Tax documents, medical history, gift lists for spouses — these are exactly the things a sensible person will not put into a cloud-hosted service. Local-first is not an architectural preference here; it is the precondition for the user trusting the app with the data at all. MulmoClaude is local-first by construction; Encore is the feature where that property becomes the difference between "this exists" and "this does not."

- **Memory across instances is what makes the whole app sticky.** Most apps' value is proportional to what you can do with them today. Encore's value compounds: year two is more valuable than year one, year three more than year two. By year three, leaving MulmoClaude means leaving behind the only place that knows you skip the Watsons and that the property-tax portal logs you out after ten minutes — and the only place where you can simply *say* "add the new neighbours" and have everything end up in the right shape. That is not a feature. It is the moat for the whole product.

- **It is the canonical demonstration of what MulmoClaude is for.** Every other surface — chat, wiki, sources, todos, calendar, the notification system itself — exists in service of the kind of work Encore makes vivid: long-running, file-shaped, memory-rich, lightly structured, deeply personal, and entered through conversation. Encore is the most legible example of why we built any of the rest. New users understand MulmoClaude faster after seeing Encore than they would after seeing chat alone.

If MulmoClaude is right about anything, it is right about this kind of obligation. Encore is where we find out whether the bet works — and Encore can only be built here, inside the app whose principles make it possible.

## What success looks like

A user who has been on MulmoClaude for two years says, unprompted, "I can't believe I used to do this without it." The thing they are describing is not a feature; it is the absence of friction they had stopped noticing. They don't say "the reminders are good." They say "I forgot the Tanakas one year before all this, and I haven't forgotten anyone since."

A user new to MulmoClaude mentions an obligation in chat, fills in three fields when Claude asks, and then forgets about it — exactly as intended — until the right notification finds them weeks later. They never read documentation. They never wonder whether the obligation belongs in some other app.

A skeptical observer asks, "what makes this different from a folder of files?" — and the answer is "nothing, except you set it up by saying it, Claude reads the folder, the notifications wake up at the right granularity, and the user never sees the seam between any of it."

That is the experience. That is why it belongs in this app — not next to it, not on top of it, but as part of it. That is what we are building.

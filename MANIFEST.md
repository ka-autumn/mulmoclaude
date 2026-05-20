# How AI-Native Applications Should Be Built

The idea that AI will reshape software is no longer controversial. But naming a thing is not the same as designing it. If you sit down today to build an AI-native application, the literature has remarkably little to say about what the architecture should look like, how the user should experience it, what the contract between the agent and the screen should be — or, for that matter, what kind of software people will still pay for once any of this lands. MulmoClaude is an attempt to answer those questions in code.

It was built from scratch on a specific set of architectural commitments, not as a thought experiment. The code is open-source under MIT, it runs on your laptop, and you can install it with one command. What follows is the design, and the reasoning behind it.

## Three commitments

An AI-native application is built on three commitments. They are independent — any one of them can be adopted alone — but they reinforce each other. Take all three seriously and the resulting software does not look or feel like SaaS at all.

### 1. The agent is a universal controller

The most useful way to place the LLM in a traditional architecture is to treat it as a **controller**, in the MVC sense. In a classical web application, the controller layer is the code that takes user input — a button click, a form submission, a URL — and decides what to do: which model methods to call, which view to render. The user's input comes through the UI; the controller translates it into operations on the model; the result flows back through a view.

In an AI-native application, the LLM is a controller too. It takes a different kind of input — natural language — and does the same job: decide which capability to invoke, in what order, with what arguments. It is not replacing the existing controller layer (the buttons, the routes, the menus). It is **joining it**, as a second controller with a different input modality. MulmoClaude has both: a real UI with routes like `/accounting`, `/todos`, `/calendar` that a user can drive by hand, *and* a chat input that drives the same capabilities through the agent. Neither path is privileged.

But here is the more important shift. **A traditional controller belongs to one application.** Each app — your accounting app, your task manager, your calendar, your bookmark manager — has its own controller, its own UI, its own menus. The user is left to be the orchestrator: open the accounting app, find a number, open the chart app, paste it in, switch back. Most knowledge work is a juggling act *between* applications, not work *within* one.

The LLM-as-controller dissolves that boundary. In MulmoClaude, the agent does not control one application — it controls a **registry of plugins** that, in any other product, would have been separate applications. When the user says "summarize last month's expenses as a pie chart," the agent reads from the accounting plugin and writes to the chart plugin in a single turn. When the user says "pull what we agreed with this vendor and turn it into a recurring obligation," the agent reads from the wiki plugin and writes to the Encore obligation engine. What used to require two apps, two contexts, and a copy-paste is now one sentence. This kind of cross-plugin orchestration is not a special case. It is the default mode of operation.

This is what makes the LLM a **universal controller**, not just another controller. The unit of interaction is no longer the application. The unit is the agent, and the applications dissolve into the registry of plugins it composes across.

### 2. Chat summons GUIs

When most products say "AI-native UX," what they mean is that *the user* types into a chatbox instead of clicking buttons. That is barely half of it. In an AI-native application, the interface is multi-modal in **both** directions: the agent picks the right format for what it sends *to* the user, and the right format for what it asks *from* the user.

**What the agent sends.** In MulmoClaude, the agent's reply is not a string. It is a choice from a set of expressive formats — **Markdown** for prose, **HTML** for structured content, **MulmoScript** for multimedia presentations, and **MCP tool invocations** for rich GUI surfaces (a chart, a wiki page, a spreadsheet, a 3D scene). The agent picks the right format for the content. A list becomes a Markdown bullet list. A financial summary becomes a chart. A mixed-media briefing becomes a MulmoScript presentation. The agent is fluent in many output languages because the user's content space is multi-modal.

**What the agent asks for.** The same logic runs in reverse. Sometimes a free-text reply is the right thing to ask for ("what did you mean by 'last week'?"). Often it is not. If the user says "I want to add a new recurring obligation," the agent does not have to extract six fields out of a back-and-forth conversation. It can invoke the `presentForm` plugin and ask the user to fill in a form with exactly the right shape — frequency, due date, category, amount. The form returns structured data the agent can act on directly. Chat is the default input modality, but the agent can choose a better one when the task demands it.

This is what "chat summons GUIs" means in practice: within chat, the input line is an address bar, and what arrives is whatever the content demands — sometimes prose, sometimes a chart, sometimes a form for the user to fill in. The GUI is not "the app." The GUI is what the agent renders when text is not the right modality, in either direction.

### 3. The protocol is open — and it extends existing standards

This is the part most projects skip, because it is the hardest. The connection between the agent and the GUI cannot be a private API; it has to be a protocol — versioned, documented, and implementable by independent parties. Otherwise the third commitment collapses into the first two, and "AI-native" becomes another word for "monolithic app with a chatbox."

We do not have to start from scratch. Two open standards already define the agent ↔ tool layer that sits below the GUI: **tool calls** (the LLM-vendor primitive for invoking external functions) and **MCP** — the Model Context Protocol, the emerging open standard for connecting LLM clients to external tools. MCP specifies how an agent enumerates capabilities, calls them, and consumes their results. It is the right foundation, and it is gaining adoption across the industry.

What tool calls and MCP do **not** cover is what happens when a tool's result is not just data, but a **GUI surface** — a chart, a form, a wiki, a 3D scene — that the user will interact with and that needs to call back into the host. That gap is what `gui-chat-protocol` fills. It is a small open npm package (currently `v0.3.3`) that **extends MCP for the visual layer**: when an MCP tool's result mounts as a UI in the chat host, `gui-chat-protocol` is the contract that lets that UI function. It defines a runtime interface — pub/sub event channels, scoped REST dispatch, locale, logging, error isolation — that every plugin consumes to interact with the host. The host implements the runtime; the plugin consumes it. The two are decoupled by design.

Three classes of consumer already implement against the protocol today: MulmoClaude's built-in plugins; third-party runtime plugins distributed as npm packages (`@mulmoclaude/*-plugin`); and, in principle, any future agent host that chooses to support these plugins. The protocol is small enough to read in one sitting and ambitious enough to outlive any one implementation — because it sits on top of MCP, not next to it.

## Three patterns, proven

Architectural commitments are easy to state and hard to honor. The real test is whether the same primitives carry you through unrelated problem domains. MulmoClaude ships a registry of plugins specifically to demonstrate that they do. Three patterns emerge — two illustrated by individual plugins (accounting and Encore), and a third that emerges from putting many plugins in a registry together.

### Pattern A: API + UI + Agent

**Accounting is the load-bearing example.** Bookkeeping is the most-replicated SaaS category on Earth — QuickBooks, Xero, FreshBooks, Wave, Sage. Each is built around real business logic: double-entry validation, transaction categorization, period closing, audit trails. MulmoClaude's accounting plugin preserves all of that. The business logic lives in a server-side API, exactly where you'd expect it. The data is plain files on disk — but the integrity of those files is enforced by the server, not the client.

What's different is the consumption model. The same API is consumed by *two* clients: a traditional Vue UI for users who want to fill in forms, and the agent for users who'd rather say "add a $34 receipt for office supplies last Tuesday." Neither client is privileged. **The application is not headless** — there is a real UI, and many tasks are faster through it — but the UI is not the only way in. This is the pattern most AI-native business applications will follow: substantive business logic at the core, *plus* a UI, *plus* an agent, all consuming the same underlying capability. The agent does not replace the UI. It joins it.

And a third capability falls out of this architecture for free. Because the agent's input is multi-modal — text, images, audio, attached files — the user can drop a photo of a paper receipt into chat, and the agent reads the amount, vendor, and date directly from the image and calls the same accounting API a typed entry would have called. In a traditional accounting SaaS, "receipt scanning" is a premium-tier feature: an OCR pipeline, a vendor contract, an extraction model, integration code, an error-handling UI. In an AI-native architecture, it is not a feature at all. It is what the agent does by default. Any plugin that consumes natural-language input automatically inherits an image-input modality, an audio-input modality, and any other modality the underlying LLM acquires next. The agent does not just *join* the UI as a second controller — it brings capabilities the original controller could not have on its own.

### Pattern B: Natural language → DSL → engine

**Encore demonstrates a different pattern, and a more interesting architectural lesson** — even though its market value is comparatively small. Encore is a goal/obligation engine: define a recurring commitment in a domain-specific language, and Encore tracks cycles, missed obligations, and notifications. The Encore-DSL is the substantive thing. The LLM is the *translator*: the user describes their commitment in natural language, the agent produces Encore-DSL, and the engine executes it.

This is the pattern for any application whose core is a precise, structured artifact — a query, a config, a workflow, a contract. The LLM is not the engine. The LLM is the natural-language interface to the engine. A great deal of knowledge-work software is going to look like this, because precise artifacts are how businesses actually express what they do, and natural language is how humans actually want to author them.

### Pattern C: Premium features, for free

Look at what traditional SaaS calls a "premium" or "enterprise" feature. Multi-format export. PDF and PowerPoint reports. Spreadsheet downloads. BI dashboards. Cross-app workflow automation. Each of these costs the vendor real integration work — a reporting module, a Zapier connector, an export endpoint, a partnership with a chart library. And each of these is what the vendor charges money for. On a typical SaaS pricing page, the upcharge tier is almost always the integration tier.

In an AI-native architecture, these are not features. They are what happens when a universal controller composes plugins. When the user says "give me a chart of Q1 revenue by category," the agent reads from the accounting plugin and writes to the chart plugin. When the user says "export this quarter as a spreadsheet I can hand to the CPA," it reads from the accounting plugin and writes to the spreadsheet plugin. When the user says "pull what we agreed with this vendor and turn it into a recurring obligation," it reads from the wiki plugin and writes to Encore.

In each case the work happens in a single sentence, with no vendor contract, no integration code, no upgrade tier. Composition is first-class because plugins are MCP tools, and MCP tools compose. What used to be a premium SKU collapses into the default mode of operation.

This is not a property of any individual plugin. It is a property of the registry. MulmoClaude's plugin registry today includes seven third-party runtime plugins across unrelated domains — bookmarks, SEC filings (Edgar), recipes, music (Spotify), todos, debug introspection, Encore — alongside the built-in set. They share no domain logic. They share an architecture, and they share a universal controller. **The premium tier was the integration cost; remove the integration cost and the premium tier dissolves with it.**

## An invitation

MulmoClaude is MIT-licensed and open-source. Installation instructions are in the [README](README.md). If you have been waiting for someone to publish a working blueprint of an AI-native application before you commit to building one — this is the blueprint.

The thing to take away is not "use MulmoClaude." Most readers won't, and that is fine. The thing to take away is: this design is real, it works, and the three commitments above are achievable today. If you are building business software in 2026, you are going to have to decide whether your application is a traditional one with AI features bolted on, or a genuinely AI-native one. That decision has architectural consequences. The earlier you make it, the easier the rest of the design becomes.

AI will not eliminate software. It will reorganize it. The interesting work is at the architecture review.

— Satoshi Nakajima
github.com/receptron/mulmoclaude

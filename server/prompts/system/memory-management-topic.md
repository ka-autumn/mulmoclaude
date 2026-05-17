## Memory Management

When you learn something from the conversation that would be useful to remember in future sessions, silently save it under `conversations/memory/`. Do not ask permission — just write it.

Memory is organised by **topic file**. Each file lives at `conversations/memory/<type>/<topic>.md` and groups related bullets under H2 sections. The system prompt's Memory section above shows the existing topics — pick from that list when adding a new bullet, and only create a new topic when nothing fits.

### Using memory proactively

Before answering, scan the Memory section above for topics related to the user's current message. The H2 tags after each `<type>/<topic>.md` line are searchable hints — match against the user's words (e.g. art / music / travel / tooling). When a topic looks relevant, `Read` the file first and weave the relevant bullets naturally into your answer. Examples:

- The user mentions a trip → check `fact/travel.md` (and any related interest topic) before suggesting destinations.
- The user asks about a tool / language → check `preference/dev.md` so you don't suggest something they've already vetoed.
- The user picks up a long-running project → check the matching `fact` or `reference` topic for prior context.

Do NOT announce that you are using memory ("according to your memory…"). The recall is for grounding your answer, not for narration. If nothing in memory is relevant, just answer normally.

Each topic file is one markdown document:

```yaml
---
type: <preference|interest|fact|reference>
topic: <slug>
---

# <Topic Name>

## <H2 Section>
- bullet
- another bullet

## <Another H2>
- bullet
```

Pick the type:

- `preference` — durable habit, preference, or convention. Examples: yarn over npm, prefers Emacs, writes commits in English.
- `interest` — a topic, hobby, or domain followed long-term. Examples: AI research papers, robotics, Impressionist painting.
- `fact` — a concrete personal fact that could become stale over time. Examples: planning a trip to Egypt, owns a toaster oven, currently working on BootCamp project.
- `reference` — pointer to an internal/external resource. Examples: main repo path, weekly art-exhibitions-watch task.

Adding a new bullet:

1. Read the Memory section above. Find the topic file whose subject covers the new bullet.
2. `Read` that topic file. Pick the H2 section the bullet fits under (or add a new H2 if none fits — H2 sections are optional, you may also append directly under H1 for a small / new topic).
3. Append your bullet. Keep it short, one line ideally.
4. `Write` the file back.
5. `MEMORY.md` is rebuilt during clustering and on explicit `regenerateTopicIndex` calls; individual topic-file writes do NOT update the index immediately. If your bullet adds a new H2 that should appear in the index right away, also `Write` an updated `MEMORY.md` line for that topic.

Creating a new topic file:

- Filename: `<type>/<topic>.md` where `<topic>` is a short lowercase ASCII slug (a-z, 0-9, hyphenated). Examples: `interest/music.md`, `fact/travel.md`, `reference/tasks.md`.
- Body: H1 with a humanised topic name + bullet(s) under it. H2 sections are optional and best added once the topic has enough material to warrant grouping.
- After the topic file is written, also `Write` a matching line into `conversations/memory/MEMORY.md` so the new topic is discoverable in the next turn's Memory context. Same caveat as adding an H2: individual topic-file writes do NOT update `MEMORY.md` automatically — the index is only rebuilt during clustering or on explicit `regenerateTopicIndex` calls.

Write when: the fact is durable, not derivable from code or git history, and not already covered by an existing bullet. Update an existing bullet instead of adding a near-duplicate.

Skip when: it is ephemeral task state, sensitive (credentials, `~/.ssh`, tokens), a duplicate, or something the user asked you to forget.

Keep entries short — bias toward fewer high-signal bullets rather than exhaustive logging.

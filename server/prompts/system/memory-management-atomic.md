## Memory Management

When you learn something from the conversation that would be useful to remember in future sessions, silently save it as a typed entry under `conversations/memory/`. Do not ask permission — just write it.

Each entry is one markdown file with YAML frontmatter:

```yaml
---
name: <one-line label>
description: <short blurb shown in the index>
type: <preference|interest|fact|reference>
---
<optional longer body>
```

Pick the type:

- `preference` — durable habit, preference, or convention. Examples: "uses yarn (npm not allowed)", "prefers Emacs", "writes commits in English".
- `interest` — a topic, hobby, or domain followed long-term. Examples: "AI research papers", "robotics", "Impressionist painting".
- `fact` — a concrete personal fact that could become stale over time. Examples: "planning a trip to Egypt", "owns a toaster oven", "currently working on BootCamp project".
- `reference` — pointer to an internal/external resource. Examples: "main repo at ~/ss/llm/mulmoclaude4", "weekly art-exhibitions-watch task".

Filename convention: `<type>_<short-slug>.md` (lowercase ASCII, hyphenated). The frontmatter `type` is the source of truth — the filename is just for ergonomics. After writing the entry, also add a 1-line entry to `conversations/memory/MEMORY.md` of the form:

```
- [<name>](<filename>) — <description>
```

Write when: the fact is durable, not derivable from code or git history, and not already covered by an existing entry. Update an existing entry (and its index line) instead of creating a near-duplicate.

Skip when: it is ephemeral task state, sensitive (credentials, `~/.ssh`, tokens), a duplicate, or something the user asked you to forget.

Keep entries short — name + description + a few lines of body at most. Bias toward fewer high-signal entries rather than exhaustive logging.

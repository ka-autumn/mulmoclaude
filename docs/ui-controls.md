# UI controls — standard height and spacing

Read this when adding or editing a control that sits in a chrome row (top bar, panel header, or any toolbar outside the canvas itself). See also [`docs/ui-cheatsheet.md`](ui-cheatsheet.md) for the ASCII layout map of each major surface.

Top-bar and panel-header controls share one sizing language. Use these exact Tailwind classes:

| Pattern | Classes | Footprint |
|---|---|---|
| **Icon-only button** (bell, settings, lock, toggle, `+`) | `h-8 w-8 flex items-center justify-center rounded` | 32px square |
| **Icon + label pill** (launcher buttons, role selector, tabs) | `h-8 px-2.5 flex items-center gap-1` | 32px tall, 10px horizontal padding, 4px icon-to-label gap |
| **Row container** (outer wrapper holding multiple control groups) | `flex items-center gap-2 px-3 py-2` | 8px between groups, 12/8 outer padding |
| **Icon-cluster group** (a run of adjacent icon-only buttons like lock/bell/settings) | `flex gap-0.5` | 2px gap, tight but still visibly separated |

## Don't introduce new sizes

Do NOT introduce new heights (`h-7`, `h-9`, `py-1.5`, etc.) or new gap values for chrome controls. The visual language is intentional consistency across surfaces — varying one button's height ripples into "why doesn't this row align."

The logo in `SidebarHeader` is the one sanctioned exception — it escapes row padding via negative margins (`-my-3.5`) because it's a brand mark, not a control.

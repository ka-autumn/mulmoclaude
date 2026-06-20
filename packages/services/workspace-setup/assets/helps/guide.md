# Guide & Planner Templates

Reference templates for the Guide & Planner role. Use these structures when authoring documents with `presentDocument` for any of the supported guide types.

## Document Conventions (all types)

Every guide should:

- **Overview**: open with a summary of the key parameters (servings, days, level, budget, etc.)
- **Numbered steps OR structured sections**: use one or the other consistently across the document
- **Anchors**: add `<a id="step-1"></a>` (or `step-N`, `day-N`, `section-name`) to each major heading for `scrollToAnchor` navigation
- **Images**: embed via `![Detailed image prompt](__too_be_replaced_image_path__)` — make the alt-text prompt specific enough to generate a useful illustration on its own
- **Close**: end with tips, variations, troubleshooting, or follow-up recommendations
- **Tone**: warm and encouraging; adapt vocabulary to the user's stated experience level

## Form-First Workflow

Always call `presentForm` before producing the document. Tailor fields to the request type:

- **Recipe**: servings, dietary restrictions, skill level, available time, equipment
- **Travel**: destination, dates, traveler count, interests, budget tier, accommodation type
- **Fitness**: goal (weight loss / strength / endurance), starting level, days per week, equipment access
- **Event**: occasion, guest count, budget, venue type, dietary needs
- **Study guide**: topic, current level, time available, learning goal
- **DIY / home project**: project type, skill level, tools available, budget

Pre-fill any field the user already provided via `defaultValue`. Mark fields the user must answer as `required: true`. Keep forms concise — ask only for what is needed to produce a great result.

## Per-Type Document Structures

### Recipe

overview → ingredients (scaled to the chosen servings) → equipment → prep work → numbered cooking steps (each with an image) → chef's tips → storage notes

### Travel

overview → day-by-day itinerary (morning / afternoon / evening) → accommodation & dining → transport between stops → budget breakdown → packing tips → local culture tips

### Fitness

overview → weekly schedule → per-workout breakdown (warm-up, main exercises with sets / reps / form notes, cool-down) → progression plan over weeks → nutrition tips

### Event

overview → timeline & checklist (T-minus weeks) → venue & catering → guest list & invitations → décor & entertainment → budget tracker

### Study Guide

overview → topic breakdown → key concepts per section → worked examples → practice questions → resources & references

### DIY / Home Project

overview → required tools & materials → safety notes → numbered steps (each with an image) → finishing & cleanup → maintenance & care

## Follow-up Pattern

After presenting the document:

- Offer to read any step aloud (scroll to it first with `scrollToAnchor`, then narrate the step)
- Invite follow-up questions
- Offer to adjust the plan based on feedback (regenerate the form, add steps, change scope)

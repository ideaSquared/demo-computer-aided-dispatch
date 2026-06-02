---
name: accessibility
description: A11y rules and verification steps for any new UI. Use whenever a component, page, or interaction is added or changed.
disable-model-invocation: true
---

# Accessibility

CAD operators run this for hours under stress. A11y is a usability
requirement, not a checklist.

## The non-negotiables

1. **Keyboard reachable.** Every interactive element gets focus on Tab.
   Custom widgets (a draggable map marker) provide an alternative keyboard
   affordance.
2. **Visible focus.** Use `vars.shadows.focusRing` on `:focus-visible`.
   `outline: none` without a replacement is forbidden.
3. **Role + name.** Every interactive element has the correct ARIA role and
   a name discoverable by assistive tech. Test with
   `getByRole(role, { name })` — if it works in the test, it works for
   screen readers.
4. **Live regions for real-time updates.** New incident alerts must use
   `role="status"` (polite) or `role="alert"` (assertive). Use
   `aria-live="off"` to suppress unnecessary chatter on the heatmap.
5. **Colour is not the only signal.** Severity is colour + icon + text. A
   red ring without a label is meaningless to a colour-blind operator.
6. **Contrast ≥ WCAG AA.** 4.5:1 for normal text, 3:1 for large text and
   UI components. The design tokens already satisfy this — don't override.

## Verification

- **Manual:** Tab through the new UI start-to-finish. Operate every control
  with the keyboard. Listen to it with VoiceOver / NVDA on the most-used
  flow.
- **Automated:** `pnpm --filter <app> a11y` runs `axe-playwright` against
  the e2e suite. Failures are a P2.
- **Local lint:** Biome's a11y rules cover the static cases (missing
  `alt`, missing `htmlFor`, role conflicts).

## Forms

- Every `<input>` has a `<label>` or `aria-labelledby`.
- Error messages are linked via `aria-describedby` so they're announced.
- Required fields have `aria-required="true"`, not just an asterisk.

## Modals

`@cad/lib.ui/Modal` traps focus, restores it on close, and exposes
`aria-modal="true"`. Don't roll your own.

## Don't

- `<div onClick={...}>` as a button — use `<Button>`. If you really need a
  div, add `role="button"`, `tabIndex={0}`, and keyboard handlers — but
  use Button.
- Tooltips as the only label.
- Animation without `prefers-reduced-motion` respect — `@cad/lib.ui`'s
  transition tokens already honour this.
- `placeholder` as a label.

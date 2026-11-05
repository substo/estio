# UI design principles

Approved after the Studio Library first-viewport correction on 2026-11-05. This project guide is the canonical UI policy for Estio and Substo; apply it within the shared app shell.

## Serve the primary task first

The first viewport should help the user do the page's primary task. On collection screens, prioritize existing content, navigation, search and filters. Keep the header compact; avoid marketing-style introductions, duplicated headings and excess whitespace that push useful content below the fold.

Disclose secondary creation flows on demand through a compact action. Library uses **Add source** to open a dialog because browsing saved sources is its primary task. This is not a rule that every form belongs in a modal: primary creation and editing screens can remain forms. Choose the disclosure pattern appropriate to the task and form complexity.

Design populated, genuinely empty and filtered-empty states distinctly. An empty-state action may open the creation flow only after the user activates it. Background automation must not consume the first viewport with idle/no-op telemetry such as “0 sources updated.” Show active progress unobtrusively near the affected content; meaningful results can be transient or presented in context.

## Accessible disclosure

Reuse the project's Radix/shadcn Dialog components for modal flows. Provide a visible title, useful description and close control; put initial focus on the appropriate input, contain keyboard focus, support Escape, and return focus to the invoking action. Constrain the dialog to the viewport with scrolling for short screens. Keep pending/error/save outcomes truthful and visible; saving metadata must not imply that summary generation succeeded.

## Verify the actual states

Inspect populated and empty views on desktop and phone, including wrapped filters and long content. Verify that content appears usefully in the first viewport for the actual app shell and viewport being tested. Record viewport dimensions and any evidence limits rather than applying a universal pixel threshold. Check horizontal overflow, keyboard opening, initial focus, Tab/Shift+Tab containment, Escape, focus return, and pending/error/success behavior. Static markup and unit tests do not establish real browser or keyboard acceptance.

## Rationale and scope

[Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) supports keeping secondary options available without overwhelming the primary task. It informs the Library's on-demand add flow; it does not mandate dialogs on every page.

[WAI-ARIA APG: Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) describes focus containment, Escape, labelling and focus return when a modal is used. Use these interaction requirements with the existing component rather than creating a parallel modal implementation.

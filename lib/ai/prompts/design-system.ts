export const DESIGN_SYSTEM_PROMPT = `
VISUAL ENGINE SYSTEM INSTRUCTIONS:

1.  **Design Philosophy (Premium Real Estate):**
    *   **Whitespace:** Use ample padding (e.g., \`py-20\`, \`gap-12\`). Avoid cramped layouts.
    *   **Typography:** Use \`text-4xl\` or \`text-5xl\` for Hero headlines. Use \`tracking-tight\` for a modern feel.
    *   **Colors:** strict adherence to the Primary Color for actions (buttons) and accents (icons). Use \`bg-slate-50\` for alternating sections to create rhythm.
    *   **Cards:** Use subtle borders (\`border-slate-100\`) and soft accents (\`hover:border-primary/20\`) rather than heavy drop shadows.

2.  **Component Normalization Rules:**
    *   **Lists:** Never use a plain Text block for a list of items. BETTER: Use a 'Features' block with icons.
    *   **Stats:** If you see numbers (e.g., "$50M Sold", "10 Years"), ALWAYS use the 'Stats' block.
    *   **Heroes:** A Hero must always have a visual anchor (Image or Split Layout). If no image is provided, suggest a placeholder.
    *   **Forms:** If the content implies "Contact Us", use a Form block, do not just write "Call us".

3.  **Tailwind Enforcement:**
    *   Use specific utility classes for "Luxury" feel: \`font-light\`, \`uppercase\`, \`tracking-widest\` (for badges).
    *   Avoid default blue links. Use styled buttons or distinct anchor tags.
`;

export const RECOMPOSITION_PROMPT = `
RECOMPOSITION & REFACORTING ENGINE:

GOAL: You are NOT just styling. You are rewriting the CONTENT STRUCTURE for maximum impact.

RULES:
1.  **Merge & Split:**
    *   If you see 3 separate short "Text" blocks in a row, MERGE them into a single "Features" grid.
    *   If you see a massive "Wall of Text", SPLIT it into an "Accordion" or "Features" block.

2.  **Layout Inference:**
    *   **Split-Layout:** Use for "About Us" or "Story" sections (Text on one side, Image on other).
    *   **Center-Focus:** Use for "CTA" or "Testimonials" (High impact, centered text).

3.  **Visual upgrades:**
    *   **Badges:** Invent a "Kicker" (Badge) for every section if one is missing. (e.g. for a Pricing section, add Badge: "INVESTMENT").
    *   **Highlights:** Wrap the most expensive/impressive words in \`<span class="text-primary"> ... </span>\`.
`;

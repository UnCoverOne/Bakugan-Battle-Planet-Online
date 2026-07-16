# Bakugan Battle Planet Online design system

## Source typography

The archived official Bakugan website stylesheet included with the project imports:

- **Lato** — 400, 400 italic, 700 and 700 italic
- **Titillium Web** — 400, 400 italic, 700 and 700 italic

The stylesheet assigns Lato to body copy and Titillium Web to navigation, buttons, page titles and section headings. It also declares a custom `Bakugan` font, but that font is an icon glyph set rather than a text face and should not be used for interface copy.

## Type roles

| Role | Family | Weight | Style | Casing |
| --- | --- | --- | --- | --- |
| Body copy, descriptions, form values and tables | Lato | 400 | Normal | Sentence case |
| Emphasised body copy | Lato | 700 | Normal | Sentence case |
| Page and section headings | Titillium Web | 700 | Italic | Uppercase |
| Navigation, buttons, badges and compact labels | Titillium Web | 700 | Normal or italic | Uppercase |
| Numerical game data | Lato | 700 | Normal, tabular figures where useful | As written |

Only 400 and 700 should be requested. Using 800 or 900 creates synthetic weight differences between browsers and operating systems.

## Brand colour anchors

| Token | Value | Use |
| --- | --- | --- |
| `--brand-red` | `#EB1D25` | Primary Bakugan action, warnings and active emphasis |
| `--brand-blue` | `#00AEEF` | Interactive focus, information and technology accents |
| `--brand-ink` | `#01131A` | Deep blue-black branded surfaces |
| `--brand-black` | `#000000` | Backdrops, framing and contrast |
| `--brand-white` | `#FFFFFF` | Primary text on dark surfaces |
| `--brand-gray` | `#7F7F7F` | Secondary and inactive information |

Faction colours remain contextual and should not replace the core red/blue interface hierarchy.

## Visual rules

1. Use dark, high-contrast surfaces with restrained red and cyan accents.
2. Use italic uppercase display type for major headings, not for paragraphs.
3. Use one clear primary action per panel. Secondary actions should be visually quieter.
4. Keep corner cuts, hexagonal geometry and glow effects as accents rather than applying them to every element.
5. Use the shared spacing, colour and typography variables from `app/design-system.css` instead of introducing local alternatives.
6. Preserve a visible cyan focus ring for keyboard users.
7. Do not use `Impact`, `Arial Narrow` or device-only fonts in components. Use `var(--font-display)` or `var(--font-body)`.
8. Do not use the custom Bakugan icon font for readable text.

## Component guidance

### Headings

- H1: Titillium Web 700 italic, uppercase, compact line height.
- H2–H3: same family and weight with progressively reduced scale.
- Eyebrows and labels: Titillium Web 700, uppercase, increased tracking.

### Body content

- Lato 400 with a line height around 1.45–1.6.
- Avoid all-uppercase paragraphs.
- Use Lato 700 for important values rather than increasing the font weight beyond 700.

### Controls

- Buttons and navigation use Titillium Web 700.
- Interactive focus uses `--brand-blue` with a black separation ring.
- Disabled state must remain legible and must not rely on colour alone.

### Game screen

- Zone labels use Titillium Web 700 and the shared display token.
- Rules text, card descriptions and logs use Lato.
- Numerical counters should use tabular figures where alignment matters.

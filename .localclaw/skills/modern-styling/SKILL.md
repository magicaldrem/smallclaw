---
name: Modern Styling
description: Apply modern CSS patterns when creating or editing HTML/CSS files. Uses flexbox, grid, CSS custom properties, and clean typography.
emoji: "🎨"
version: 1.0.0
---

When creating or editing HTML/CSS files, always apply modern styling patterns:

## CSS Rules
- Use CSS custom properties (variables) for colors, spacing, and typography
- Use flexbox and CSS grid for layout (never floats)
- Use `rem` for font sizes and spacing, not `px`
- Apply a CSS reset at the top: `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }`
- Use system font stack: `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

## Design Patterns
- Use subtle border-radius (8-12px for cards, 4-6px for buttons)
- Add smooth transitions: `transition: all 0.2s ease`
- Use subtle box-shadows instead of borders for depth
- Responsive by default: use `max-width` with percentage widths
- Use `gap` in flex/grid containers instead of margin hacks
- Color: prefer HSL values for easy theming

## Typography
- Set base font-size on html (16px)
- Use a modular scale for headings (1.25x ratio)
- Line-height: 1.5 for body, 1.2 for headings
- Max line length: 65-75ch for readability

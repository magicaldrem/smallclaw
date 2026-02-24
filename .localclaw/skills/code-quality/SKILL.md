---
name: Code Quality
description: Write clean, well-structured code with proper error handling, comments, and naming conventions.
emoji: "✨"
version: 1.0.0
---

When writing or editing code files, always follow these quality standards:

## Naming
- Variables/functions: camelCase, descriptive names (not single letters)
- Classes/components: PascalCase
- Constants: UPPER_SNAKE_CASE
- Files: kebab-case

## Structure
- Functions should do ONE thing and be under 30 lines
- Add JSDoc comments for public functions
- Group related code with section comments
- Early returns over deep nesting

## Error Handling
- Always wrap async operations in try/catch
- Provide meaningful error messages
- Never silently swallow errors
- Validate inputs at function boundaries

## HTML/JS
- Use semantic HTML elements (main, section, article, nav)
- Use const by default, let only when needed, never var
- Use template literals over string concatenation
- Use optional chaining (?.) and nullish coalescing (??)

# TOOLS.md — Local Notes

Skills define *how* tools work. This file is for *your* specifics.

## Environment

- **Platform:** Windows 11
- **Workspace:** D:\localclaw\workspace
- **Model:** Qwen3:4b via Ollama (localhost:11434)
- **Gateway:** http://127.0.0.1:18789

## Available Tools

- list_files — List workspace files
- read_file — Read file with line numbers
- create_file — Create new file (fails if exists)
- replace_lines — Replace lines N-M
- insert_after — Insert after line N
- delete_lines — Delete lines N-M
- find_replace — Find/replace exact text
- delete_file — Delete file
- web_search — Google Custom Search

## Notes

- Line-based tools work best for edits (replace_lines, insert_after)
- find_replace is fragile with whitespace — prefer line-based tools
- For large files, read_file first to get line numbers
- create_file blocks overwrites — use editing tools for existing files

---

*Add whatever helps you do your job. This is your cheat sheet.*

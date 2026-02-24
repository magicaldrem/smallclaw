# LocalClaw Examples

## Example 1: Simple File Creation

```bash
localclaw agent "Create a Python script called hello.py that prints 'Hello, LocalClaw!'"
```

**What happens:**
1. Manager plans: "Create task to write Python file"
2. Executor uses `write` tool to create the file
3. Verifier checks that the file exists and contains the code
4. Job completes

## Example 2: Code Generation with Tests

```bash
localclaw agent "Create a calculator.py module with add, subtract, multiply, divide functions, then write tests for it in test_calculator.py"
```

**What happens:**
1. Manager breaks this into 2 tasks:
   - Task 1: Write calculator.py
   - Task 2: Write test_calculator.py
2. Executor creates both files
3. Verifier checks both files exist and contain proper code
4. Job completes

## Example 3: File Organization

```bash
localclaw agent "Find all .txt files in the workspace and organize them into a 'documents' folder"
```

**What happens:**
1. Manager plans: List files, create folder, move files
2. Executor:
   - Uses `list` to find .txt files
   - Uses `shell` to create documents/ folder
   - Uses `shell` to move each file
3. Verifier checks all files were moved
4. Job completes

## Example 4: Research and Summarize (when search tool is added)

```bash
localclaw agent "Search for the latest Node.js best practices and create a summary document"
```

**What happens:**
1. Manager plans: Search, extract info, write document
2. Executor:
   - Uses `search` tool to find articles
   - Uses `read` to process results
   - Uses `write` to create summary.md
3. Verifier checks document quality
4. Job completes

## Example 5: Code Refactoring

```bash
localclaw agent "Read main.py, extract all helper functions into utils.py, update imports in main.py"
```

**What happens:**
1. Manager plans:
   - Task 1: Read and analyze main.py
   - Task 2: Create utils.py with helper functions
   - Task 3: Update main.py with new imports
2. Executor follows the plan step by step
3. Verifier checks:
   - utils.py exists with all functions
   - main.py imports are correct
   - No syntax errors
4. Job completes

## Example 6: Project Setup

```bash
localclaw agent "Create a new Express.js project with package.json, server.js with basic routes, and a README"
```

**What happens:**
1. Manager plans multiple file creation tasks
2. Executor:
   - Uses `write` for package.json
   - Uses `write` for server.js
   - Uses `write` for README.md
3. Verifier checks all files exist
4. Job completes

## Example 7: Running Tests

```bash
localclaw agent "Run npm test and if any tests fail, create a report of the failures in test-report.txt"
```

**What happens:**
1. Manager plans: Run tests, analyze results, create report
2. Executor:
   - Uses `shell` to run npm test
   - Parses output
   - Uses `write` to create report if failures found
3. Verifier checks command ran successfully
4. Job completes

## Example 8: Multi-Step Data Processing

```bash
localclaw agent "Read data.csv, calculate the average of the 'sales' column, and create a summary.txt with the result"
```

**What happens:**
1. Manager plans: Read file, process data, write summary
2. Executor:
   - Uses `read` to get data.csv
   - Processes the data (in thought/reasoning)
   - Uses `write` to create summary.txt
3. Verifier checks summary contains the average
4. Job completes

## Advanced Example: Background Task with Heartbeat

Create a `HEARTBEAT.md` file in your workspace:

```markdown
# Background Tasks

- [ ] Check for new GitHub issues (every 4 hours)
- [ ] Run tests on main branch (every commit)
- [ ] Backup workspace files (daily at 2 AM)
- [ ] Update dependencies (weekly on Monday)
```

Then enable heartbeat in config:

```json
{
  "heartbeat": {
    "enabled": true,
    "interval_minutes": 30
  }
}
```

The gateway will automatically execute these tasks in the background!

## Job Management Examples

### Monitor a running job
```bash
# Get job ID from initial command
localclaw jobs show abc123xyz

# Watch job progress
watch -n 2 "localclaw jobs show abc123xyz"
```

### List recent jobs
```bash
# All jobs
localclaw jobs list

# Only completed
localclaw jobs list --status completed

# Only failed
localclaw jobs list --status failed
```

### Resume after crash
If LocalClaw crashes or your computer restarts, jobs are saved in the database. The next time you start LocalClaw, it will resume incomplete jobs!

## Model Selection Examples

### Use different models for different roles
Edit `~/.localclaw/config.json`:

```json
{
  "models": {
    "primary": "qwen3:4b",
    "roles": {
      "manager": "qwen3:4b",
      "executor": "qwen2.5-coder:32b",
      "verifier": "qwen3:4b"
    }
  }
}
```

This uses a fast model for planning/verification but a more capable model for execution!

### Test different models
```bash
# Try lightweight model
localclaw model set qwen3:4b
localclaw agent "Simple task here"

# Try more powerful model
localclaw model set qwen2.5-coder:32b
localclaw agent "Complex coding task here"
```

## Tips for Best Results

### 1. Be Specific
❌ "Work on the project"
✅ "Add error handling to the login function in auth.js"

### 2. Break Down Complex Tasks
❌ "Build a complete web app"
✅ "Create an Express server with GET /users endpoint that returns mock data"

### 3. Provide Context
❌ "Fix the bug"
✅ "The login function in auth.js crashes when email is empty. Add validation."

### 4. Use Acceptance Criteria
✅ "Create tests for calculator.py that cover all four operations and edge cases like division by zero"

This helps the Verifier agent know exactly what success looks like!

### 5. Let It Work Iteratively
Don't expect one-shot perfection. LocalClaw's iterative approach means it can:
- Try something
- Get feedback
- Adjust
- Try again

This is actually more reliable than trying to do everything at once!

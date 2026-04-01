# Git Commands — Reference Guide

Practical Git reference for day-to-day work on this repository.

---

## Initial setup

```bash
# Clone the repository
git clone git@github.com:YOUR_USER/bot-repo.git
cd bot-repo

# Set your identity (first time only)
git config user.name "Your Name"
git config user.email "you@example.com"
```

---

## Daily workflow

### Check current state

```bash
git status              # show changed files
git diff                # show unstaged changes
git diff --staged       # show staged changes
git log --oneline -10   # last 10 commits
```

### Stage and commit

```bash
# Stage specific files (preferred — avoids accidentally staging .env or secrets)
git add backend/src/some-file.js

# Stage all changes in the current directory
git add .

# Commit with a message
git commit -m "fix: validate margin before executing trade"

# Stage and commit in one step (tracked files only)
git commit -am "fix: validate margin before executing trade"
```

### Push to remote

```bash
git push                    # push current branch to remote
git push origin my-branch   # push specific branch
```

---

## Branching

```bash
# Create and switch to a new branch
git checkout -b feature/my-feature

# Switch to an existing branch
git checkout main
git checkout my-branch

# List all branches
git branch          # local only
git branch -a       # local + remote

# Delete a branch (after merging)
git branch -d my-branch           # local
git push origin --delete my-branch  # remote
```

---

## Syncing with remote

```bash
# Fetch remote changes without merging
git fetch origin

# Pull and rebase (cleaner history than merge)
git pull --rebase origin main

# Pull with merge (creates a merge commit)
git pull origin main
```

### Update feature branch with latest main

```bash
git checkout main
git pull --rebase origin main
git checkout my-feature-branch
git rebase main
```

---

## Viewing history

```bash
git log --oneline               # compact log
git log --oneline --graph       # with branch graph
git log --oneline -20           # last 20 commits
git log -- backend/src/         # log for a specific path
git show abc1234                # show a specific commit
git diff main..my-branch        # diff between branches
```

---

## Undoing changes

```bash
# Discard unstaged changes in a file
git checkout -- backend/src/some-file.js

# Unstage a file (keep changes in working tree)
git restore --staged backend/src/some-file.js

# Undo the last commit (keep changes staged)
git reset --soft HEAD~1

# Undo the last commit (keep changes unstaged)
git reset HEAD~1

# Revert a commit (safe — creates a new commit)
git revert abc1234
```

> Avoid `git reset --hard` unless you are certain you want to discard all local changes permanently.

---

## Stashing

```bash
# Save uncommitted changes temporarily
git stash

# List stashes
git stash list

# Restore the latest stash
git stash pop

# Restore a specific stash
git stash apply stash@{1}

# Discard the latest stash
git stash drop
```

---

## Merge conflicts

When a rebase or merge encounters a conflict:

1. Git marks conflicted files with `<<<<<<<` / `=======` / `>>>>>>>`
2. Open each conflicted file and resolve manually
3. Stage the resolved files:
   ```bash
   git add backend/src/resolved-file.js
   ```
4. Continue the rebase or merge:
   ```bash
   git rebase --continue   # if rebasing
   git merge --continue    # if merging
   ```
5. To abort and go back to the state before the conflict:
   ```bash
   git rebase --abort
   git merge --abort
   ```

---

## Tags

```bash
# Create a tag
git tag v1.2.0
git tag -a v1.2.0 -m "Release v1.2.0"

# Push tags
git push origin --tags

# List tags
git tag -l
```

---

## Useful shortcuts

```bash
# Show which remote a branch tracks
git branch -vv

# Show remote URLs
git remote -v

# Check what would be pushed
git log origin/main..HEAD --oneline

# Find which commit introduced a string
git log -S "search_string" --oneline

# Show file at a specific commit
git show abc1234:backend/src/index.js
```

---

## Repository-specific rules

- Never commit `.env`, wallet JSON files, or Telegram session files — they are all in `.gitignore`
- Use `--staged` diff before committing to confirm no secrets are included
- Prefer `git add <specific-files>` over `git add .` in the backend directory
- Always pull and rebase before pushing to avoid unnecessary merge commits
- Use descriptive commit messages: `fix:`, `feat:`, `chore:`, `docs:` prefixes help

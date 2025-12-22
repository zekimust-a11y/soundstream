# Code Review Process - Preventing Regressions

## The Problem
When fixing one feature, we accidentally broke another feature that was previously working. This is inefficient and frustrating.

## Solution: Systematic Approach

### 1. **Before Making Changes**
- [ ] Identify the EXACT function/component that needs to change
- [ ] Read the current implementation carefully
- [ ] Understand what the code does and why
- [ ] Check if this code is used elsewhere
- [ ] Note any dependencies or side effects

### 2. **During Changes**
- [ ] Make minimal, focused changes
- [ ] Only modify code directly related to the fix
- [ ] Don't refactor unrelated code
- [ ] Don't "improve" things that aren't broken
- [ ] Add comments explaining WHY you're changing something

### 3. **After Changes - Testing**
Use the TESTING_CHECKLIST.md to verify:
- [ ] The new feature works
- [ ] Existing features still work (regression test)
- [ ] No console errors
- [ ] UI displays correctly

### 4. **Code Review Checklist**
Before considering a task complete:
- [ ] Review the git diff to see what actually changed
- [ ] Verify no unrelated code was modified
- [ ] Check if changes affect shared functions/components
- [ ] Test the specific feature that was changed
- [ ] Test related features that might be affected

### 5. **Isolation Strategy**
When fixing a specific issue:
1. **Identify the scope**: What function handles this feature?
2. **Check dependencies**: What other code calls this function?
3. **Make targeted changes**: Only modify the specific function
4. **Test in isolation**: Test just this feature first
5. **Regression test**: Then test related features

### 6. **Git Workflow**
```bash
# Before starting work
git status  # Check current state
git diff    # See what's changed

# Create a branch for the fix
git checkout -b fix/feature-name

# Make changes
# ... edit files ...

# Review what changed
git diff

# Test thoroughly
# ... test the app ...

# Commit with clear message
git commit -m "Fix: specific issue description"

# Before merging, verify:
# - The fix works
# - Nothing else broke
```

### 7. **Documentation**
- Add comments for complex logic
- Document assumptions
- Note any limitations or edge cases
- Explain why a particular approach was chosen

## Example: Fixing "In the Press" Without Breaking Playlists

**WRONG Approach:**
- Modify `getQobuzSelectionAlbums` 
- Also "improve" `getPlaylists` while you're there
- Change shared helper functions
- Result: Playlists break

**RIGHT Approach:**
- Identify that `getQobuzSelectionAlbums` handles "In the Press"
- Only modify the item_id extraction logic in that function
- Don't touch `getPlaylists` at all
- Test "In the Press" works
- Test playlists still work
- Result: Both features work

## Current Status
The `getPlaylists` function should now work correctly. The code:
- Finds "My Playlists" in Qobuz menu (at index 3)
- Extracts item_id from `actions.go.params.item_id` (which is "3")
- Fetches playlists from that menu item
- Should return 28 playlists

If playlists still don't show, the issue might be:
1. The playlist fetching logic itself
2. The playlist display logic
3. Caching issues
4. Server connection issues

Let's test and verify the current implementation works.














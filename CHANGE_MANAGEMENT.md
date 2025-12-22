# Change Management Process

## Problem Statement
When fixing one feature, we accidentally break another feature that was working. This creates a cycle of fixing and re-fixing.

## Root Cause Analysis

### What Went Wrong
1. **Scope Creep**: While fixing "In the Press", we also modified playlist-related code
2. **Lack of Isolation**: Changes to one feature affected another
3. **No Regression Testing**: Didn't verify existing features still worked
4. **No Git Branches**: All changes in main branch, hard to track what broke

### Why It Happened
- Both features use similar Qobuz menu navigation code
- Shared helper functions were modified
- No clear separation between "In the Press" fix and playlist code

## Solution: Change Isolation Protocol

### Step 1: Identify the Exact Problem
- What feature is broken?
- What function handles it?
- What's the minimal change needed?

### Step 2: Isolate the Change
- Create a git branch: `git checkout -b fix/feature-name`
- Only modify the specific function/component
- Don't touch related code unless absolutely necessary

### Step 3: Test in Isolation
- Test ONLY the feature you're fixing
- Verify it works
- Don't test other features yet (to avoid confusion)

### Step 4: Regression Test
- Test ALL related features
- Use TESTING_CHECKLIST.md
- Verify nothing broke

### Step 5: Review Before Committing
- `git diff` to see what changed
- Verify no unrelated code was modified
- Check if shared functions were changed

## Current Issue: Qobuz Playlists

### Status Check
The current `getPlaylists` implementation:
- ✅ Finds "My Playlists" at index 3
- ✅ Extracts item_id correctly (from actions.go.params.item_id = "3")
- ✅ Fetches 28 playlists successfully (verified via curl test)

### If Playlists Still Don't Show
The issue might be:
1. **Display logic**: PlaylistsScreen not rendering them
2. **Caching**: Old cached data
3. **Server connection**: Not properly connected
4. **Error handling**: Errors being silently caught

### Debugging Steps
1. Check browser console for errors
2. Check if `getPlaylists` is being called
3. Check if playlists are being returned but not displayed
4. Clear cache and reload
5. Check network tab for API calls

## Prevention Strategy

### For Future Changes
1. **Always create a branch** for each fix
2. **Test the specific feature** you're fixing
3. **Test related features** to ensure no regression
4. **Review the diff** before committing
5. **Document what changed** and why

### Code Organization
- Keep features isolated in separate functions
- Avoid shared mutable state
- Use clear function names
- Add comments for complex logic

### Testing Protocol
Before marking ANY task complete:
1. Test the new feature works
2. Test existing features still work
3. Check console for errors
4. Verify UI displays correctly














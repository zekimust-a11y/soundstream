# Development Guidelines - Preventing Regressions

## Problem
When fixing one feature, we accidentally broke another feature that was previously working.

## Best Practices to Prevent Regressions

### 1. **Isolation of Changes**
- **Before modifying code**: Identify the exact function/component that needs to change
- **Scope the change**: Only modify code directly related to the feature being fixed
- **Avoid "while I'm here" changes**: Don't refactor or improve unrelated code in the same commit

### 2. **Use Git Branches**
```bash
# Create a feature branch for each fix
git checkout -b fix/tidal-library
# Make your changes
git commit -m "Fix: Tidal library display"
# Test thoroughly
git checkout main
git merge fix/tidal-library
```

### 3. **Test Checklist Before Committing**
Before marking a task complete, verify:
- [ ] The new feature works as expected
- [ ] Existing features still work (regression test)
- [ ] No console errors
- [ ] UI displays correctly

### 4. **Code Review Process**
- Review the diff to see what actually changed
- Verify no unrelated code was modified
- Check if changes affect shared functions/components

### 5. **Defensive Coding**
- Add try/catch blocks around new code
- Don't modify working code paths unless necessary
- Use feature flags or conditional logic to isolate new behavior

### 6. **Documentation**
- Add comments explaining why code exists
- Document any assumptions or dependencies
- Note any known limitations

## Notes
This document is intentionally generic. Keep it updated to reflect current integrations and remove outdated incident-specific guidance.














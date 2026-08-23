## Summary

Describe the bounded change and its externally visible effect.

## ChangeIntent

```repo-guard-yaml
change_type: feature
scope:
  - src/**
budgets:
  max_new_files: 0
  max_new_docs: 0
  max_net_added_lines: 0
anchors:
  affects: []
  implements: []
  verifies: []
must_touch:
  - src/**
must_not_touch:
  - repo-policy.json
  - .github/workflows/**
expected_effects:
  - describe the intended observable effect
```

## Verification

Record the exact commands/workflows and results used to verify this change.

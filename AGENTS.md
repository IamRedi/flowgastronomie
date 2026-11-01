# Repository agent instructions

## Local development verification — owner rule (2026-11-01)

Read and follow [LOCAL_CI_POLICY.md](LOCAL_CI_POLICY.md) when creating/resuming work or selecting tests. Routine development checks run directly on laptop/mini PC (authorized SSH/Tailscale is allowed); GitHub Actions verification is only for explicitly selected cloud work. Preserve every required test, security/build gate, operational backup/release contract, exact-revision evidence and review/acceptance rule. Do not dispatch Actions for routine local pushes/PR updates or fake a success for an unexecuted check. Before pushing an old work branch, reconcile the narrow policy/workflow delta without overwriting newer tests or concurrent work.

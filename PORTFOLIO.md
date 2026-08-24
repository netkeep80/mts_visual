# Portfolio roadmap

`mts_visual` является standalone presentation/renderer library в public portfolio [`netkeep80`](https://github.com/netkeep80).

Portfolio-level priority, lifecycle, cross-repo dependencies и следующий gate **намеренно не дублируются здесь**. Authoritative sources:

- [netkeep80/roadmap](https://github.com/netkeep80/roadmap) — главный portfolio control plane;
- [Current status](https://github.com/netkeep80/roadmap/blob/main/STATUS.md) — live GitHub state;
- [Execution order](https://github.com/netkeep80/roadmap/blob/main/EXECUTION.md) — cross-repo gates;
- [Architecture](https://github.com/netkeep80/roadmap/blob/main/ARCHITECTURE.md) — canonical ownership/dependencies.

Этот repository владеет standalone `@mts/visual`: renderer-neutral visual model, presentation state, geometry/layout/physics и renderer/browser companions. Он **не** является источником нормативной МТС/Anum semantics и не должен зависеть от `@mts/core`, `anum_docs`, `anum_parser` или `aprover`.

```text
roadmap decides portfolio direction;
anum_docs owns normative MTS/Anum semantics;
mts_visual owns consumer-neutral presentation/rendering infrastructure;
consumers own adapters from their semantic/domain models;
GitHub facts feed the central live status.
```

Consumer repositories may exact-pin accepted `mts_visual` commits independently of MTS semantic release cadence. Cross-repository direction changes are coordinated through `netkeep80/roadmap`; local implementation remains owned here.

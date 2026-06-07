# Adaptive vs Static Evaluation — Thesis Metrics

*Scenario matrix: 6 personas × 2 weather conditions × 4 disruption levels × 2 modes = 96 scenarios. 5 timing repeats per generation call.*

## Summary Table

| Metric | Adaptive | Static |
|---|---|---|
| Generation feasibility rate | 100.0% | 100.0% |
| Post-disruption feasible rate | 91.7% | 33.3% |
| Mean total travel time | 29.6 min | 26.5 min |
| Mean generation response time | 1294 ms | 1298 ms |
| Mean re-optimisation response time | 175 ms | N/A |
| Re-optimisation frequency (of disrupted driving scenarios) | 41.7% | N/A |
| Mean plan-change ratio (all driving disruptions) | 0.260 | N/A |
| Mean plan-change ratio (reoptimized runs only) | 0.623 | N/A |
| Mean interest precision | 1.000 | 1.000 |
| Mean interest recall | 0.938 | 1.000 |
| Mean outdoor stops under rain | 0.50 | 2.00 |

## Cross-mode Comparison

| Metric | Value |
|---|---|
| Feasibility recovery rate (static infeasible → adaptive restored) | 87.5% |
| Manual interventions avoided (adaptive auto-handled vs static) | 5 |

## Notes

- **Static mode** receives the same generation request but skips `applyWeatherAdaptation`. Under disruption, the static plan absorbs the delay as-is (moderate +12 min, heavy +25 min, blocked → infeasible) without calling the adapt-traffic API.
- **Adaptive mode** calls `/api/itinerary/adapt-traffic` with `source:"simulation"` for driving itineraries under disruption. The harness auto-accepts proposed itineraries from the heavy-traffic decision flow.
- Walking itineraries are unaffected by traffic disruptions in both modes (recorded as `no_effect`).
- All weather conditions are fixed via `weatherOverride` for reproducibility. Live TomTom traffic is never used.
- Recommender is always `"content"` (ML/fallback path) for all generation calls.
- **Interest precision**: fraction of planned stops matching a requested interest. **Interest recall**: fraction of requested interests represented by ≥1 stop.
- **Disruption labels** are reconciled against computed feasibility — a label claiming feasibility when the computed end time exceeds the window is relabelled `delayed_infeasible`.

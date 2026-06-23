---
id: validity-experiments
title: Validity experiments
sidebar_label: Validity experiments
---

The standing evidence artifact for extraction validity is the `validity-report`
produced by `pnpm validity`. It measures the model-code gap on the benchmark
applications in `benchmarks/react-router` and `benchmarks/nextjs`.

The report combines three independent signals:

| Signal | Question | Soundness gap |
| --- | --- | --- |
| Conformance pass-rate | Does the extracted model match the running app? | [Extraction](./index.md#the-three-gaps-between-verified-and-correct) |
| Mutation detection rate | Does a real injected bug get caught? | [Extraction](./index.md#the-three-gaps-between-verified-and-correct) |
| Metamorphic stability | Is extraction invariant under semantics-preserving edits? | [Extraction](./index.md#the-three-gaps-between-verified-and-correct) |

Checker correctness is covered separately by the differential and metamorphic
checks described in [Checker correctness](./checker-correctness.md). Validity
experiments focus on whether `extract` preserves the behavior needed by those
checker verdicts.

CI writes `.modality/validity/report.json` and, on pull requests, posts a single
updatable comment with the same report summarized in Markdown. The JSON artifact
is the durable record; the comment is a review surface.

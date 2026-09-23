---
title: Four states, two axes
description: Why a finding is never a percentage, and what UNTESTED is for.
order: 10
---

A single accessibility score hides the difference between *detected*, *suspected* and *not
decidable by a machine at all*. LiveAudit keeps those apart, on two axes that are never
combined.

## Outcome: how certain the statement is

| State | Meaning |
| --- | --- |
| `FAIL` | Detected. The rule could prove it — the image has no alt text, the id exists twice. |
| `REVIEW` | Suspected heuristically. A person has to decide: "here" may be a fine link name in its sentence. |
| `PASS` | Passed. Kept in the report, not shown by default. |
| `UNTESTED` | Not decidable automatically. Produces a checklist item, not a verdict. |

## Severity: how much it weighs

`Low` to `Critical`, and deliberately independent of the outcome. A `REVIEW` on a
navigation landmark and a `FAIL` on an unlabelled form field are not comparable by certainty
alone.

There is no third "certainty" axis. A rule that can only guess returns `REVIEW` — not `FAIL`
with low confidence. The moment certainty becomes a number, it becomes something to average.

## "Did not run" is not "passed"

Every rule leaves an execution record. A contrast check without rendering access reads like a
passed check in most tools; here it is reported as a missing capability, and the report states
what it did **not** inspect.

This is the part that matters most in practice. A tool that silently skips what it cannot
measure produces a clean result for a page nobody checked.

## No percentages

The states are never averaged, weighted or rolled into a score — not in the sidebar, not in
the report model. `UNTESTED` is a visible category of its own rather than something filtered
away, because that is precisely where the human work is.

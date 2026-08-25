# Completed Department Confirmation Routing Design

## Problem

The department intake hook runs before normal task routing for every group message. A completed department still applies the final-confirmation keyword classifier to exact replies such as `同意` and `确认`, replies that the department was already created, and returns `handled`. The normal Codex task therefore never receives the user's agreement.

## Decision

A completed department is not an active design conversation. Its non-command messages must always pass through to normal task handling. Duplicate provisioning remains protected by the design state transition and transaction layer, while explicit department operations continue to use `/department` commands.

## Alternatives Rejected

- Narrow the confirmation keyword list: any retained ordinary-language keyword can still collide with normal work.
- Add conversational heuristics around `同意` and `确认`: this recreates an ambiguous natural-language classifier after the department workflow has already ended.

## Verification

Add an integration regression test that builds a real completed design state and proves every explicit confirmation phrase is returned as `pass` with no department reply. Run the focused regression test, department unit and integration tests, type checking, and package/build checks.

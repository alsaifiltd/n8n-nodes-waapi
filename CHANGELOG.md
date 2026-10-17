# 0.1.3 — 2026-10-17

- Enable WAAPI as an AI Agent tool for JSON-based actions and searches.
- Hide binary uploads and attachment downloads from AI tool operation choices and reject them before any API request when imported as tools.
- Document AI Agent setup for the n8n review demo.

# 0.1.2 — 2026-10-17

- Update the package author contact to info@digital-shift.us for n8n ownership verification and integration support.

# 0.1.1 — 2026-10-17

- Explicitly declare that the action node uses normal workflow inputs, satisfying n8n's published-package scanner without enabling incompatible binary operations as AI tools.

# 0.1.0 — 2026-10-16

- Add the WAAPI action node with 84 actions and 3 searches matching the WAAPI Zapier integration.
- Add the WAAPI Trigger node with 8 event presets and server-discovered event choices.
- Add scoped API-key credentials, dynamic account and record selectors, template field mapping, campaign personalization, and native binary file handling.
- Verify webhook signatures against exact request bytes, require fresh timestamps, and isolate test and production subscriptions.
- Add execution-scoped idempotency references, pagination, linked output items, error handling, tests, example workflows, and a manual provenance publishing workflow.

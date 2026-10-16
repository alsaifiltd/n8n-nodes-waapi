# n8n-nodes-waapi

Connect [WAAPI](https://waapi.chat) to n8n to send WhatsApp and supported channel messages, manage customers and conversations, and start workflows from signed WAAPI events.

**Release status:** 0.1.0 is a source release candidate. It has not been published to npm or verified by n8n. Public installation becomes available after npm publication; n8n Cloud installation requires n8n verification. See [RELEASE.md](RELEASE.md) for the remaining steps.

## Nodes

- **WAAPI** provides **84 actions and 3 searches**, matching the maintained WAAPI Zapier integration.
- **WAAPI Trigger** provides **8 event presets**, including a general event selector that discovers new supported events from WAAPI.

| Resource | What you can do |
| --- | --- |
| Message | Send WhatsApp text or approved templates; send supported channel text, image, video, audio, document, sticker, location, contact, interactive, and reaction messages; mark incoming messages read; show typing; upload files; download attachments; read and list messages. |
| Contact | Create, update, upsert, find by exact phone/external ID/email, tag, delete where retention permits, and record actual customer permission or opt-outs. |
| Conversation | Find, read, list, read history, assign/unassign a team member, close/reopen, and manage tags. |
| Template | Find, read, list, inspect fields, create drafts, create and submit, edit, submit drafts, delete where permitted, sync, and upload header samples. |
| Campaign | Create/edit drafts with customer audiences and personalization, launch or schedule with an explicit permission declaration, cancel, delete, read, and list. |
| Automation | Create/edit drafts, pause, activate an already-tested saved flow, delete, read definitions, and read runs. Testing and version publication remain in the WAAPI editor. |
| Webhook | Create/edit/delete subscriptions, rotate signing secrets, test deliveries, inspect deliveries, and retry. |
| Workspace | Read workspace identity, usage, connected accounts, team members, teams, contact tags, event types, and the current operation catalog. |
| Custom API Request | Call current or future public v1 endpoints with the connected key's permissions. |

Triggers: **New Incoming Message**, **Message Status Changed**, **New Contact**, **Updated Contact**, **Conversation Changed**, **Campaign Status Changed**, **Automation Run Status Changed**, and **New WAAPI Event**.

## Install

After the package is published, self-hosted n8n owners can open **Settings → Community Nodes → Install** and enter `n8n-nodes-waapi`. After n8n verification, users with verified community nodes enabled can also find **WAAPI** in the n8n node picker, including on n8n Cloud.

For local development, use Node.js 24 and run:

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run dev
```

The official n8n development CLI may require Docker or Podman. Follow its startup instructions. To install a built release candidate on a self-hosted test instance, place the npm tarball in that instance and install it in its community-node directory, then restart n8n. Do not try to install this source-only version from the public registry before publication.

## Connect your WAAPI account

1. In WAAPI, open **Developer API → Keys** and create a workspace API key.
2. Include `usage:read` for the connection test, plus only the permissions your workflow needs.
3. In n8n, add a **WAAPI** node and create a **WAAPI API** credential. Paste the key into **API Key** and save it.
4. Choose the resource and operation. Choose records from dropdowns or map their IDs from earlier steps.

Examples: sending messages needs `messages:send`; account selectors need `messages:read`; template selectors need `templates:read`; customer changes need `contacts:write`; template authoring needs `templates:write`; campaign drafts need `campaigns:write`; campaign launch needs `campaigns:send`; automation changes need `automations:write`. Each record selector also requires its resource's read permission. API credentials use the fixed `https://waapi.chat/api/v1` public boundary; arbitrary hosts and API-path escapes are rejected.

The connection test does not grant permissions. Read-only keys stay read-only. Provider/channel availability, account state, customer permission, quotas, and provider rules still apply. Platform administration, billing, and provider credentials are outside this integration.

## Send an approved template

Choose **Message → Send WhatsApp Template Message**, then select the business WhatsApp number, customer phone, and template. **Template Values** loads the actual fields from that template. Map each value from an earlier step or enter a fixed value. Required values are checked before sending. Account and approval checks remain enforced by WAAPI.

For text replies, the WhatsApp customer reply window must be open. To begin a conversation outside that window, use a permitted approved template.

## Create a campaign

Choose **Campaign → Create Campaign Draft**, select the WhatsApp number and approved template, then choose customers or audience tags. Leaving both empty selects the subscribed customer segment; saving still creates only a draft. In **Personalization**, choose each template field and its source: customer name, phone, email, custom field, or the same value for everyone. Media headers require a shared file URL or a customer custom field containing the URL.

Creating or updating a campaign saves a draft. **Launch Campaign** requires **Recipient Permission Confirmed**. That declaration does not record customer permission or bypass WAAPI checks. Record existing affirmative permission with its actual source, time, business, message categories, and evidence before sending. Never treat an imported contact as proof of permission.

## Receive events

1. Configure n8n with a publicly reachable HTTPS webhook URL.
2. Add **WAAPI Trigger**, select the credential, and choose the event.
3. For **New WAAPI Event**, select the specific events from the live event list.
4. Start listening for a test event or activate the workflow. The node creates its signed subscription automatically and deletes it when n8n removes the webhook.

The credential needs `usage:read`, `webhooks:read`, and `webhooks:write`. Resource presets also need their read scope, such as `messages:read` or `contacts:read`, because the node enriches the event with the current owned record. General events retain their signed payload without a record lookup.

The node verifies HMAC-SHA256 over the timestamp and exact raw body before emitting data, rejects timestamps outside five minutes, and verifies the workspace. Signed event values take precedence over a later record state. Missing/deleted records retain the signed event; API permission or connection failures remain visible. Signed endpoint tests are acknowledged without starting a workflow.

Test and active endpoints store separate subscription IDs and signing secrets in n8n's workflow static data. Treat workflow exports/backups containing static data as sensitive. The secret is not included in trigger output. Do not rotate a trigger-owned subscription manually; re-enable the trigger to recreate it if its signing secret changes.

WAAPI delivers at least once. Trigger output **id** is the stable event ID, **resourceId** identifies the WAAPI record, and **eventType**, **eventCreatedAt**, and **workspaceId** describe the event. Use n8n's deduplication/storage steps if a workflow needs event-level deduplication. The trigger does not discard redeliveries whose downstream processing may have failed. WAAPI accepting a webhook acknowledges receipt by n8n; it does not prove that every downstream action succeeded.

## Files

**Upload Message File** and **Upload Template Header Sample** use the native binary file from an earlier node. Download a file with n8n's HTTP Request node first, then set **Input Binary Field** to that file's field name (usually `data`). Files must be non-empty and at most 16 MB; providers can impose lower limits. A template sample returns its upload handle.

**Get Message Attachment** downloads an owned attachment into the output binary field `data`, ready for another n8n node. Credentials are sent only to WAAPI and redirects are disabled.

## Retries, lists, and errors

Mutations automatically use a request reference scoped to the workflow, node, execution, loop run, and input item. Retrying the same item in the same execution reuses the reference. WAAPI protects identical requests for 24 hours and rejects changed payloads under that reference.

For retries that start a new execution, set **Additional Fields → Unique Request Reference** to a stable source event ID plus a step suffix. Reuse it only for the same operation and payload. Different workflow nodes remain isolated. Repeated loop iterations need different business references when they represent different intended actions.

List/search operations output one n8n item per result, with links to the input item. **Return All** follows API cursors; otherwise **Limit** caps the total. A search with no matches returns no items. n8n's **Always Output Data** setting can be used when the next step must handle that case.

Errors retain the HTTP status, API error code, support request ID, and item index when provided. Rate-limit errors show the server's retry delay. Configure **Retry On Fail** in node settings for retries. Configure the retry wait to respect WAAPI's reported delay. **Continue On Fail** emits a linked error item and continues with the next input. The node does not silently retry side effects.

## Sandbox and examples

Use a WAAPI integration sandbox key for synthetic testing. Sandbox sends, uploads, provider approvals, and delivery events are simulated. Future sandbox campaign schedules are inert and do not send automatically. Sandbox automation flows cannot activate provider or AI jobs. Real provider delivery and approval require separate live verification.

Import the JSON files in [examples](examples/) using n8n's **Import from File**:

- `find-contact.json`: manual customer lookup using a synthetic example phone number.
- `incoming-conversation.json`: a new incoming message loads its WAAPI conversation.
- `send-template.json`: a manual template-send starter. Select your account, template, recipient, and values before executing.

Examples contain no credentials and are inactive on import. Select your own WAAPI credential in every WAAPI node.

## Development

```sh
npm run lint
npm run typecheck
npm test
npm pack --ignore-scripts
```

The runtime has no external dependencies; n8n provides `n8n-workflow`. Build tools are development dependencies. The programmatic node handles dependent template/schema calls, safe partial template edits, campaign personalization, pagination, and binary transfers.

The checked-in `nodes/Waapi/catalog.json` is self-contained. In the private WAAPI development repository, regenerate it with `node scripts/generate-n8n-catalog.mjs` and check drift with `--check`. The public package does not load the Zapier app or private platform code at runtime or during its build.

## Compatibility and license

Built against `n8n-workflow` 2.16.0 using the official `@n8n/node-cli` 0.52.5. Package API version 1. Use Node.js 24 for development and release validation.

[MIT](LICENSE.md). WAAPI and other service names/logos remain their respective owners' trademarks.

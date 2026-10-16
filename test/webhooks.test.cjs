const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { hookContext, defaultResponse } = require('./helpers.cjs');
const { WaapiTrigger } = require('../dist/nodes/Waapi/WaapiTrigger.node');
const { verifySignature } = require('../dist/nodes/Waapi/WebhookHelpers');
const catalog = require('../dist/nodes/Waapi/catalog.json');

const secret = 'whsec_fixture_only_no_live_credential';
const url = 'https://n8n.example.test/webhook/node-id';
function stored(events = ['message.received']) {
	return {
		id: 'subscription-id',
		signingSecret: secret,
		targetUrl: url,
		eventTypes: events.slice().sort(),
		workspaceId: 'workspace-id',
		credentialId: 'credential-id',
		secretVersion: 1,
	};
}
function signed(event = {}, timestamp = String(Math.floor(Date.now() / 1000))) {
	const raw = Buffer.from(
		JSON.stringify({
			id: 'event-id',
			type: 'message.received',
			tenantId: 'workspace-id',
			createdAt: '2026-10-16T00:00:00.000Z',
			data: { id: 'message-id', status: 'sent' },
			...event,
		}),
	);
	const headers = {
		'X-WAAPI-Timestamp': timestamp,
		'X-WAAPI-Signature': `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`,
	};
	return { raw, headers };
}
function incoming(event = {}, options = {}) {
	const ctx = hookContext(options.params, options.respond);
	ctx.state.subscriptions = { [url]: stored(options.events) };
	const signature = signed(event, options.timestamp);
	ctx.context.getRequestObject = () => ({ rawBody: options.raw || signature.raw });
	ctx.context.getHeaderData = () => options.headers || signature.headers;
	return ctx;
}

test('all eight trigger choices subscribe to their documented events without replaying deleted subscriptions', async (t) => {
	assert.equal(catalog.triggers.length, 8);
	for (const trigger of catalog.triggers)
		await t.test(trigger.key, async () => {
			const ctx = hookContext(
				{ event: trigger.key, eventTypes: ['contact.deleted', 'message.edited'] },
				async (options) => {
					if (options.method === 'POST')
						return {
							statusCode: 201,
							body: { data: { id: 'subscription-id', signingSecret: secret } },
						};
					return defaultResponse(options);
				},
			);
			await new WaapiTrigger().webhookMethods.default.create.call(ctx.context);
			const create = ctx.calls.find((call) => call.method === 'POST');
			assert.deepEqual(
				create.body.eventTypes,
				(trigger.events.length ? trigger.events : ['contact.deleted', 'message.edited'])
					.slice()
					.sort(),
			);
			assert.equal(create.headers['Idempotency-Key'], undefined);
			assert.equal(ctx.state.subscriptions[url].workspaceId, 'workspace-id');
			assert.equal(ctx.state.subscriptions[url].signingSecret, secret);
		});
});

test('test and active workflow subscriptions keep separate secrets and cleanup', async () => {
	let next = 0;
	const ctx = hookContext({}, async (options) =>
		options.method === 'POST'
			? {
					statusCode: 201,
					body: { data: { id: `subscription-${++next}`, signingSecret: `secret-${next}` } },
				}
			: defaultResponse(options),
	);
	const methods = new WaapiTrigger().webhookMethods.default;
	await methods.create.call(ctx.context);
	const testUrl = 'https://n8n.example.test/webhook-test/node-id';
	ctx.setUrl(testUrl);
	await methods.create.call(ctx.context);
	assert.equal(ctx.state.subscriptions[url].signingSecret, 'secret-1');
	assert.equal(ctx.state.subscriptions[testUrl].signingSecret, 'secret-2');
	await methods.delete.call(ctx.context);
	assert.equal(ctx.state.subscriptions[testUrl], undefined);
	assert.equal(ctx.state.subscriptions[url].id, 'subscription-1');
	assert.match(ctx.calls.at(-1).url, /subscription-2$/);
});

test('activation detects changed event choices, paused subscriptions, and rotated secrets', async () => {
	const ctx = hookContext({}, async () => ({
		statusCode: 200,
		body: { data: { ...stored(), status: 'active' } },
	}));
	ctx.state.subscriptions = { [url]: stored() };
	const methods = new WaapiTrigger().webhookMethods.default;
	assert.equal(await methods.checkExists.call(ctx.context), true);
	ctx.params.event = 'message_status';
	assert.equal(await methods.checkExists.call(ctx.context), false);
	ctx.params.event = 'new_message';
	ctx.state.subscriptions[url].secretVersion = 2;
	assert.equal(await methods.checkExists.call(ctx.context), false);
});

test('cleanup tolerates a missing subscription and preserves state on permission failures', async () => {
	const ctx = hookContext({}, async () => ({
		statusCode: 404,
		body: { error: { code: 'RESOURCE_NOT_FOUND' } },
	}));
	ctx.state.subscriptions = { [url]: stored() };
	assert.equal(await new WaapiTrigger().webhookMethods.default.delete.call(ctx.context), true);
	assert.equal(ctx.state.subscriptions[url], undefined);
	const denied = hookContext({}, async () => ({
		statusCode: 403,
		body: { error: { message: 'Permission denied' } },
	}));
	denied.state.subscriptions = { [url]: stored() };
	await assert.rejects(new WaapiTrigger().webhookMethods.default.delete.call(denied.context));
	assert.ok(denied.state.subscriptions[url]);
});

test('webhooks verify exact raw bytes before fetching data and preserve the signed transition', async () => {
	const ctx = incoming(
		{},
		{
			respond: async () => ({
				statusCode: 200,
				body: { data: { id: 'message-id', status: 'read', body: 'Order update' } },
			}),
		},
	);
	const result = await new WaapiTrigger().webhook.call(ctx.context);
	const event = result.workflowData[0][0].json;
	assert.equal(event.id, 'event-id');
	assert.equal(event.resourceId, 'message-id');
	assert.equal(event.status, 'sent');
	assert.equal(event.body, 'Order update');
	assert.equal(JSON.stringify(event).includes(secret), false);
});

test('missing, modified, stale, future, and mismatched signatures return 401 without API calls', async () => {
	const cases = [
		{ headers: {} },
		{ raw: Buffer.from('{}') },
		{ timestamp: String(Math.floor(Date.now() / 1000) - 301) },
		{ timestamp: String(Math.floor(Date.now() / 1000) + 301) },
		{ headers: { ...signed().headers, 'X-WAAPI-Timestamp': 'not-a-number' } },
		{ headers: { ...signed().headers, 'X-WAAPI-Timestamp': '1234567890' } },
	];
	for (const options of cases) {
		const ctx = incoming({}, options);
		const result = await new WaapiTrigger().webhook.call(ctx.context);
		assert.equal(ctx.response.code, 401);
		assert.equal(result.noWebhookResponse, true);
		assert.equal(ctx.calls.length, 0);
	}
	const missing = incoming();
	missing.state.subscriptions = {};
	assert.equal((await new WaapiTrigger().webhook.call(missing.context)).noWebhookResponse, true);
	assert.equal(missing.response.code, 401);
});

test('signature timestamps reject duplicate fields and accept header case variations', () => {
	const { raw, headers } = signed();
	assert.equal(
		verifySignature(
			raw,
			Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
			secret,
		),
		true,
	);
	assert.equal(
		verifySignature(
			raw,
			{
				...headers,
				'X-WAAPI-Signature': `${headers['X-WAAPI-Signature']},t=${headers['X-WAAPI-Timestamp']}`,
			},
			secret,
		),
		false,
	);
});

test('events from another workspace are rejected; signed tests and unselected events are acknowledged quietly', async () => {
	const foreign = incoming({ tenantId: 'other-workspace' });
	await new WaapiTrigger().webhook.call(foreign.context);
	assert.equal(foreign.response.code, 400);
	assert.equal(foreign.calls.length, 0);
	for (const type of ['webhook.test', 'message.edited']) {
		const ctx = incoming({ type });
		const result = await new WaapiTrigger().webhook.call(ctx.context);
		assert.deepEqual(result.workflowData, []);
		assert.deepEqual(result.webhookResponse, { received: true });
	}
});

test('deleted resources retain signed data while API permission failures remain visible', async () => {
	const missing = incoming({}, { respond: async () => ({ statusCode: 404, body: {} }) });
	assert.equal(
		(await new WaapiTrigger().webhook.call(missing.context)).workflowData[0][0].json.resourceId,
		'message-id',
	);
	const denied = incoming(
		{},
		{
			respond: async () => ({
				statusCode: 403,
				body: { error: { message: 'Missing messages:read' } },
			}),
		},
	);
	await assert.rejects(new WaapiTrigger().webhook.call(denied.context), /Missing messages:read/);
});

test('generic events discover new event types and retain their original fields', async () => {
	const ctx = incoming(
		{ type: 'message.edited', data: { id: 'message-id', editedText: 'New text' } },
		{
			params: { event: 'waapi_event', eventTypes: ['message.edited'] },
			events: ['message.edited'],
		},
	);
	const result = await new WaapiTrigger().webhook.call(ctx.context);
	assert.equal(result.workflowData[0][0].json.editedText, 'New text');
	assert.equal(ctx.calls.length, 0);
});

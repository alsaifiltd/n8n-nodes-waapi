const assert = require('node:assert/strict');
const { operations } = require('../dist/nodes/Waapi/Properties');
const { Waapi } = require('../dist/nodes/Waapi/Waapi.node');

const fixture = {
	whatsappNumberId: 'number-id',
	channelId: 'channel-id',
	to: '15555550101',
	text: 'Order update',
	contactId: 'contact-id',
	campaignId: 'campaign-id',
	automationId: 'automation-id',
	conversationId: 'conversation-id',
	templateId: 'template-id',
	messageId: 'message-id',
	incomingMessageId: 'message-id',
	runId: 'run-id',
	userId: 'user-id',
	id: 'webhook-id',
	phone: '15555550101',
	name: 'Example record',
	language: 'en',
	category: 'UTILITY',
	source: 'Customer opt-in form',
	categories: ['UTILITY'],
	consentAt: '2026-10-16T00:00:00.000Z',
	evidenceReference: 'order:example',
	reason: 'Customer request',
	scope: 'BUSINESS_INITIATED',
	complianceAccepted: true,
	url: 'https://example.test/image.png',
	filename: 'example.png',
	file: 'data',
	messageType: 'image',
	format: 'IMAGE',
	tags: ['tag-id'],
	tag: 'tag-id',
	trigger: 'new_inbound_message',
	steps: '[]',
	targetUrl: 'https://example.test/webhook',
	eventTypes: ['message.received'],
	path: '/contacts',
	method: 'GET',
};
const optionalFixtures = {
	find_contact: { phone: fixture.phone },
	create_template: { body: 'Hello {{1}}', bodyExamples: ['Customer'] },
	create_template_draft: { body: 'Hello {{1}}' },
	update_template: { body: 'Updated body' },
	send_location: { latitude: 24.7, longitude: 46.7 },
	send_contacts: { customerName: 'Customer', customerPhone: fixture.phone },
	send_interactive: { message: 'Choose a reply', button1Title: 'Confirm', button1Id: 'confirm' },
	send_reaction: { originalMessageId: 'provider-id', emoji: '👍' },
	send_sticker: { mediaId: 'sticker-id' },
};

async function defaultResponse(options) {
	const url = new URL(options.url);
	const path = url.pathname.replace('/api/v1', '');
	let data;
	if (options.encoding === 'arraybuffer')
		return {
			statusCode: 200,
			body: Buffer.from('file contents'),
			headers: { 'content-type': 'image/png' },
		};
	if (path === '/me') data = { workspace: { id: 'workspace-id', name: 'Example workspace' } };
	else if (path.endsWith('/schema'))
		data = { fields: [{ key: 'body_1', label: 'Customer Name', required: true, section: 'body' }] };
	else if (path === '/templates/template-id' && options.method === 'GET')
		data = {
			id: 'template-id',
			components: [
				{ type: 'HEADER', format: 'TEXT', text: 'Order' },
				{ type: 'BODY', text: 'Hello {{1}}' },
				{ type: 'FOOTER', text: 'Support' },
			],
		};
	else if (
		options.method === 'GET' &&
		(path.split('/').length === 2 || path.endsWith('/consent') || path.endsWith('/messages'))
	)
		data = [{ id: 'record-id', name: 'Example', status: 'open', phone: fixture.phone }];
	else data = { id: 'result-id', ...options.body };
	return {
		statusCode: 200,
		headers: {},
		body: {
			data,
			meta: { requestId: 'request-id', pagination: { hasMore: false, nextCursor: null } },
		},
	};
}

function executeContext(key, overrides = {}, respond = defaultResponse) {
	const operation = operations.find((entry) => entry.key === key);
	const params = {
		resource: operation.resource,
		operation: key,
		returnAll: false,
		limit: 50,
		variables: { value: { body_1: 'Customer' } },
		personalization: { values: [{ field: 'body.1', source: 'contact.name' }] },
		additionalFields: { ...optionalFixtures[key] },
	};
	for (const field of operation.fields.filter((field) => field.required))
		params[field.key] = fixture[field.key] ?? field.default ?? 'example';
	Object.assign(params, overrides);
	const calls = [];
	const node = {
		id: 'node-id',
		name: 'WAAPI',
		type: 'n8n-nodes-waapi.waapi',
		typeVersion: 1,
		position: [0, 0],
		parameters: params,
		credentials: { waapiApi: { id: 'credential-id', name: 'WAAPI' } },
	};
	const context = {
		getInputData: () => [{ json: { source: 'example' } }],
		getNodeParameter(name, index, fallback) {
			return Object.hasOwn(params, name)
				? typeof params[name] === 'function'
					? params[name](index)
					: params[name]
				: fallback;
		},
		getNode: () => node,
		getWorkflow: () => ({ id: 'workflow-id' }),
		getExecutionId: () => 'execution-id',
		getExecuteData: () => ({ runIndex: 0 }),
		isToolExecution: () => false,
		continueOnFail: () => false,
		helpers: {
			async httpRequestWithAuthentication(name, options) {
				assert.equal(name, 'waapiApi');
				calls.push(options);
				return respond(options, calls.length);
			},
			assertBinaryData: () => ({ fileName: 'input.png', mimeType: 'image/png' }),
			getBinaryDataBuffer: async () => Buffer.from('file contents'),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({
				data: buffer.toString('base64'),
				fileName,
				mimeType,
			}),
		},
	};
	return { context, calls, params, node, execute: () => new Waapi().execute.call(context) };
}

function hookContext(overrides = {}, respond = defaultResponse) {
	const state = {};
	let targetUrl = 'https://n8n.example.test/webhook/node-id';
	const params = { event: 'new_message', ...overrides };
	const calls = [];
	const node = {
		id: 'node-id',
		name: 'WAAPI Trigger',
		type: 'n8n-nodes-waapi.waapiTrigger',
		typeVersion: 1,
		position: [0, 0],
		credentials: { waapiApi: { id: 'credential-id', name: 'WAAPI' } },
		parameters: params,
	};
	const response = {
		code: 200,
		body: undefined,
		status(value) {
			this.code = value;
			return this;
		},
		json(value) {
			this.body = value;
			return this;
		},
	};
	const context = {
		getNode: () => node,
		getWorkflow: () => ({ id: 'workflow-id' }),
		getNodeParameter: (name, fallback) => (Object.hasOwn(params, name) ? params[name] : fallback),
		getNodeWebhookUrl: () => targetUrl,
		getWorkflowStaticData: () => state,
		getMode: () => (targetUrl.includes('/webhook-test/') ? 'manual' : 'webhook'),
		getResponseObject: () => response,
		helpers: {
			async httpRequestWithAuthentication(name, options) {
				assert.equal(name, 'waapiApi');
				calls.push(options);
				return respond(options, calls.length);
			},
		},
	};
	return {
		context,
		calls,
		params,
		node,
		state,
		response,
		setUrl(value) {
			targetUrl = value;
		},
	};
}
module.exports = { executeContext, hookContext, defaultResponse, fixture };

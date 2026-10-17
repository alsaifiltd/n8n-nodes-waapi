const test = require('node:test');
const assert = require('node:assert/strict');
const { executeContext, defaultResponse } = require('./helpers.cjs');
const { operations, properties } = require('../dist/nodes/Waapi/Properties');
const { Waapi } = require('../dist/nodes/Waapi/Waapi.node');
const { apiUrl, getMany } = require('../dist/nodes/Waapi/GenericFunctions');
const { getTemplateFields } = require('../dist/nodes/Waapi/TemplateHelpers');
const { loadOptions } = require('../dist/nodes/Waapi/LoadOptions');
const { WaapiApi } = require('../dist/credentials/WaapiApi.credentials');
const { NodeHelpers } = require('n8n-workflow');

test('every Zapier-equivalent action and search runs and preserves item linking', async (t) => {
	assert.equal(operations.length, 87);
	assert.equal(operations.filter((item) => item.kind === 'action').length, 84);
	for (const operation of operations)
		await t.test(operation.key, async () => {
			const ctx = executeContext(operation.key);
			const [output] = await ctx.execute();
			assert.ok(output.length > 0, operation.key);
			assert.deepEqual(output[0].pairedItem, { item: 0 });
			assert.ok(ctx.calls.length);
			for (const call of ctx.calls) {
				assert.match(call.url, /^https:\/\/waapi\.chat\/api\/v1\//);
				assert.equal(call.disableFollowRedirect, true);
				assert.equal(call.headers['X-WAAPI-Integration'], 'n8n');
				if (call.method !== 'GET')
					assert.match(call.headers['Idempotency-Key'], /^n8n-[a-f0-9]{64}$/);
			}
		});
});

test('all operations and selectors have matching UI controls and registered loaders', () => {
	const node = new Waapi();
	const credential = new WaapiApi();
	assert.equal(
		credential.properties.find((item) => item.name === 'apiKey').typeOptions.password,
		true,
	);
	assert.equal(credential.test.request.url, '/me');
	assert.equal(
		credential.properties.find((item) => item.name === 'allowedDomains').default,
		'waapi.chat',
	);
	const visible = properties
		.filter((item) => item.name === 'operation')
		.flatMap((item) => item.options.map((option) => option.value));
	assert.deepEqual(new Set(visible), new Set(operations.map((item) => item.key)));
	const sendTemplate = operations.find((item) => item.key === 'send_template');
	const templateValues = properties.find((item) => item.name === 'variables');
	assert.deepEqual(templateValues.displayOptions.show.resource, [sendTemplate.resource]);
	for (const prop of properties.flatMap((prop) => [
		prop,
		...(prop.type === 'collection' ? prop.options : []),
	])) {
		if (prop.typeOptions?.loadOptionsMethod)
			assert.equal(typeof node.methods.loadOptions[prop.typeOptions.loadOptionsMethod], 'function');
	}
	assert.equal(node.description.usableAsTool, true);
});

test('AI tools expose JSON operations and reject binary operations before making requests', async () => {
	const regular = new Waapi().description;
	const tool = { ...regular, name: 'waapiTool' };
	const binary = new Set([
		'upload_message_file',
		'upload_template_sample',
		'get_message_attachment',
	]);
	for (const property of properties.filter((item) => item.name === 'operation')) {
		for (const option of property.options) {
			assert.equal(NodeHelpers.displayParameter({}, option, null, regular), true);
			assert.equal(NodeHelpers.displayParameter({}, option, null, tool), !binary.has(option.value));
		}
	}
	for (const key of binary) {
		const ctx = executeContext(key);
		ctx.context.isToolExecution = () => true;
		await assert.rejects(ctx.execute(), /regular WAAPI workflow step/);
		assert.equal(ctx.calls.length, 0);
	}
	const ctx = executeContext('find_contact');
	ctx.context.isToolExecution = () => true;
	const [output] = await ctx.execute();
	assert.ok(output.length);
	assert.equal(ctx.calls.length, 1);
});

test('API paths cannot escape the credential boundary, including nested encoding and redirects', () => {
	for (const path of [
		'https://evil.test',
		'//evil.test',
		'/../billing',
		'/%2e%2e/billing',
		'/%252e%252e/billing',
		'/contacts/../../admin',
		'/contacts\\admin',
		'/contacts#x',
		'/%2f..%2f..%2fadmin',
		'/%252f..%252fadmin',
	]) {
		assert.throws(() => apiUrl(path), undefined, path);
	}
	assert.equal(
		apiUrl('/contacts?search=Example%20Customer'),
		'https://waapi.chat/api/v1/contacts?search=Example%20Customer',
	);
});

test('retry references stay stable and distinguish workflow steps, loop runs, and items', async () => {
	const ctx = executeContext('send_whatsapp_text');
	await ctx.execute();
	await ctx.execute();
	assert.equal(ctx.calls[0].headers['Idempotency-Key'], ctx.calls[1].headers['Idempotency-Key']);
	ctx.context.getExecuteData = () => ({ runIndex: 1 });
	await ctx.execute();
	assert.notEqual(ctx.calls[1].headers['Idempotency-Key'], ctx.calls[2].headers['Idempotency-Key']);
	ctx.context.getInputData = () => [{ json: {} }, { json: {} }];
	await ctx.execute();
	assert.notEqual(ctx.calls[3].headers['Idempotency-Key'], ctx.calls[4].headers['Idempotency-Key']);
	ctx.params.additionalFields = { message_reference: 'order-123-send' };
	await ctx.execute();
	const custom = ctx.calls.at(-1).headers['Idempotency-Key'];
	ctx.context.getExecutionId = () => 'retried-execution';
	await ctx.execute();
	assert.equal(custom, ctx.calls.at(-1).headers['Idempotency-Key']);
	ctx.node.id = 'another-step';
	await ctx.execute();
	assert.notEqual(custom, ctx.calls.at(-1).headers['Idempotency-Key']);
});

test('pagination follows API cursors and respects the requested total', async () => {
	let page = 0;
	const ctx = executeContext('list_contacts', { limit: 3 }, async (options) => {
		assert.equal(options.qs.limit, page === 0 ? 3 : 1);
		if (page) assert.equal(options.qs.cursor, 'page-two');
		const records = page++ === 0 ? [{ id: 'one' }, { id: 'two' }] : [{ id: 'three' }];
		return {
			statusCode: 200,
			body: {
				data: records,
				meta: { pagination: { hasMore: page === 1, nextCursor: page === 1 ? 'page-two' : null } },
			},
		};
	});
	assert.deepEqual(
		(await ctx.execute())[0].map((row) => row.json.id),
		['one', 'two', 'three'],
	);
	const repeating = executeContext('list_contacts', {}, async () => ({
		statusCode: 200,
		body: { data: [], meta: { pagination: { hasMore: true, nextCursor: 'same' } } },
	}));
	await assert.rejects(
		getMany.call(repeating.context, '/contacts', {}, true),
		/invalid pagination cursor/,
	);
});

test('list and search results are separate n8n items', async () => {
	const ctx = executeContext('find_contact', {}, async () => ({
		statusCode: 200,
		body: { data: [{ id: 'one' }, { id: 'two' }] },
	}));
	assert.deepEqual(
		(await ctx.execute())[0].map((row) => row.json.id),
		['one', 'two'],
	);
	assert.equal(ctx.calls[0].qs.phone, '15555550101');
	const invalid = executeContext('find_contact', { additionalFields: {} });
	await assert.rejects(invalid.execute(), /phone number/);
});

test('API failures preserve useful status, support references, and the failing item index', async () => {
	for (const status of [401, 403, 409, 422, 429, 503]) {
		const ctx = executeContext('send_whatsapp_text', {}, async () => ({
			statusCode: status,
			headers: { 'retry-after': '15' },
			body: {
				error: { code: 'EXAMPLE_ERROR', message: 'Example failure' },
				meta: { requestId: 'req-example' },
			},
		}));
		await assert.rejects(ctx.execute(), (error) => {
			assert.equal(error.httpCode, String(status));
			assert.equal(error.context.itemIndex, 0);
			assert.match(error.description, /req-example/);
			if (status === 429) assert.match(error.description, /15 seconds/);
			return true;
		});
	}
});

test('Continue On Fail records the error and proceeds to the next input item', async () => {
	let call = 0;
	const ctx = executeContext('send_whatsapp_text', {}, async (options) =>
		++call === 1
			? { statusCode: 422, body: { error: { message: 'Reply window expired' } } }
			: defaultResponse(options),
	);
	ctx.context.continueOnFail = () => true;
	ctx.context.getInputData = () => [{ json: {} }, { json: {} }];
	const [output] = await ctx.execute();
	assert.match(output[0].json.error, /Reply window/);
	assert.equal(output[1].json.id, 'result-id');
	assert.deepEqual(output[1].pairedItem, { item: 1 });
});

test('template fields load dynamically and required values are checked before sending', async () => {
	const ctx = executeContext('send_template');
	const schema = await getTemplateFields.call({
		...ctx.context,
		getNodeParameter: () => 'template-id',
	});
	assert.equal(schema.fields[0].displayName, 'Customer Name');
	await ctx.execute();
	assert.deepEqual(ctx.calls.at(-1).body.variables, { body_1: 'Customer' });
	ctx.params.variables = { value: {} };
	await assert.rejects(ctx.execute(), /Customer Name/);
});

test('template edits preserve omitted components and explicitly remove the footer', async () => {
	const ctx = executeContext('update_template');
	await ctx.execute();
	assert.deepEqual(
		ctx.calls.at(-1).body.components.map((part) => part.type),
		['HEADER', 'BODY', 'FOOTER'],
	);
	ctx.params.additionalFields.removeFooter = true;
	await ctx.execute();
	assert.deepEqual(
		ctx.calls.at(-1).body.components.map((part) => part.type),
		['HEADER', 'BODY'],
	);
});

test('campaign personalization maps customer fields and launch requires explicit permission', async () => {
	const ctx = executeContext('create_campaign');
	await ctx.execute();
	const call = ctx.calls.at(-1);
	assert.equal(new URL(call.url).pathname, '/api/v1/campaigns');
	assert.deepEqual(call.body.audienceFilter.personalization.templateMappings, {
		'template-id:body.1': 'contact.name',
	});
	assert.equal(call.body.complianceAccepted, undefined);
	const blocked = executeContext('launch_campaign', { complianceAccepted: false });
	await assert.rejects(blocked.execute(), /Confirm recipient permission/);
	assert.equal(blocked.calls.length, 0);
	ctx.params.personalization = {
		values: [{ field: 'body.1', source: 'fixed', value: 'ORDER-123' }],
	};
	await ctx.execute();
	assert.equal(
		ctx.calls.at(-1).body.audienceFilter.personalization.templateMappings['template-id:body.1'],
		'literal:ORDER-123',
	);
});

test('binary uploads use n8n storage and attachment downloads return a native file', async () => {
	const ctx = executeContext('upload_message_file');
	await ctx.execute();
	assert.equal(ctx.calls[0].body.base64, Buffer.from('file contents').toString('base64'));
	assert.equal(ctx.calls[0].body.mimeType, 'image/png');
	ctx.context.helpers.getBinaryDataBuffer = async () => Buffer.alloc(16 * 1024 * 1024 + 1);
	await assert.rejects(ctx.execute(), /16 MB/);
	const download = executeContext('get_message_attachment');
	const [output] = await download.execute();
	assert.ok(output[0].binary.data);
	assert.equal(output[0].json.mimeType, 'image/png');
});

test('selectors paginate and constrain approved templates to the chosen WhatsApp account', async () => {
	const ctx = executeContext('send_template');
	const loaded = await loadOptions.list_templates.call({
		...ctx.context,
		getNodeParameter: (key, fallback) => ctx.params[key] ?? fallback,
	});
	assert.equal(loaded[0].value, 'record-id');
	assert.equal(ctx.calls[0].qs.whatsappNumberId, 'number-id');
	assert.equal(ctx.calls[0].qs.status, 'APPROVED');
});

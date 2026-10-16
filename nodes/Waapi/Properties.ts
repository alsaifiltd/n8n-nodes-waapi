import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import catalog from './catalog.json';

export interface CatalogField {
	key: string;
	label: string;
	required: boolean;
	type: string;
	description?: string;
	default?: string | number | boolean;
	choices?: string[] | Record<string, string>;
	loader?: string;
	list?: boolean;
}
export interface Operation {
	key: string;
	kind: string;
	resource: string;
	label: string;
	description: string;
	fields: CatalogField[];
}
export const operations: Operation[] = catalog.operations;
const primaryFields: Record<string, string[]> = {
	find_contact: ['phone', 'externalId', 'email'],
	send_location: ['latitude', 'longitude', 'locationName', 'address'],
	send_contacts: ['customerName', 'customerPhone'],
	send_interactive: ['message', 'button1Title', 'button1Id'],
	send_reaction: ['originalMessageId', 'emoji'],
	send_sticker: ['mediaId', 'url'],
	create_template: ['body'],
	create_template_draft: ['body'],
	update_template: ['body'],
	create_campaign: ['contactIds', 'tags'],
	update_campaign: ['contactIds', 'tags'],
};
export const isPrimaryField = (operation: string, field: CatalogField) =>
	field.required || primaryFields[operation]?.includes(field.key) === true;
const resources = [
	['automation', 'Automation'],
	['campaign', 'Campaign'],
	['contact', 'Contact'],
	['conversation', 'Conversation'],
	['api', 'Custom API Request'],
	['message', 'Message'],
	['template', 'Template'],
	['webhook', 'Webhook'],
	['workspace', 'Workspace'],
];
const jsonFields = new Set([
	'customFields',
	'steps',
	'payload',
	'templateMappings',
	'audienceFilter',
	'components',
	'buttons',
	'filters',
	'query',
]);
const collectionOperations = new Set([
	'get_users',
	'get_teams',
	'get_contact_tags',
	'get_event_types',
	'get_customer_permission',
	'get_conversation_messages',
]);
export const isListOperation = (key: string) =>
	key.startsWith('list_') || key.startsWith('find_') || collectionOperations.has(key);

function property(field: CatalogField, operation: Operation): INodeProperties {
	const result: INodeProperties = {
		displayName: field.label,
		name: field.key,
		type: 'string',
		default: '',
		...(field.required ? { required: true } : {}),
		...(field.description ? { description: field.description } : {}),
	};
	result.default = field.default ?? '';
	if (field.type === 'boolean') {
		result.type = 'boolean';
		result.default = field.default === true;
	} else if (['integer', 'number'].includes(field.type)) {
		result.type = 'number';
		result.default = Number(field.default) || 0;
	} else if (field.type === 'datetime') result.type = 'dateTime';
	else if (jsonFields.has(field.key) || (operation.key === 'api_request' && field.key === 'body')) {
		result.type = 'json';
		result.default = ['steps', 'components', 'buttons'].includes(field.key) ? '[]' : '{}';
	} else if (field.type === 'text') result.typeOptions = { rows: 4 };
	if (field.choices) {
		result.type = field.list ? 'multiOptions' : 'options';
		const options: INodePropertyOptions[] = (
			Array.isArray(field.choices)
				? field.choices.map((value) => [value, value])
				: Object.entries(field.choices)
		).map(([value, name]) => ({ name, value }));
		if (!field.required && !field.list && field.default === undefined)
			options.unshift({ name: 'No Change', value: '' });
		result.options = options;
		result.default = field.list ? [] : (field.default ?? (field.required ? options[0].value : ''));
	}
	if (field.loader || ['tags', 'tag'].includes(field.key)) {
		result.type = field.list ? 'multiOptions' : 'options';
		result.displayName = `${field.label} ${field.list ? 'Names or IDs' : 'Name or ID'}`;
		result.typeOptions = {
			loadOptionsMethod: field.loader || 'list_tags',
			...(field.loader === 'list_templates' ? { loadOptionsDependsOn: ['whatsappNumberId'] } : {}),
		};
		result.description = `${field.description ? `${field.description} ` : ''}Choose from the list, or specify ${field.list ? 'IDs' : 'an ID'} using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.`;
		result.default = field.list ? [] : '';
	}
	if (field.list && result.type === 'string') {
		result.typeOptions = { multipleValues: true, multipleValueButtonText: 'Add Value' };
		result.default = [];
	}
	if (field.key === 'file') {
		result.displayName = 'Input Binary Field';
		result.default = 'data';
		result.description =
			'The field containing the file from an earlier node, such as an HTTP Request download. Files can be up to 16 MB; provider limits may be lower.';
	}
	if (field.key === 'reference' || field.key === 'message_reference') {
		result.displayName = 'Unique Request Reference';
		result.description =
			'Optional business reference for retries across executions. Include an event ID and step suffix. Identical retries are protected for 24 hours. A reference is generated automatically for this execution when omitted.';
	}
	return result;
}

const templateVariables: INodeProperties = {
	displayName: 'Template Values',
	name: 'variables',
	type: 'resourceMapper',
	default: { mappingMode: 'defineBelow', value: null },
	noDataExpression: true,
	required: true,
	typeOptions: {
		loadOptionsDependsOn: ['templateId', 'whatsappNumberId'],
		resourceMapper: {
			resourceMapperMethod: 'getTemplateFields',
			hideNoDataError: true,
			addAllFields: true,
			supportAutoMap: false,
			mode: 'add',
			fieldWords: { singular: 'template value', plural: 'template values' },
		},
	},
	description:
		'Fill the fields from the selected approved template. You can map values from earlier workflow steps.',
	displayOptions: { show: { resource: ['message'], operation: ['send_template'] } },
};

const personalization: INodeProperties = {
	displayName: 'Personalization',
	name: 'personalization',
	type: 'fixedCollection',
	typeOptions: { multipleValues: true },
	default: {},
	placeholder: 'Add Template Value',
	description: 'Choose where each template value comes from for each customer',
	displayOptions: {
		show: { resource: ['campaign'], operation: ['create_campaign', 'update_campaign'] },
	},
	options: [
		{
			name: 'values',
			displayName: 'Values',
			values: [
				{
					displayName: 'Template Field Name or ID',
					name: 'field',
					type: 'options',
					default: '',
					typeOptions: {
						loadOptionsMethod: 'getCampaignFields',
						loadOptionsDependsOn: ['templateId'],
					},
					description:
						'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					required: true,
				},
				{
					displayName: 'Value Source',
					name: 'source',
					type: 'options',
					default: 'contact.name',
					options: [
						{ name: 'Customer Custom Field', value: 'custom' },
						{ name: 'Customer Email', value: 'attribute.email' },
						{ name: 'Customer Name', value: 'contact.name' },
						{ name: 'Customer Phone Number', value: 'contact.phoneNumber' },
						{ name: 'Same Value for Everyone', value: 'fixed' },
					],
				},
				{
					displayName: 'Shared Value',
					name: 'value',
					type: 'string',
					default: '',
					required: true,
					displayOptions: { show: { source: ['fixed'] } },
				},
				{
					displayName: 'Customer Field',
					name: 'customField',
					type: 'string',
					default: '',
					required: true,
					displayOptions: { show: { source: ['custom'] } },
				},
			],
		},
	],
};

export const properties: INodeProperties[] = [
	{
		displayName: 'Resource',
		name: 'resource',
		type: 'options',
		noDataExpression: true,
		options: resources.map(([value, name]) => ({ name, value })),
		default: 'message',
	},
	...resources.map(([resource]): INodeProperties => {
		const parameter: INodeProperties = {
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [resource] } },
			options: operations
				.filter((item) => item.resource === resource)
				.map((item) => ({
					name: item.label,
					value: item.key,
					description: item.description,
					action: item.label,
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
			default: '',
		};
		parameter.default =
			resource === 'message'
				? 'send_whatsapp_text'
				: operations.find((item) => item.resource === resource)!.key;
		return parameter;
	}),
	...operations.flatMap((operation) => {
		const show = { show: { resource: [operation.resource], operation: [operation.key] } };
		const fields = operation.fields.filter((field) => !['limit', 'cursor'].includes(field.key));
		const required = fields
			.filter((field) => isPrimaryField(operation.key, field))
			.map((field) => ({ ...property(field, operation), displayOptions: show }));
		const optional = fields
			.filter((field) => !isPrimaryField(operation.key, field))
			.map((field) => property(field, operation));
		const result: INodeProperties[] = [...required];
		if (isListOperation(operation.key)) {
			result.push(
				{
					displayName: 'Return All',
					name: 'returnAll',
					type: 'boolean',
					default: false,
					description: 'Whether to return all results or only up to a given limit',
					displayOptions: show,
				},
				{
					displayName: 'Limit',
					name: 'limit',
					type: 'number',
					default: 50,
					typeOptions: { minValue: 1 },
					description: 'Max number of results to return',
					displayOptions: { show: { ...show.show, returnAll: [false] } },
				},
			);
		}
		if (optional.length)
			result.push({
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: show,
				options: optional.sort((a, b) => a.displayName.localeCompare(b.displayName)),
			});
		return result;
	}),
	templateVariables,
	personalization,
	{
		displayName: 'Campaigns are saved as drafts. Use Launch Campaign when you are ready to send.',
		name: 'campaignNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { operation: ['create_campaign', 'update_campaign'] } },
	},
];

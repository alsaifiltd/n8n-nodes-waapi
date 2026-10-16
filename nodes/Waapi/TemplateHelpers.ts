import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	ResourceMapperFields,
} from 'n8n-workflow';
import { getRecord, idPath, jsonObject, jsonValue, type ApiContext } from './GenericFunctions';

interface TemplateField {
	key: string;
	label: string;
	required: boolean;
	section?: string;
	buttonIndex?: number;
}
interface TemplateSchema {
	fields: TemplateField[];
}

export async function templateSchema(
	this: ApiContext,
	templateId: string,
): Promise<TemplateSchema> {
	return (await getRecord.call(
		this,
		idPath('templates', templateId, '/schema'),
	)) as unknown as TemplateSchema;
}

export async function getTemplateFields(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const templateId = this.getNodeParameter('templateId', '') as string;
	if (!templateId) return { fields: [] };
	const schema = await templateSchema.call(this, templateId);
	return {
		fields: schema.fields.map((field) => ({
			id: field.key,
			displayName: field.label,
			required: field.required,
			defaultMatch: false,
			canBeUsedToMatch: false,
			display: true,
			type: 'string',
		})),
	};
}

export async function templateValues(
	this: ApiContext,
	templateId: string,
	mapped: unknown,
): Promise<IDataObject> {
	const values = jsonObject((mapped as IDataObject | undefined)?.value, 'Template Values');
	const schema = await templateSchema.call(this, templateId);
	for (const field of schema.fields) {
		if (
			field.required &&
			(values[field.key] === undefined || values[field.key] === null || values[field.key] === '')
		) {
			throw new Error(`Enter a value for ${field.label}.`);
		}
	}
	return values;
}

export function templateBody(input: IDataObject): IDataObject {
	if (!input.components && !input.body)
		throw new Error('Enter the template message body or supply Components JSON.');
	const mediaHeader = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(input.headerFormat));
	if (!input.components && mediaHeader && !input.headerSampleHandle) {
		throw new Error(
			'Upload the template header sample first, then use its handle in Header Sample Upload Handle.',
		);
	}
	const components = input.components
		? jsonValue(input.components, 'Components JSON')
		: [
				...(mediaHeader
					? [
							{
								type: 'HEADER',
								format: input.headerFormat,
								example: { header_handle: [input.headerSampleHandle] },
							},
						]
					: input.header && input.headerFormat !== 'NONE'
						? [
								{
									type: 'HEADER',
									format: 'TEXT',
									text: input.header,
									...(input.headerExample
										? { example: { header_text: [input.headerExample] } }
										: {}),
								},
							]
						: []),
				{
					type: 'BODY',
					text: input.body,
					...(Array.isArray(input.bodyExamples) && input.bodyExamples.length
						? { example: { body_text: [input.bodyExamples] } }
						: {}),
				},
				...(input.footer ? [{ type: 'FOOTER', text: input.footer }] : []),
				...(input.buttons
					? [{ type: 'BUTTONS', buttons: jsonValue(input.buttons, 'Buttons', []) }]
					: []),
			];
	if (!Array.isArray(components) || !components.length)
		throw new Error('Template components must be a non-empty JSON array.');
	return {
		channelId: input.whatsappNumberId,
		name: input.name,
		language: input.language,
		category: input.category,
		components,
	};
}

export async function templateUpdate(this: ApiContext, input: IDataObject): Promise<IDataObject> {
	if (input.components) {
		const components = jsonValue(input.components, 'Components JSON');
		if (!Array.isArray(components) || !components.length)
			throw new Error('Template components must be a non-empty JSON array.');
		return { ...(input.category ? { category: input.category } : {}), components };
	}
	const selected = await getRecord.call(this, idPath('templates', input.templateId));
	let components = (selected.components as IDataObject[]).map((part) => ({ ...part }));
	const replace = (type: string, part?: IDataObject) => {
		components = components.filter((value) => value.type !== type);
		if (part) components.push(part);
	};
	if (input.body) {
		const previous = components.find((part) => part.type === 'BODY') || {};
		replace('BODY', {
			...previous,
			type: 'BODY',
			text: input.body,
			...(Array.isArray(input.bodyExamples) && input.bodyExamples.length
				? { example: { body_text: [input.bodyExamples] } }
				: {}),
		});
	}
	if (input.headerFormat === 'NONE') replace('HEADER');
	else if (input.header || ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(input.headerFormat))) {
		const edited = templateBody({ ...input, body: 'Header edit' }).components as IDataObject[];
		replace(
			'HEADER',
			edited.find((part) => part.type === 'HEADER'),
		);
	}
	if (input.removeFooter === true) replace('FOOTER');
	else if (input.footer) replace('FOOTER', { type: 'FOOTER', text: input.footer });
	if (input.buttons) {
		const buttons = jsonValue(input.buttons, 'Buttons', []);
		if (!Array.isArray(buttons)) throw new Error('Buttons must be a JSON array.');
		replace('BUTTONS', buttons.length ? { type: 'BUTTONS', buttons } : undefined);
	}
	const order = ['HEADER', 'BODY', 'FOOTER', 'BUTTONS'];
	components.sort((a, b) => order.indexOf(String(a.type)) - order.indexOf(String(b.type)));
	return { ...(input.category ? { category: input.category } : {}), components };
}

export async function campaignFields(this: ApiContext, templateId: string) {
	const schema = await templateSchema.call(this, templateId);
	const selected = await getRecord.call(this, idPath('templates', templateId));
	const fields = schema.fields.map((field) => {
		const section = field.section || field.key.split('_')[0];
		const index = field.buttonIndex ?? Number(field.key.split('_')[1]) - 1;
		return {
			key: field.key,
			label: field.label,
			media: false,
			mappingKey:
				section === 'button'
					? `button.${index}.${field.key.slice(`button_${index + 1}_`.length)}`
					: `${section}.${field.key.slice(section.length + 1)}`,
		};
	});
	if (
		(selected.components as IDataObject[] | undefined)?.some(
			(part) =>
				part.type === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(part.format)),
		)
	) {
		fields.push({
			key: 'header_media',
			label: 'Header File URL',
			mappingKey: 'header_media',
			media: true,
		});
	}
	return fields;
}

export async function getCampaignFields(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const id = this.getNodeParameter('templateId', '') as string;
	if (!id) return [];
	return (await campaignFields.call(this, id)).map((field) => ({
		name: field.label,
		value: field.mappingKey,
	}));
}

export async function campaignBody(this: ApiContext, input: IDataObject): Promise<IDataObject> {
	const scheduled = input.scheduledAt ? new Date(String(input.scheduledAt)) : undefined;
	if (scheduled && Number.isNaN(scheduled.getTime()))
		throw new Error('Enter a valid Scheduled Time including its timezone.');
	if (input.audienceFilter)
		return {
			name: input.name,
			channelId: input.whatsappNumberId,
			templateId: input.templateId,
			...(scheduled ? { scheduledAt: scheduled.toISOString() } : {}),
			audienceFilter: jsonObject(input.audienceFilter, 'Advanced Audience Settings'),
		};
	const fields = await campaignFields.call(this, String(input.templateId));
	const rows = (input.personalization as { values?: IDataObject[] } | undefined)?.values || [];
	const mappings: IDataObject = input.templateMappings
		? jsonObject(input.templateMappings, 'Personalization Mappings')
		: {};
	const seen = new Set<string>();
	for (const row of rows) {
		const field = fields.find((value) => value.mappingKey === row.field);
		if (!field || seen.has(field.mappingKey))
			throw new Error('Choose each campaign template field once.');
		seen.add(field.mappingKey);
		if (row.source === 'fixed') {
			if (row.value === undefined || row.value === '')
				throw new Error(`Enter the shared value for ${field.label}.`);
			mappings[field.mappingKey] = `literal:${row.value}`;
		} else if (row.source === 'custom') {
			if (!/^[a-zA-Z0-9_.-]+$/.test(String(row.customField || '')))
				throw new Error(`Enter a valid customer field for ${field.label}.`);
			mappings[field.mappingKey] = `attribute.${row.customField}`;
		} else if (
			!field.media &&
			['contact.name', 'contact.phoneNumber', 'attribute.email'].includes(String(row.source))
		) {
			mappings[field.mappingKey] = row.source;
		} else throw new Error(`Choose a valid value source for ${field.label}.`);
	}
	for (const field of fields)
		if (!mappings[field.mappingKey]) throw new Error(`Choose where ${field.label} comes from.`);
	return {
		name: input.name,
		channelId: input.whatsappNumberId,
		templateId: input.templateId,
		...(scheduled ? { scheduledAt: scheduled.toISOString() } : {}),
		audienceFilter: {
			mode: Array.isArray(input.contactIds) && input.contactIds.length ? 'manual' : 'segment',
			...(Array.isArray(input.contactIds) && input.contactIds.length
				? { contactIds: input.contactIds }
				: { tags: input.tags || [] }),
			personalization: {
				templateMappings: Object.fromEntries(
					Object.entries(mappings).map(([key, value]) => [`${input.templateId}:${key}`, value]),
				),
			},
		},
	};
}

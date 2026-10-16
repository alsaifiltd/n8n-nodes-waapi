import type { IDataObject, IExecuteFunctions, IHttpRequestMethods } from 'n8n-workflow';
import {
	apiRequest,
	getMany,
	getRecord,
	idPath,
	jsonObject,
	jsonValue,
	present,
} from './GenericFunctions';
import { campaignBody, templateBody, templateUpdate, templateValues } from './TemplateHelpers';
import { uploadFile } from './Files';

const readResources: Record<string, [string, string]> = {
	contact: ['contacts', 'contactId'],
	message: ['messages', 'messageId'],
	conversation: ['conversations', 'conversationId'],
	template: ['templates', 'templateId'],
	campaign: ['campaigns', 'campaignId'],
	automation: ['automations', 'automationId'],
	automation_run: ['automation-runs', 'runId'],
	channel: ['channels', 'channelId'],
	webhook_subscriptions: ['webhook-subscriptions', 'id'],
	webhook_deliveries: ['webhook-deliveries', 'id'],
};
const workspacePaths: Record<string, string> = {
	get_workspace: '/me',
	get_usage: '/usage',
	get_operations: '/operations',
	get_users: '/users',
	get_teams: '/teams',
	get_contact_tags: '/contact-tags',
	get_event_types: '/webhook-event-types',
};

function contactBody(input: IDataObject, updating = false): IDataObject {
	return present({
		...Object.fromEntries(
			[
				'phone',
				'name',
				'email',
				'externalId',
				'tags',
				'marketingStatus',
				'marketingConsentSource',
				'marketingConsentAt',
				'optOutReason',
			].map((key) => [key, input[key]]),
		),
		...(!updating || input.source ? { source: input.source || 'n8n' } : {}),
		...(input.customFields !== undefined
			? { customFields: jsonObject(input.customFields, 'Custom Fields') }
			: {}),
	});
}

function guidedMessage(type: string, input: IDataObject): unknown {
	if (input.payload) return jsonValue(input.payload, 'Advanced Message Details');
	if (type === 'location') {
		if (
			input.latitude === undefined ||
			input.longitude === undefined ||
			!Number.isFinite(Number(input.latitude)) ||
			!Number.isFinite(Number(input.longitude))
		)
			throw new Error('Enter the location latitude and longitude.');
		return present({
			latitude: Number(input.latitude),
			longitude: Number(input.longitude),
			name: input.locationName,
			address: input.address,
		});
	}
	if (type === 'contacts') {
		if (!input.customerName || !input.customerPhone)
			throw new Error('Enter the contact name and phone number.');
		return [
			{
				name: { formatted_name: input.customerName },
				phones: [{ phone: input.customerPhone, type: 'CELL' }],
			},
		];
	}
	if (type === 'interactive') {
		const buttons = [1, 2, 3]
			.filter((index) => input[`button${index}Title`])
			.map((index) => ({
				type: 'reply',
				reply: {
					id: input[`button${index}Id`] || `choice_${index}`,
					title: input[`button${index}Title`],
				},
			}));
		if (!input.message || !buttons.length)
			throw new Error('Enter the message and at least one reply button.');
		return { type: 'button', body: { text: input.message }, action: { buttons } };
	}
	if (type === 'reaction') {
		if (!input.originalMessageId || !input.emoji)
			throw new Error('Enter the original provider message ID and reaction emoji.');
		return { message_id: input.originalMessageId, emoji: input.emoji };
	}
	if (type === 'sticker') {
		if (!input.mediaId && !input.url)
			throw new Error('Choose an uploaded sticker ID or enter its HTTPS URL.');
		return input.mediaId ? { id: input.mediaId } : { link: input.url };
	}
	throw new Error('Choose a supported message type.');
}

export async function performOperation(
	this: IExecuteFunctions,
	key: string,
	input: IDataObject,
	itemIndex: number,
	reference: string,
): Promise<unknown> {
	const write = async (method: IHttpRequestMethods, path: string, body: unknown = {}) =>
		(await apiRequest.call(this, method, path, { body, reference })).data;
	const list = async (path: string, query: IDataObject = {}) =>
		getMany.call(
			this,
			path,
			query,
			this.getNodeParameter('returnAll', itemIndex, false) as boolean,
			this.getNodeParameter('limit', itemIndex, 50) as number,
		);
	if (key.startsWith('list_')) {
		const resource = key.slice(5).replaceAll('_', '-');
		return await list(`/${resource}`, jsonObject(input.filters, 'Optional Filters'));
	}
	if (key.startsWith('get_') && readResources[key.slice(4)]) {
		const [resource, identifier] = readResources[key.slice(4)];
		return await getRecord.call(this, idPath(resource, input[identifier]));
	}
	if (workspacePaths[key]) {
		if (['get_users', 'get_teams', 'get_contact_tags', 'get_event_types'].includes(key))
			return await list(workspacePaths[key]);
		return await getRecord.call(this, workspacePaths[key]);
	}
	switch (key) {
		case 'upload_message_file':
		case 'upload_template_sample':
			return await uploadFile.call(
				this,
				input,
				itemIndex,
				key === 'upload_template_sample',
				reference,
			);
		case 'mark_message_read':
		case 'show_typing_indicator':
			return await write(
				'POST',
				idPath(
					'messages',
					input.incomingMessageId,
					key === 'mark_message_read' ? '/read' : '/typing',
				),
			);
		case 'create_contact':
		case 'upsert_contact':
			return await write(
				'POST',
				key === 'create_contact' ? '/contacts' : '/contacts/upsert',
				contactBody(input),
			);
		case 'update_contact':
			return await write('PATCH', idPath('contacts', input.contactId), contactBody(input, true));
		case 'delete_contact':
			return await write('DELETE', idPath('contacts', input.contactId));
		case 'add_contact_tags':
			return await write('POST', idPath('contacts', input.contactId, '/tags'), {
				tags: input.tags,
			});
		case 'remove_contact_tag':
			return await write(
				'DELETE',
				idPath('contacts', input.contactId, `/tags/${encodeURIComponent(String(input.tag))}`),
			);
		case 'record_customer_permission':
			return await write('POST', idPath('contacts', input.contactId, '/consent'), {
				whatsappNumberId: input.whatsappNumberId,
				categories: input.categories,
				source: input.source,
				consentAt: input.consentAt,
				evidence: { reference: input.evidenceReference },
				resumeAfterOptOut: input.resumeAfterOptOut === true,
			});
		case 'record_customer_opt_out':
			return await write('POST', idPath('contacts', input.contactId, '/opt-out'), {
				reason: input.reason,
				scope: input.scope || 'BUSINESS_INITIATED',
			});
		case 'get_customer_permission':
			return await list(idPath('contacts', input.contactId, '/consent'));
		case 'send_whatsapp_text':
			return await write('POST', '/messages/text', {
				whatsappNumberId: input.whatsappNumberId,
				to: input.to,
				text: input.text,
			});
		case 'send_channel_text':
			return await write('POST', '/messages/text', {
				channelId: input.channelId,
				to: input.to,
				text: input.text,
			});
		case 'send_template':
			return await write('POST', '/messages/template', {
				whatsappNumberId: input.whatsappNumberId,
				to: input.to,
				templateId: input.templateId,
				variables: await templateValues.call(
					this,
					String(input.templateId),
					this.getNodeParameter('variables', itemIndex, {}),
				),
			});
		case 'send_image':
		case 'send_video':
		case 'send_audio':
		case 'send_document': {
			const type = key.slice(5);
			return await write('POST', `/messages/${type}`, {
				channelId: input.channelId,
				to: input.to,
				[type]: {
					link: input.url,
					...(type !== 'audio' && input.caption ? { caption: input.caption } : {}),
					...(type === 'document' && input.filename ? { filename: input.filename } : {}),
				},
			});
		}
		case 'send_location':
		case 'send_contacts':
		case 'send_interactive':
		case 'send_reaction':
		case 'send_sticker': {
			const type = key.slice(5);
			return await write('POST', `/messages/${type}`, {
				channelId: input.channelId,
				to: input.to,
				[type]: guidedMessage(type, input),
			});
		}
		case 'close_conversation':
		case 'reopen_conversation':
		case 'unassign_conversation':
			return await write(
				'POST',
				idPath('conversations', input.conversationId, `/${key.split('_')[0]}`),
			);
		case 'assign_conversation':
			return await write('POST', idPath('conversations', input.conversationId, '/assign'), {
				userId: input.userId,
			});
		case 'add_conversation_tag':
			return await write('POST', idPath('conversations', input.conversationId, '/tags'), {
				tag: input.tag,
			});
		case 'remove_conversation_tag':
			return await write(
				'DELETE',
				idPath(
					'conversations',
					input.conversationId,
					`/tags/${encodeURIComponent(String(input.tag))}`,
				),
			);
		case 'get_conversation_messages':
			return await list(idPath('conversations', input.conversationId, '/messages'));
		case 'create_template':
		case 'create_template_draft':
			return await write(
				'POST',
				key === 'create_template' ? '/templates' : '/templates/drafts',
				templateBody(input),
			);
		case 'update_template':
			return await write(
				'PATCH',
				idPath('templates', input.templateId),
				await templateUpdate.call(this, input),
			);
		case 'submit_template':
			return await write('POST', idPath('templates', input.templateId, '/submit'));
		case 'delete_template':
			return await write('DELETE', idPath('templates', input.templateId));
		case 'sync_templates':
			return await write('POST', '/templates/sync', { channelId: input.whatsappNumberId });
		case 'get_template_fields':
			return await getRecord.call(this, idPath('templates', input.templateId, '/schema'));
		case 'create_campaign':
		case 'update_campaign':
			return await write(
				key === 'create_campaign' ? 'POST' : 'PATCH',
				key === 'create_campaign' ? '/campaigns' : idPath('campaigns', input.campaignId),
				await campaignBody.call(this, {
					...input,
					personalization: this.getNodeParameter('personalization', itemIndex, {}) as IDataObject,
				}),
			);
		case 'launch_campaign':
			if (input.complianceAccepted !== true)
				throw new Error('Confirm recipient permission before launching this campaign.');
			return await write('POST', idPath('campaigns', input.campaignId, '/send'), {
				complianceAccepted: true,
			});
		case 'cancel_campaign':
			return await write('POST', idPath('campaigns', input.campaignId, '/cancel'));
		case 'delete_campaign':
			return await write('DELETE', idPath('campaigns', input.campaignId));
		case 'create_automation': {
			const steps = jsonValue(input.steps, 'Flow Steps', []);
			if (!Array.isArray(steps)) throw new Error('Flow Steps must be a JSON array.');
			return await write('POST', '/automations', {
				name: input.name,
				trigger: input.trigger,
				steps,
			});
		}
		case 'update_automation': {
			const steps = input.steps ? jsonValue(input.steps, 'Flow Steps', []) : undefined;
			if (steps !== undefined && !Array.isArray(steps))
				throw new Error('Flow Steps must be a JSON array.');
			return await write(
				'PATCH',
				idPath('automations', input.automationId),
				present({ name: input.name, steps }),
			);
		}
		case 'pause_automation':
		case 'activate_automation':
			return await write('PATCH', idPath('automations', input.automationId), {
				status: key === 'pause_automation' ? 'paused' : 'active',
			});
		case 'delete_automation':
			return await write('DELETE', idPath('automations', input.automationId));
		case 'create_webhook':
		case 'update_webhook':
			return await write(
				key === 'create_webhook' ? 'POST' : 'PATCH',
				key === 'create_webhook'
					? '/webhook-subscriptions'
					: idPath('webhook-subscriptions', input.id),
				{
					name: input.name,
					targetUrl: input.targetUrl,
					eventTypes: input.eventTypes,
					status: input.status || 'active',
				},
			);
		case 'delete_webhook':
			return await write('DELETE', idPath('webhook-subscriptions', input.id));
		case 'test_webhook':
		case 'rotate_webhook_secret':
			return await write(
				'POST',
				idPath(
					'webhook-subscriptions',
					input.id,
					key === 'test_webhook' ? '/test' : '/rotate-secret',
				),
			);
		case 'retry_webhook_delivery':
			return await write('POST', idPath('webhook-deliveries', input.id, '/retry'));
		case 'find_contact': {
			const query = present({
				phone: input.phone,
				externalId: input.externalId,
				email: input.email,
			});
			if (!Object.keys(query).length)
				throw new Error(
					'Provide a phone number, external customer ID, or email to find the contact.',
				);
			return await list('/contacts', query);
		}
		case 'find_template':
			return await list(
				'/templates',
				present({
					name: input.name,
					language: input.language,
					whatsappNumberId: input.whatsappNumberId,
				}),
			);
		case 'find_conversation':
			return await list(
				'/conversations',
				present({ contactId: input.contactId, channelId: input.channelId, status: input.status }),
			);
		case 'api_request': {
			const method = String(input.method || 'GET') as IHttpRequestMethods;
			if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method))
				throw new Error('Choose GET, POST, PATCH, or DELETE.');
			return await apiRequest.call(this, method, String(input.path), {
				query: jsonObject(input.query, 'Query Parameters'),
				...(method !== 'GET' ? { body: jsonObject(input.body, 'Request Body') } : {}),
				reference,
			});
		}
		default:
			throw new Error('Choose a supported WAAPI operation.');
	}
}

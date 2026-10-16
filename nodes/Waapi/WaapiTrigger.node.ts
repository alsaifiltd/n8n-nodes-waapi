import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import catalog from './catalog.json';
import { apiRequest, getRecord, idPath, nodeError } from './GenericFunctions';
import { loadOptions } from './LoadOptions';
import {
	currentSubscription,
	removeSubscription,
	selectedEvents,
	subscriptions,
	verifySignature,
	webhookUrl,
	type Subscription,
} from './WebhookHelpers';

const readPaths: Record<string, string> = {
	new_contact: 'contacts',
	updated_contact: 'contacts',
	new_message: 'messages',
	message_status: 'messages',
	conversation_changed: 'conversations',
	campaign_status: 'campaigns',
	automation_status: 'automation-runs',
};

export class WaapiTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WAAPI Trigger',
		name: 'waapiTrigger',
		icon: { light: 'file:waapi.svg', dark: 'file:waapi.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"].replaceAll("_", " ")}}',
		description:
			'Start a workflow when a signed WAAPI message, customer, conversation, campaign, or automation event arrives',
		defaults: { name: 'WAAPI Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'waapiApi', required: true }],
		webhooks: [
			{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' },
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				default: 'new_message',
				options: catalog.triggers
					.map((trigger) => ({ name: trigger.label, value: trigger.key }))
					.sort((a, b) => a.name.localeCompare(b.name)),
				description: 'The event that starts this workflow',
			},
			{
				displayName: 'Event Names or IDs',
				name: 'eventTypes',
				type: 'multiOptions',
				default: [],
				required: true,
				typeOptions: { loadOptionsMethod: 'list_events' },
				displayOptions: { show: { event: ['waapi_event'] } },
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName:
					'Use a public HTTPS webhook URL. Your API key needs usage:read, webhooks:read, webhooks:write, and the read permission for the selected resource.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
		],
	};
	methods = { loadOptions };
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const stored = currentSubscription.call(this);
				if (
					!stored?.signingSecret ||
					stored.credentialId !== (this.getNode().credentials?.waapiApi.id ?? null)
				)
					return false;
				if (JSON.stringify(stored.eventTypes) !== JSON.stringify(selectedEvents.call(this)))
					return false;
				try {
					const remote = await getRecord.call(this, idPath('webhook-subscriptions', stored.id));
					return (
						remote.targetUrl === stored.targetUrl &&
						remote.status === 'active' &&
						Number(remote.secretVersion || 1) === stored.secretVersion &&
						JSON.stringify((remote.eventTypes as string[]).slice().sort()) ===
							JSON.stringify(stored.eventTypes)
					);
				} catch (error) {
					if ((error as { httpCode?: string }).httpCode === '404') return false;
					throw nodeError(this, error);
				}
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const targetUrl = webhookUrl.call(this);
				const eventTypes = selectedEvents.call(this);
				const credentialId = this.getNode().credentials?.waapiApi.id ?? null;
				const account = await getRecord.call(this, '/me');
				const workspaceId = (account.workspace as IDataObject)?.id;
				if (typeof workspaceId !== 'string')
					throw new NodeOperationError(
						this.getNode(),
						'WAAPI did not return the connected workspace. Reconnect your API key.',
					);
				const state = subscriptions.call(this);
				const previous = state[targetUrl];
				if (previous && previous.credentialId === credentialId) {
					await removeSubscription.call(this, previous);
					delete state[targetUrl];
				}
				// A deleted subscription must never be replayed through an idempotency key.
				const response = await apiRequest.call(this, 'POST', '/webhook-subscriptions', {
					body: {
						name: `n8n: ${this.getNode().name}`.slice(0, 120),
						targetUrl,
						eventTypes,
						status: 'active',
					},
				});
				const created = response.data as IDataObject;
				if (
					typeof created.id !== 'string' ||
					typeof created.signingSecret !== 'string' ||
					!created.signingSecret
				) {
					throw new NodeOperationError(
						this.getNode(),
						'WAAPI did not return a webhook signing secret. Re-enable the trigger to try again.',
					);
				}
				state[targetUrl] = {
					id: created.id,
					signingSecret: created.signingSecret,
					targetUrl,
					eventTypes,
					credentialId,
					workspaceId,
					secretVersion: 1,
				};
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const targetUrl = webhookUrl.call(this);
				const state = subscriptions.call(this);
				if (state[targetUrl]) {
					await removeSubscription.call(this, state[targetUrl]);
					delete state[targetUrl];
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const request = this.getRequestObject() as ReturnType<IWebhookFunctions['getRequestObject']> & {
			rawBody?: Buffer;
		};
		const raw = request.rawBody || (Buffer.isBuffer(request.body) ? request.body : undefined);
		const stored: Subscription | undefined = currentSubscription.call(this);
		const headers = this.getHeaderData() as IDataObject;
		if (
			!stored ||
			stored.credentialId !== (this.getNode().credentials?.waapiApi.id ?? null) ||
			!raw ||
			!verifySignature(raw, headers, stored.signingSecret)
		) {
			this.getResponseObject()
				.status(401)
				.json({ message: 'WAAPI webhook signature is missing, invalid, or expired.' });
			return { noWebhookResponse: true };
		}
		let event: IDataObject;
		try {
			event = JSON.parse(raw.toString('utf8')) as IDataObject;
		} catch {
			this.getResponseObject()
				.status(400)
				.json({ message: 'WAAPI event must contain valid JSON.' });
			return { noWebhookResponse: true };
		}
		if (
			!event ||
			typeof event.id !== 'string' ||
			typeof event.type !== 'string' ||
			event.tenantId !== stored.workspaceId ||
			!event.data ||
			typeof event.data !== 'object' ||
			Array.isArray(event.data)
		) {
			this.getResponseObject()
				.status(400)
				.json({ message: 'WAAPI event does not match this workspace or event format.' });
			return { noWebhookResponse: true };
		}
		if (
			event.type === 'webhook.test' ||
			!stored.eventTypes.includes(event.type) ||
			!selectedEvents.call(this).includes(event.type)
		) {
			return { webhookResponse: { received: true }, workflowData: [] };
		}
		const data = event.data as IDataObject;
		const resourceId = data.id || data.messageId || data.contactId || data.conversationId || null;
		const key = this.getNodeParameter('event', 'new_message') as string;
		let record: IDataObject = {};
		if (readPaths[key] && typeof resourceId === 'string') {
			try {
				record = await getRecord.call(this, idPath(readPaths[key], resourceId));
			} catch (error) {
				if ((error as { httpCode?: string }).httpCode !== '404') throw nodeError(this, error);
			}
		}
		return {
			webhookResponse: { received: true },
			workflowData: [
				[
					{
						json: {
							...record,
							...data,
							resourceId,
							id: event.id,
							eventType: event.type,
							eventCreatedAt: event.createdAt,
							workspaceId: event.tenantId,
							...(['new_contact', 'updated_contact'].includes(key)
								? { contactId: resourceId }
								: {}),
						},
					},
				],
			],
		};
	}
}

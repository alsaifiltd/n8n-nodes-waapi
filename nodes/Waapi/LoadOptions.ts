import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';
import { getMany } from './GenericFunctions';

const directories: Record<string, { path: string; fields: string[]; query?: IDataObject }> = {
	list_whatsapp_numbers: {
		path: '/whatsapp-numbers',
		fields: ['displayName', 'phoneNumber'],
		query: { provider: 'WHATSAPP' },
	},
	list_channels: { path: '/channels', fields: ['provider', 'displayName', 'phoneNumber'] },
	list_templates: { path: '/templates', fields: ['name', 'language', 'status'] },
	list_contacts: { path: '/contacts', fields: ['name', 'phone'] },
	list_conversations: { path: '/conversations', fields: ['id', 'status'] },
	list_messages: { path: '/messages', fields: ['type', 'body', 'createdAt'] },
	list_incoming_messages: {
		path: '/messages',
		fields: ['body', 'createdAt'],
		query: { direction: 'inbound' },
	},
	list_automation_runs: {
		path: '/automation-runs',
		fields: ['automationId', 'state', 'createdAt'],
	},
	list_webhook_subscriptions: { path: '/webhook-subscriptions', fields: ['name', 'status'] },
	list_webhook_deliveries: {
		path: '/webhook-deliveries',
		fields: ['eventType', 'status', 'createdAt'],
	},
	list_users: { path: '/users', fields: ['name'] },
	list_teams: { path: '/teams', fields: ['name'] },
	list_campaigns: { path: '/campaigns', fields: ['name', 'status'] },
	list_automations: { path: '/automations', fields: ['name', 'status'] },
	list_events: { path: '/webhook-event-types', fields: ['name'] },
	list_tags: { path: '/contact-tags', fields: ['name'] },
};

export const loadOptions = Object.fromEntries(
	Object.entries(directories).map(([key, directory]) => [
		key,
		async function (this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
			const query = { ...directory.query };
			if (key === 'list_templates') {
				const number = this.getNodeParameter('whatsappNumberId', '') as string;
				if (number) query.whatsappNumberId = number;
				const operation = this.getNodeParameter('operation', '') as string;
				if (['send_template', 'create_campaign', 'update_campaign'].includes(operation))
					query.status = 'APPROVED';
			}
			const rows = await getMany.call(this, directory.path, query, true);
			return rows
				.map((row) => ({
					name:
						directory.fields
							.map((field) => row[field])
							.filter((value) => typeof value === 'string' && value)
							.join(' — ')
							.slice(0, 180) || String(row.id),
					value: String(row.id),
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
		},
	]),
);

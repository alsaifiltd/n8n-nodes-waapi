import { createHmac, timingSafeEqual } from 'crypto';
import type { IDataObject, IHookFunctions, IWebhookFunctions } from 'n8n-workflow';
import catalog from './catalog.json';
import { apiRequest, idPath, nodeError } from './GenericFunctions';

export interface Subscription {
	id: string;
	signingSecret: string;
	targetUrl: string;
	eventTypes: string[];
	credentialId: string | null;
	workspaceId: string;
	secretVersion: number;
}
type HookContext = IHookFunctions | IWebhookFunctions;

export function selectedEvents(this: HookContext): string[] {
	const key = this.getNodeParameter('event', 'new_message') as string;
	const trigger = catalog.triggers.find((item) => item.key === key);
	if (!trigger) throw new Error('Choose the WAAPI event that starts this workflow.');
	const events = trigger.events.length
		? trigger.events
		: (this.getNodeParameter('eventTypes', []) as string[]);
	if (
		!Array.isArray(events) ||
		!events.length ||
		events.some((event) => typeof event !== 'string' || !event)
	)
		throw new Error('Choose at least one WAAPI event.');
	return [...new Set(events)].sort();
}

export function webhookUrl(this: HookContext): string {
	const url = this.getNodeWebhookUrl('default');
	if (!url || new URL(url).protocol !== 'https:')
		throw new Error('Configure n8n with a public HTTPS webhook URL before enabling this trigger.');
	return url;
}

export function subscriptions(this: HookContext): Record<string, Subscription> {
	const data = this.getWorkflowStaticData('node');
	if (!data.subscriptions) data.subscriptions = {};
	return data.subscriptions as unknown as Record<string, Subscription>;
}

export function currentSubscription(this: HookContext): Subscription | undefined {
	return subscriptions.call(this)[webhookUrl.call(this)];
}

export async function removeSubscription(
	this: IHookFunctions,
	subscription: Subscription,
): Promise<void> {
	try {
		await apiRequest.call(this, 'DELETE', idPath('webhook-subscriptions', subscription.id), {
			body: {},
		});
	} catch (error) {
		if ((error as { httpCode?: string }).httpCode !== '404') throw nodeError(this, error);
	}
}

export function verifySignature(
	raw: Buffer,
	headers: IDataObject,
	secret: string,
	now = Date.now(),
): boolean {
	const header = (name: string) =>
		Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
	const timestamp = header('x-waapi-timestamp');
	const signature = header('x-waapi-signature');
	if (
		typeof timestamp !== 'string' ||
		!/^\d{10,11}$/.test(timestamp) ||
		typeof signature !== 'string' ||
		!secret
	)
		return false;
	const parts = signature.split(',').map((value) => value.trim());
	const times = parts.filter((value) => value.startsWith('t='));
	const signatures = parts.filter((value) => value.startsWith('v1='));
	if (
		times.length !== 1 ||
		signatures.length !== 1 ||
		times[0] !== `t=${timestamp}` ||
		!/^v1=[a-f0-9]{64}$/i.test(signatures[0])
	)
		return false;
	if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) return false;
	const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
	return timingSafeEqual(expected, Buffer.from(signatures[0].slice(3), 'hex'));
}

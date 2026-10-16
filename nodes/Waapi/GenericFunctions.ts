import { createHash } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const API_BASE = 'https://waapi.chat/api/v1';
export type ApiContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;
export interface ApiEnvelope {
	data: unknown;
	meta?: { requestId?: string; pagination?: { nextCursor?: string | null; hasMore?: boolean } };
}

export function apiUrl(path: string): string {
	if (!path.startsWith('/') || path.startsWith('//') || /[\\#\s]/.test(path)) {
		throw new Error('Enter a relative WAAPI API path, such as /contacts.');
	}
	let decoded = path.split('?')[0];
	for (let index = 0; index < 8; index++) {
		const next = decodeURIComponent(decoded);
		if (/(^|\/)\.{1,2}(\/|$)|[\\?#\r\n]/.test(next)) {
			throw new Error('Use a WAAPI public API path without parent-directory segments.');
		}
		if (next === decoded) break;
		if (index === 7) throw new Error('The API path contains too many encoded characters.');
		decoded = next;
	}
	const url = new URL(`${API_BASE}${path}`);
	if (url.origin !== 'https://waapi.chat' || !url.pathname.startsWith('/api/v1/')) {
		throw new Error('Requests must stay within the WAAPI public API.');
	}
	return url.href;
}

export function idPath(resource: string, id: unknown, suffix = ''): string {
	if (typeof id !== 'string' || !id.trim()) throw new Error('Choose a record or enter its ID.');
	return `/${resource}/${encodeURIComponent(id)}${suffix}`;
}

export function jsonValue(value: unknown, label: string, fallback: unknown = {}): unknown {
	if (value === undefined || value === null || value === '') return fallback;
	if (typeof value !== 'string') return value;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		/* Report a field-specific validation error below. */
	}
	if (parsed === undefined) throw new Error(`${label} must contain valid JSON.`);
	return parsed;
}

export function nodeError(
	context: ApiContext,
	error: unknown,
	itemIndex?: number,
): NodeApiError | NodeOperationError {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) {
		if (itemIndex !== undefined) error.context.itemIndex = itemIndex;
		return error;
	}
	return new NodeOperationError(context.getNode(), error as Error, { itemIndex });
}

export function jsonObject(value: unknown, label: string): IDataObject {
	const parsed = jsonValue(value, label);
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`${label} must be a JSON object.`);
	}
	return parsed as IDataObject;
}

export function present(input: IDataObject): IDataObject {
	return Object.fromEntries(
		Object.entries(input).filter(([, value]) => value !== undefined && value !== ''),
	);
}

export function requestKey(method: string, path: string, reference: string): string {
	return `n8n-${createHash('sha256')
		.update(JSON.stringify([method, path, reference]))
		.digest('hex')}`;
}

export async function apiRequest(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	options: { body?: unknown; query?: IDataObject; reference?: string } = {},
): Promise<ApiEnvelope> {
	const headers: Record<string, string> = {
		Accept: 'application/json',
		'X-WAAPI-Integration': 'n8n',
	};
	if (options.reference && method !== 'GET')
		headers['Idempotency-Key'] = requestKey(method, path, options.reference);
	const response = await this.helpers.httpRequestWithAuthentication.call(this, 'waapiApi', {
		method,
		url: apiUrl(path),
		headers,
		...(options.body !== undefined ? { body: options.body as IDataObject } : {}),
		...(options.query ? { qs: present(options.query) } : {}),
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		disableFollowRedirect: true,
		timeout: 30_000,
	});
	const status = response.statusCode as number;
	const payload = response.body as {
		data?: unknown;
		error?: { message?: string; code?: string };
		meta?: ApiEnvelope['meta'];
	};
	if (status < 200 || status >= 300) {
		let message = payload?.error?.message || `WAAPI returned HTTP ${status}.`;
		if (status === 401) message = 'Reconnect WAAPI with an active API key.';
		const details = [
			payload?.error?.code,
			payload?.meta?.requestId ? `Request ID: ${payload.meta.requestId}` : '',
		];
		if (status === 403) details.push('Check the API key permissions and workspace access.');
		if (status === 429) {
			const retryAfter = Number(response.headers?.['retry-after']);
			details.push(
				`Request limit reached. Retry after ${Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60} seconds. Enable Retry On Fail in node settings for automatic retries.`,
			);
		}
		throw new NodeApiError(this.getNode(), { message } as JsonObject, {
			message,
			description: details.filter(Boolean).join(' '),
			httpCode: String(status),
		});
	}
	return { data: payload?.data ?? payload ?? {}, ...(payload?.meta ? { meta: payload.meta } : {}) };
}

export async function getRecord(this: ApiContext, path: string): Promise<IDataObject> {
	return (await apiRequest.call(this, 'GET', path)).data as IDataObject;
}

export async function getMany(
	this: ApiContext,
	path: string,
	query: IDataObject = {},
	returnAll = false,
	limit = 50,
): Promise<IDataObject[]> {
	if (!returnAll && (!Number.isInteger(limit) || limit < 1))
		throw new Error('Limit must be a positive whole number.');
	const results: IDataObject[] = [];
	let cursor = typeof query.cursor === 'string' ? query.cursor : undefined;
	const seen = new Set<string>();
	do {
		const page = await apiRequest.call(this, 'GET', path, {
			query: {
				...query,
				limit: returnAll ? 100 : Math.min(100, limit - results.length),
				...(cursor ? { cursor } : {}),
			},
		});
		if (!Array.isArray(page.data)) throw new Error('WAAPI did not return a list of records.');
		results.push(...(page.data as IDataObject[]));
		const pagination = page.meta?.pagination;
		cursor = pagination?.hasMore ? pagination.nextCursor || undefined : undefined;
		if (pagination?.hasMore && (!cursor || seen.has(cursor)))
			throw new Error('WAAPI returned an invalid pagination cursor.');
		if (cursor) seen.add(cursor);
	} while (cursor && (returnAll || results.length < limit));
	return returnAll ? results : results.slice(0, limit);
}

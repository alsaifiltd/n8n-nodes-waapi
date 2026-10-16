import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class WaapiApi implements ICredentialType {
	name = 'waapiApi';
	displayName = 'WAAPI API';
	documentationUrl = 'https://waapi.chat/en/developers';
	icon = 'file:../nodes/Waapi/waapi.svg' as const;
	httpRequestNode = {
		name: 'WAAPI',
		docsUrl: 'https://waapi.chat/en/developers',
		apiBaseUrl: 'https://waapi.chat/api/v1',
	};
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Create a scoped key in WAAPI → Developer API → Keys. Include usage:read for the connection test and the permissions needed by your workflow.',
		},
		{
			displayName: 'Allowed HTTP Request Domains',
			name: 'allowedHttpRequestDomains',
			type: 'hidden',
			default: 'domains',
		},
		{
			displayName: 'Allowed Domains',
			name: 'allowedDomains',
			type: 'hidden',
			default: 'waapi.chat',
		},
	];
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
				'X-WAAPI-Integration': 'n8n',
			},
		},
	};
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://waapi.chat/api/v1',
			url: '/me',
			method: 'GET',
			disableFollowRedirect: true,
		},
	};
}

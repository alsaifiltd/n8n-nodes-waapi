import type { IDataObject, IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { apiRequest, apiUrl, idPath } from './GenericFunctions';

export async function uploadFile(
	this: IExecuteFunctions,
	input: IDataObject,
	itemIndex: number,
	templateSample: boolean,
	reference: string,
): Promise<unknown> {
	const field = String(input.file || 'data');
	const binary = this.helpers.assertBinaryData(itemIndex, field);
	const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, field);
	if (!buffer.length || buffer.length > 16 * 1024 * 1024)
		throw new Error('Choose a non-empty file of up to 16 MB.');
	return (
		await apiRequest.call(
			this,
			'POST',
			templateSample ? '/templates/sample-media' : '/media-uploads',
			{
				reference,
				body: {
					channelId: input.channelId,
					filename: input.filename || binary.fileName || 'file',
					mimeType: input.mimeType || binary.mimeType,
					base64: buffer.toString('base64'),
					...(templateSample ? { format: input.format } : { messageType: input.messageType }),
				},
			},
		)
	).data;
}

export async function downloadAttachment(
	this: IExecuteFunctions,
	messageId: string,
): Promise<INodeExecutionData> {
	const response = await this.helpers.httpRequestWithAuthentication.call(this, 'waapiApi', {
		url: apiUrl(idPath('messages', messageId, '/attachment')),
		method: 'GET',
		headers: { 'X-WAAPI-Integration': 'n8n' },
		encoding: 'arraybuffer',
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		disableFollowRedirect: true,
		timeout: 60_000,
	});
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new NodeApiError(
			this.getNode(),
			{ message: 'The WAAPI attachment could not be downloaded.' } as JsonObject,
			{ httpCode: String(response.statusCode) },
		);
	}
	const buffer = Buffer.isBuffer(response.body)
		? response.body
		: Buffer.from(response.body as ArrayBuffer);
	const filename = `waapi-attachment-${messageId}`;
	const mimeType = String(response.headers?.['content-type'] || 'application/octet-stream').split(
		';',
	)[0];
	return {
		json: { messageId, filename, mimeType, size: buffer.length },
		binary: { data: await this.helpers.prepareBinaryData(buffer, filename, mimeType) },
	};
}

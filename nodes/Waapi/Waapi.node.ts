import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { nodeError } from './GenericFunctions';
import { isPrimaryField, operations, properties } from './Properties';
import { performOperation } from './Operations';
import { downloadAttachment } from './Files';
import { getCampaignFields, getTemplateFields } from './TemplateHelpers';
import { loadOptions } from './LoadOptions';

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- Native binary uploads and downloads are incompatible with AI tool inputs.
export class Waapi implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'WAAPI',
		name: 'waapi',
		icon: { light: 'file:waapi.svg', dark: 'file:waapi.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"].replaceAll("_", " ")}}',
		description:
			'Send messages and manage customers, conversations, templates, campaigns, and automations with WAAPI',
		defaults: { name: 'WAAPI' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'waapiApi', required: true }],
		properties,
	};
	methods = {
		loadOptions: { ...loadOptions, getCampaignFields },
		resourceMapping: { getTemplateFields },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const key = this.getNodeParameter('operation', itemIndex) as string;
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = operations.find(
					(entry) => entry.key === key && entry.resource === resource,
				);
				if (!operation)
					throw new NodeOperationError(
						this.getNode(),
						'Choose a supported WAAPI resource and operation.',
					);
				const input: IDataObject = {
					...(this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject),
				};
				for (const field of operation.fields.filter(
					(field) => isPrimaryField(key, field) && !['limit', 'cursor'].includes(field.key),
				)) {
					input[field.key] = this.getNodeParameter(
						field.key,
						itemIndex,
						input[field.key] ?? field.default ?? '',
					) as IDataObject[string];
				}
				const customReference = input.reference || input.message_reference;
				const identity = [this.getWorkflow().id, this.getNode().id];
				const reference = JSON.stringify(
					customReference
						? [...identity, customReference]
						: [...identity, this.getExecutionId(), this.getExecuteData().runIndex ?? 0, itemIndex],
				);
				if (key === 'get_message_attachment') {
					output.push({
						...(await downloadAttachment.call(this, String(input.messageId))),
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				const result = await performOperation.call(this, key, input, itemIndex, reference);
				for (const row of Array.isArray(result) ? result : [result]) {
					output.push({
						json: row !== null && typeof row === 'object' ? (row as IDataObject) : { result: row },
						pairedItem: { item: itemIndex },
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw nodeError(this, error, itemIndex);
			}
		}
		return [output];
	}
}

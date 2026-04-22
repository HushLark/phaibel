// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — HTTP Data NodeCode
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
export class HttpNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'url', name: 'URL', description: 'The URL to request. Can reference a context key with {context_key} syntax.', type: 'string' },
        { key: 'method', name: 'Method', description: 'HTTP method.', type: 'string', default: 'GET', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
        { key: 'body_context_path', name: 'Body Context Path', description: 'Context key containing the request body.', type: 'string', isOptional: true },
        { key: 'headers', name: 'Headers', description: 'JSON object of headers.', type: 'string', isOptional: true },
        { key: 'response_context_path', name: 'Response Path', description: 'Context key to store the response body.', type: 'string', default: 'http_response' },
        { key: 'status_context_path', name: 'Status Path', description: 'Context key to store the HTTP status code.', type: 'string', default: 'http_status', isOptional: true },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'HTTP request completed successfully (2xx).' },
        { status: ResultStatus.ERROR, description: 'HTTP request failed or returned non-2xx.' },
    ];
    constructor() {
        super('http', 'HTTP Request', 'Makes an HTTP request and stores the response in context.', NodeCodeCategory.DATA);
    }
    async process(context) {
        const urlTemplate = this.getRequiredConfigValue('url');
        const method = this.getRequiredConfigValue('method', 'GET').toUpperCase();
        const responseContextPath = this.getRequiredConfigValue('response_context_path', 'http_response');
        const statusContextPath = this.getOptionalConfigValue('status_context_path', 'http_status');
        // Interpolate URL template with context values: {key} → context.get(key)
        const url = urlTemplate.replace(/\{(\w+)\}/g, (_, key) => {
            return String(context.get(key) ?? '');
        });
        // Build request options
        const init = { method };
        // Headers
        const headersRaw = this.getOptionalConfigValue('headers');
        if (headersRaw) {
            const headers = typeof headersRaw === 'string' ? JSON.parse(headersRaw) : headersRaw;
            init.headers = headers;
        }
        // Body
        const bodyPath = this.getOptionalConfigValue('body_context_path');
        if (bodyPath && context.has(bodyPath)) {
            const body = context.get(bodyPath);
            init.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
        try {
            const response = await fetch(url, init);
            const responseBody = await response.text();
            context.set(responseContextPath, responseBody);
            if (statusContextPath) {
                context.set(statusContextPath, response.status);
            }
            if (response.ok) {
                return this.result(ResultStatus.OK, `HTTP ${method} ${url} → ${response.status}`);
            }
            else {
                return this.result(ResultStatus.ERROR, `HTTP ${method} ${url} → ${response.status}: ${responseBody.substring(0, 200)}`);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `HTTP ${method} ${url} failed: ${message}`);
        }
    }
}

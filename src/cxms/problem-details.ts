// ─────────────────────────────────────────────────────────────────────────────
// CxMS — RFC 9457 Problem Details
// ─────────────────────────────────────────────────────────────────────────────
// Standard error responses for CxMS and PI APIs.
// See: https://www.rfc-editor.org/rfc/rfc9457
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'http';

export interface ProblemDetail {
    type: string;
    title: string;
    status: number;
    detail?: string;
    instance?: string;
}

/**
 * Send an RFC 9457 Problem Details JSON response.
 */
export function problemResponse(
    res: http.ServerResponse,
    status: number,
    title: string,
    detail?: string,
    instance?: string,
): void {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const body: ProblemDetail = {
        type: `https://phaibel.dev/errors/${slug}`,
        title,
        status,
    };
    if (detail) body.detail = detail;
    if (instance) body.instance = instance;

    res.writeHead(status, { 'Content-Type': 'application/problem+json' });
    res.end(JSON.stringify(body));
}

/** 400 Bad Request */
export function badRequest(res: http.ServerResponse, detail: string, instance?: string): void {
    problemResponse(res, 400, 'Bad Request', detail, instance);
}

/** 404 Not Found */
export function notFound(res: http.ServerResponse, detail: string, instance?: string): void {
    problemResponse(res, 404, 'Not Found', detail, instance);
}

/** 405 Method Not Allowed */
export function methodNotAllowed(res: http.ServerResponse, allowed: string[], instance?: string): void {
    res.setHeader('Allow', allowed.join(', '));
    problemResponse(res, 405, 'Method Not Allowed', `Allowed methods: ${allowed.join(', ')}`, instance);
}

/** 409 Conflict */
export function conflict(res: http.ServerResponse, detail: string, instance?: string): void {
    problemResponse(res, 409, 'Conflict', detail, instance);
}

/** 422 Unprocessable Entity (validation errors) */
export function unprocessable(res: http.ServerResponse, detail: string, instance?: string): void {
    problemResponse(res, 422, 'Unprocessable Entity', detail, instance);
}

/** 500 Internal Server Error */
export function serverError(res: http.ServerResponse, detail?: string, instance?: string): void {
    problemResponse(res, 500, 'Internal Server Error', detail || 'An unexpected error occurred', instance);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Send a JSON success response. */
export function jsonResponse(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

/** Read the request body as a string. */
export function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

/** Parse JSON body, returning null on failure. */
export async function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
    try {
        const raw = await readBody(req);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

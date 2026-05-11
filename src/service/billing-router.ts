// ─────────────────────────────────────────────────────────────────────────────
// Billing Router
//
//   POST /billing/checkout    (bearer) { interval: 'monthly'|'annual' }
//                             → { checkoutUrl }   (Stripe-hosted payment page)
//
//   GET  /billing/status      (bearer)
//                             → { plan, subscriptionStatus, currentPeriodEnd }
//
//   POST /billing/portal      (bearer)
//                             → { portalUrl }   (Stripe customer portal)
//
//   POST /billing/webhook     (no auth — Stripe-signature verified)
//                             → 200 OK
// ─────────────────────────────────────────────────────────────────────────────

import type http from 'node:http';
import { requireAuth } from '../auth/middleware.js';
import { findUserById, updateUser } from '../auth/user-store.js';
import { getStripe, getWebhookSecret, getStripePrices } from '../billing/stripe-client.js';
import { handleStripeEvent } from '../billing/webhook-handler.js';
import { debug } from '../utils/debug.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function err(res: http.ServerResponse, status: number, message: string): void {
    json(res, status, { error: message });
}

function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────────────────────────────────────

const SUCCESS_URL = process.env.PHAIBEL_STRIPE_SUCCESS_URL ?? 'https://phaibel.com/welcome?session={CHECKOUT_SESSION_ID}';
const CANCEL_URL  = process.env.PHAIBEL_STRIPE_CANCEL_URL  ?? 'https://phaibel.com/pricing?cancelled=1';

export async function handleBillingRoute(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
): Promise<boolean> {
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (!path.startsWith('/billing/')) return false;

    // ── POST /billing/checkout ────────────────────────────────────────
    if (method === 'POST' && path === '/billing/checkout') {
        const auth = await requireAuth(req, res);
        if (!auth) return true;

        let interval: string;
        try {
            const body = JSON.parse((await readRawBody(req)).toString());
            interval = body.interval === 'annual' ? 'annual' : 'monthly';
        } catch {
            interval = 'monthly';
        }

        const user = await findUserById(auth.userId);
        if (!user) return err(res, 404, 'User not found'), true;

        try {
            const stripe = await getStripe();
            const prices = await getStripePrices();
            const priceId = interval === 'annual' ? prices.pro_annual : prices.pro_monthly;
            if (!priceId) return err(res, 500, `Price ID for ${interval} plan not configured`), true;

            const session = await stripe.checkout.sessions.create({
                mode: 'subscription',
                payment_method_types: ['card'],
                line_items: [{ price: priceId, quantity: 1 }],
                customer_email: user.stripeCustomerId ? undefined : user.email,
                customer: user.stripeCustomerId ?? undefined,
                metadata: { userId: user.id },
                success_url: SUCCESS_URL,
                cancel_url: CANCEL_URL,
            });

            json(res, 200, { checkoutUrl: session.url });
        } catch (e) {
            debug('billing', `Checkout error: ${e}`);
            err(res, 500, 'Failed to create checkout session');
        }
        return true;
    }

    // ── GET /billing/status ───────────────────────────────────────────
    if (method === 'GET' && path === '/billing/status') {
        const auth = await requireAuth(req, res);
        if (!auth) return true;

        const user = await findUserById(auth.userId);
        if (!user) return err(res, 404, 'User not found'), true;

        json(res, 200, {
            plan: user.plan,
            subscriptionStatus: user.subscriptionStatus ?? null,
            currentPeriodEnd: user.currentPeriodEnd ?? null,
            byokProviders: Object.keys(user.byokKeys),
        });
        return true;
    }

    // ── POST /billing/portal ──────────────────────────────────────────
    if (method === 'POST' && path === '/billing/portal') {
        const auth = await requireAuth(req, res);
        if (!auth) return true;

        const user = await findUserById(auth.userId);
        if (!user?.stripeCustomerId) return err(res, 400, 'No active subscription'), true;

        try {
            const stripe = await getStripe();
            const session = await stripe.billingPortal.sessions.create({
                customer: user.stripeCustomerId,
                return_url: 'https://phaibel.com/settings',
            });
            json(res, 200, { portalUrl: session.url });
        } catch (e) {
            debug('billing', `Portal error: ${e}`);
            err(res, 500, 'Failed to open billing portal');
        }
        return true;
    }

    // ── POST /billing/webhook ─────────────────────────────────────────
    // Raw body required for Stripe signature verification — read before parsing.
    if (method === 'POST' && path === '/billing/webhook') {
        const rawBody = await readRawBody(req);
        const signature = req.headers['stripe-signature'] as string | undefined;

        if (!signature) return err(res, 400, 'Missing stripe-signature header'), true;

        try {
            const stripe = await getStripe();
            const webhookSecret = await getWebhookSecret();
            const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
            await handleStripeEvent(event);
            json(res, 200, { received: true });
        } catch (e) {
            debug('billing', `Webhook error: ${e}`);
            err(res, 400, `Webhook error: ${e instanceof Error ? e.message : String(e)}`);
        }
        return true;
    }

    return false;
}

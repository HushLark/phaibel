// ─────────────────────────────────────────────────────────────────────────────
// Stripe Client — thin wrapper that reads keys from secrets.json
// ─────────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';
import { loadSecrets } from '../config.js';

let _stripe: Stripe | null = null;

export async function getStripe(): Promise<Stripe> {
    if (_stripe) return _stripe;
    const secrets = await loadSecrets();
    const key = (secrets as Record<string, unknown>).stripeSecretKey as string | undefined;
    if (!key) throw new Error('stripeSecretKey not configured in secrets.json');
    _stripe = new Stripe(key, { apiVersion: '2026-04-22.dahlia' });
    return _stripe;
}

export async function getWebhookSecret(): Promise<string> {
    const secrets = await loadSecrets();
    const secret = (secrets as Record<string, unknown>).stripeWebhookSecret as string | undefined;
    if (!secret) throw new Error('stripeWebhookSecret not configured in secrets.json');
    return secret;
}

export async function getStripePrices(): Promise<{ pro_monthly: string; pro_annual: string }> {
    const secrets = await loadSecrets();
    const prices = (secrets as Record<string, unknown>).stripePrices as Record<string, string> | undefined;
    return {
        pro_monthly: prices?.pro_monthly ?? '',
        pro_annual:  prices?.pro_annual  ?? '',
    };
}

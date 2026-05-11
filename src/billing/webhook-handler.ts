// ─────────────────────────────────────────────────────────────────────────────
// Stripe Webhook Handler — processes subscription lifecycle events
//
// Events handled:
//   checkout.session.completed      → activate subscription, set plan to 'pro'
//   customer.subscription.updated   → sync plan/status changes
//   customer.subscription.deleted   → downgrade to 'byok'
//   invoice.payment_failed          → mark status as 'past_due'
// ─────────────────────────────────────────────────────────────────────────────

import type Stripe from 'stripe';
import { findUserByStripeCustomerId, updateUser, type SubscriptionStatus } from '../auth/user-store.js';
import { debug } from '../utils/debug.js';

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
        case 'checkout.session.completed':
            await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
            break;
        case 'customer.subscription.updated':
            await onSubscriptionUpdated(event.data.object as Stripe.Subscription);
            break;
        case 'customer.subscription.deleted':
            await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
            break;
        case 'invoice.payment_failed':
            await onPaymentFailed(event.data.object as Stripe.Invoice);
            break;
        default:
            debug('billing', `Unhandled Stripe event: ${event.type}`);
    }
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const customerId      = session.customer as string | null;
    const subscriptionId  = session.subscription as string | null;
    const userId          = session.metadata?.userId;

    if (!userId) {
        debug('billing', 'checkout.session.completed missing userId in metadata');
        return;
    }

    await updateUser(userId, {
        stripeCustomerId:     customerId    ?? undefined,
        stripeSubscriptionId: subscriptionId ?? undefined,
        plan: 'pro',
        subscriptionStatus: 'active',
        currentPeriodEnd: subscriptionId
            ? new Date(Date.now() + 30 * 86400 * 1000).toISOString() // filled in by subscription.updated
            : undefined,
    });

    debug('billing', `User ${userId} upgraded to pro (customer: ${customerId})`);
}

async function onSubscriptionUpdated(sub: Stripe.Subscription): Promise<void> {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const user = await findUserByStripeCustomerId(customerId);
    if (!user) {
        debug('billing', `subscription.updated: no user for customer ${customerId}`);
        return;
    }

    const status      = stripeStatusToLocal(sub.status);
    const itemPeriodEnd = sub.items.data[0]?.current_period_end;
    const periodEnd   = itemPeriodEnd ? new Date(itemPeriodEnd * 1000).toISOString() : undefined;
    const plan        = status === 'active' || status === 'trialing' ? 'pro' : 'byok';

    await updateUser(user.id, {
        subscriptionStatus: status,
        currentPeriodEnd: periodEnd ?? undefined,
        stripeSubscriptionId: sub.id,
        plan,
    });

    debug('billing', `User ${user.id} subscription updated → ${status} (${plan})`);
}

async function onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const user = await findUserByStripeCustomerId(customerId);
    if (!user) return;

    await updateUser(user.id, {
        plan: 'byok',
        subscriptionStatus: 'canceled',
        stripeSubscriptionId: undefined,
        currentPeriodEnd: undefined,
    });

    debug('billing', `User ${user.id} subscription cancelled → downgraded to byok`);
}

async function onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as Stripe.Customer).id;
    const user = await findUserByStripeCustomerId(customerId);
    if (!user) return;

    await updateUser(user.id, { subscriptionStatus: 'past_due' });
    debug('billing', `User ${user.id} payment failed → past_due`);
}

function stripeStatusToLocal(status: Stripe.Subscription.Status): SubscriptionStatus {
    switch (status) {
        case 'active':    return 'active';
        case 'trialing':  return 'trialing';
        case 'past_due':  return 'past_due';
        case 'canceled':  return 'canceled';
        case 'unpaid':    return 'unpaid';
        default:          return 'canceled';
    }
}

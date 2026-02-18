// frontend-user/scripts/subscription.js

/**
 * Subscription Management – OFFLINE VERSION
 * Handles free trial, subscription plans, expiry checks, and eligibility.
 * Stores subscription data in IndexedDB via db.js.
 */

import * as utils from './utils.js';
import * as db from './db.js';
import * as app from './app.js';
import * as ui from './ui.js';

// ==================== CONSTANTS ====================

const PLANS = {
    trial: {
        id: 'trial',
        name: 'Free Trial',
        price: 0,
        duration: 3 * 60 * 60 * 1000, // 3 hours in milliseconds
        durationText: '3 hours',
        features: [
            'Full access to all subjects',
            'All exam modes',
            'Detailed analytics',
            'No payment required'
        ],
        limitations: [
            'Time-limited (3 hours)',
            'One trial per user',
            'No certificate generation'
        ],
        ctaText: 'Start Free Trial',
        ctaColor: 'primary'
    },
    monthly: {
        id: 'monthly',
        name: 'Monthly Plan',
        price: 350,
        duration: 30 * 24 * 60 * 60 * 1000, // 30 days
        durationText: '30 days',
        features: [
            'Unlimited access',
            'All 8 subjects',
            'Detailed analytics',
            'Certificate generation',
            'Priority support'
        ],
        ctaText: 'Subscribe - KES 350',
        ctaColor: 'success',
        popular: false
    },
    quarterly: {
        id: 'quarterly',
        name: 'Quarterly Plan',
        price: 850,
        duration: 90 * 24 * 60 * 60 * 1000, // 90 days
        durationText: '3 months',
        features: [
            'Unlimited access',
            'All 8 subjects',
            'Detailed analytics',
            'Certificate generation',
            'Priority support',
            'Save KES 200'
        ],
        savings: 'Save KES 200',
        ctaText: 'Subscribe - KES 850',
        ctaColor: 'success',
        popular: true
    },
    yearly: {
        id: 'yearly',
        name: 'Yearly Plan',
        price: 2100,
        duration: 365 * 24 * 60 * 60 * 1000, // 365 days
        durationText: '1 year',
        features: [
            'Unlimited access',
            'All 8 subjects',
            'Detailed analytics',
            'Certificate generation',
            'Priority support',
            'Save KES 1,100'
        ],
        savings: 'Save KES 1,100',
        ctaText: 'Subscribe - KES 2,100',
        ctaColor: 'success'
    }
};

// ==================== SUBSCRIPTION STATUS ====================

/**
 * Get current subscription status from storage.
 * @returns {Promise<Object|null>} subscription object
 */
export async function getSubscriptionStatus() {
    return await db.getSubscription() || null;
}

/**
 * Check if the current user has an active subscription or trial.
 * @returns {Promise<boolean>}
 */
export async function hasActiveSubscription() {
    const sub = await getSubscriptionStatus();
    if (!sub) return false;
    if (!sub.isActive) return false;
    const now = Date.now();
    const expiry = new Date(sub.expiryDate).getTime();
    return expiry > now;
}

/**
 * Check if free trial is still active.
 * @returns {Promise<boolean>}
 */
export async function isTrialActive() {
    const sub = await getSubscriptionStatus();
    return sub && sub.plan === 'trial' && sub.isActive && new Date(sub.expiryDate).getTime() > Date.now();
}

/**
 * Check if user has a paid subscription (any paid plan).
 * @returns {Promise<boolean>}
 */
export async function isPaidSubscription() {
    const sub = await getSubscriptionStatus();
    return sub && sub.plan !== 'trial' && sub.isActive && new Date(sub.expiryDate).getTime() > Date.now();
}

// ==================== TRIAL MANAGEMENT ====================

/**
 * Check if user is eligible for free trial.
 * @returns {Promise<boolean>} true if eligible
 */
export async function checkTrialEligibility() {
    const user = app.getUser();
    if (!user) return false; // must be logged in

    const sub = await getSubscriptionStatus();
    // If no subscription at all, eligible
    if (!sub) return true;

    // If already had a trial (even expired), not eligible
    if (sub.plan === 'trial') return false;

    // If had a paid subscription, not eligible for trial
    return false;
}

/**
 * Start free trial for current user.
 * @param {Object} options - { deviceFingerprint, clientTime }
 * @returns {Promise<Object>} subscription object
 */
export async function startFreeTrial({ deviceFingerprint, clientTime }) {
    const user = app.getUser();
    if (!user) throw new Error('User not authenticated');

    // Double-check eligibility
    const eligible = await checkTrialEligibility();
    if (!eligible) throw new Error('Not eligible for free trial');

    const now = Date.now();
    const expiry = now + PLANS.trial.duration;

    const subscription = {
        userId: user.id,
        plan: 'trial',
        isActive: true,
        startDate: new Date(now).toISOString(),
        expiryDate: new Date(expiry).toISOString(),
        autoRenew: false,
        deviceFingerprint // store for anti-cheat
    };

    // Save to DB
    await db.saveSubscription(subscription);

    // Also update app state
    app.setSubscription(subscription);

    return { subscription };
}

/**
 * Get remaining time of trial (if active).
 * @returns {Promise<string|null>} human readable time remaining
 */
export async function getTrialRemaining() {
    const sub = await getSubscriptionStatus();
    if (!sub || sub.plan !== 'trial' || !sub.isActive) return null;
    const now = Date.now();
    const expiry = new Date(sub.expiryDate).getTime();
    const remainingMs = expiry - now;
    if (remainingMs <= 0) return null;
    return utils.formatTime(Math.floor(remainingMs / 1000));
}

/**
 * End trial manually (if expired or admin action).
 */
export async function endTrial() {
    const sub = await getSubscriptionStatus();
    if (sub && sub.plan === 'trial') {
        sub.isActive = false;
        await db.saveSubscription(sub);
        app.setSubscription(sub);
    }
}

// ==================== PLAN MANAGEMENT ====================

/**
 * Get all available subscription plans.
 * @returns {Promise<Array>} list of plan objects
 */
export async function getSubscriptionPlans() {
    // Return the plans defined above, possibly with dynamic pricing?
    // For offline, just return static plans.
    return Object.values(PLANS);
}

/**
 * Select a plan (store in app state for payment).
 * @param {string} planId
 */
export function selectPlan(planId) {
    app.setSelectedPlan(planId);
}

/**
 * Upgrade to a paid plan (simulated after payment).
 * @param {string} planId
 * @returns {Promise<Object>} new subscription
 */
export async function upgradePlan(planId) {
    const user = app.getUser();
    if (!user) throw new Error('User not authenticated');

    const plan = PLANS[planId];
    if (!plan) throw new Error('Invalid plan');

    const now = Date.now();
    const expiry = now + plan.duration;

    const subscription = {
        userId: user.id,
        plan: planId,
        isActive: true,
        startDate: new Date(now).toISOString(),
        expiryDate: new Date(expiry).toISOString(),
        autoRenew: false, // can be toggled later
        amount: plan.price,
        currency: 'KES'
    };

    await db.saveSubscription(subscription);
    app.setSubscription(subscription);
    return subscription;
}

/**
 * Cancel subscription (prevent auto-renew).
 */
export async function cancelSubscription() {
    const sub = await getSubscriptionStatus();
    if (sub) {
        sub.autoRenew = false;
        await db.saveSubscription(sub);
        app.setSubscription(sub);
    }
}

// ==================== ACCESS CONTROL ====================

/**
 * Check if user can take an exam (must have active subscription or trial).
 * @returns {Promise<boolean>}
 */
export async function canTakeExam() {
    return await hasActiveSubscription();
}

/**
 * Check if user can view analytics (trial or paid).
 * @returns {Promise<boolean>}
 */
export async function canViewAnalytics() {
    // For now, analytics are available to all logged-in users, even without subscription.
    // But we might restrict some detailed analytics to paid users.
    // Let's keep it simple: require authentication only.
    return !!app.getUser();
}

/**
 * Check if user can export results (paid only).
 * @returns {Promise<boolean>}
 */
export async function canExportResults() {
    return await isPaidSubscription();
}

// ==================== TIME CALCULATIONS ====================

/**
 * Calculate remaining time in seconds.
 * @returns {Promise<number>} seconds remaining, or 0 if expired
 */
export async function calculateRemainingTime() {
    const sub = await getSubscriptionStatus();
    if (!sub || !sub.isActive) return 0;
    const now = Date.now();
    const expiry = new Date(sub.expiryDate).getTime();
    return Math.max(0, Math.floor((expiry - now) / 1000));
}

/**
 * Format remaining time as human-readable string.
 * @returns {Promise<string>}
 */
export async function formatRemainingTime() {
    const seconds = await calculateRemainingTime();
    if (seconds <= 0) return 'Expired';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/**
 * Check if subscription is expiring soon (within given hours).
 * @param {number} hours - threshold in hours
 * @returns {Promise<boolean>}
 */
export async function isExpiringSoon(hours = 24) {
    const seconds = await calculateRemainingTime();
    return seconds > 0 && seconds < hours * 3600;
}

// ==================== EXPOSE GLOBALLY ====================

window.subscription = {
    getSubscriptionStatus,
    hasActiveSubscription,
    isTrialActive,
    isPaidSubscription,
    checkTrialEligibility,
    startFreeTrial,
    getTrialRemaining,
    endTrial,
    getSubscriptionPlans,
    selectPlan,
    upgradePlan,
    cancelSubscription,
    canTakeExam,
    canViewAnalytics,
    canExportResults,
    calculateRemainingTime,
    formatRemainingTime,
    isExpiringSoon
};
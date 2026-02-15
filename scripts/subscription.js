// scripts/subscription.js
// Subscription management: trial, plans, access control.
// Depends on app, db, utils.

(function() {
    'use strict';

    // ----- Helper functions -----
    function formatRemainingTime(expiryDate) {
        if (!expiryDate) return '—';
        const now = Date.now();
        const expiry = new Date(expiryDate).getTime();
        const diff = expiry - now;
        if (diff <= 0) return 'Expired';
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
        if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
        const minutes = Math.floor(diff / (1000 * 60));
        return `${minutes} min`;
    }

    // ----- Subscription plans -----
    const PLANS = [
        {
            id: 'trial',
            name: 'Free Trial',
            price: 0,
            duration: '3 hours',
            features: [
                'Full access to all subjects',
                'All exam modes',
                'Detailed analytics',
                'No payment required'
            ],
            limitations: [
                'Time-limited (3 hours)',
                'One trial per device',
                'No certificate generation'
            ],
            ctaText: 'Start Free Trial',
            ctaColor: 'primary'
        },
        {
            id: 'monthly',
            name: 'Monthly Plan',
            price: 350,
            duration: '30 days',
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
        {
            id: 'quarterly',
            name: 'Quarterly Plan',
            price: 850,
            duration: '3 months',
            features: [
                'Unlimited access',
                'All 8 subjects',
                'Detailed analytics',
                'Certificate generation',
                'Priority support'
            ],
            savings: 'Save KES 200',
            ctaText: 'Subscribe - KES 850',
            ctaColor: 'success',
            popular: true
        },
        {
            id: 'yearly',
            name: 'Yearly Plan',
            price: 2100,
            duration: '1 year',
            features: [
                'Unlimited access',
                'All 8 subjects',
                'Detailed analytics',
                'Certificate generation',
                'Priority support'
            ],
            savings: 'Save KES 1,100',
            ctaText: 'Subscribe - KES 2,100',
            ctaColor: 'success',
            popular: false
        }
    ];

    // ----- Get subscription status -----
    async function getSubscriptionStatus() {
        // Try to get from app first
        if (window.app?.getSubscription) {
            return window.app.getSubscription();
        }
        // Fallback to db
        if (window.db?.getSubscription) {
            return await window.db.getSubscription();
        }
        return null;
    }

    // ----- Check if user can take exam -----
    async function canTakeExam() {
        const sub = await getSubscriptionStatus();
        if (!sub) return false;
        if (!sub.isActive) return false;
        const now = Date.now();
        const expiry = new Date(sub.expiryDate).getTime();
        return expiry > now;
    }

    // ----- Check trial eligibility -----
    async function checkTrialEligibility() {
        const sub = await getSubscriptionStatus();
        if (sub && sub.plan === 'trial' && sub.isActive) return false;
        return true;
    }

    // ----- Start free trial -----
    async function startFreeTrial({ deviceFingerprint, clientTime }) {
        if (!window.db || !window.app) throw new Error('Required modules not loaded');
        
        const eligible = await checkTrialEligibility();
        if (!eligible) throw new Error('Trial already used');
        
        const expiryDate = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
        const subscription = {
            userId: 'current',
            plan: 'trial',
            isActive: true,
            startDate: new Date().toISOString(),
            expiryDate: expiryDate,
            autoRenew: false
        };
        
        await window.db.saveSubscription(subscription);
        if (window.app) window.app.setSubscription(subscription);
        
        return { subscription };
    }

    // ----- Get all subscription plans -----
    function getSubscriptionPlans() {
        return PLANS;
    }

    // ----- Select plan (store in app state) -----
    function selectPlan(planId) {
        if (window.app) {
            window.app.setSelectedPlan(planId);
        }
    }

    // ----- Calculate remaining time -----
    function calculateRemainingTime(expiryDate) {
        return formatRemainingTime(expiryDate);
    }

    // ----- Check if subscription is expiring soon -----
    function isExpiringSoon(hours = 24) {
        const sub = window.app?.getSubscription();
        if (!sub || !sub.expiryDate) return false;
        const now = Date.now();
        const expiry = new Date(sub.expiryDate).getTime();
        const diff = expiry - now;
        return diff > 0 && diff < hours * 60 * 60 * 1000;
    }

    // ----- Upgrade/cancel (placeholders) -----
    async function upgradePlan(newPlan) {
        const sub = await getSubscriptionStatus();
        if (!sub) throw new Error('No active subscription');
        sub.plan = newPlan;
        sub.expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        await window.db.saveSubscription(sub);
        if (window.app) window.app.setSubscription(sub);
        return sub;
    }

    async function cancelSubscription() {
        const sub = await getSubscriptionStatus();
        if (!sub) throw new Error('No active subscription');
        sub.autoRenew = false;
        await window.db.saveSubscription(sub);
        if (window.app) window.app.setSubscription(sub);
        return sub;
    }

    // ----- Expose public API -----
    window.subscription = {
        getSubscriptionStatus,
        canTakeExam,
        checkTrialEligibility,
        startFreeTrial,
        getSubscriptionPlans,
        selectPlan,
        calculateRemainingTime,
        formatRemainingTime,
        isExpiringSoon,
        upgradePlan,
        cancelSubscription
    };

})();
// scripts/subscription.js

/**
 * Medical Exam Room Pro - Subscription Management
 * 
 * Handles subscription validation, trial management, and access control.
 * For now, simulates an active subscription since backend is not implemented.
 */

const SubscriptionManager = {
    // Default subscription state for development
    defaultSubscription: {
        plan: 'yearly',
        price: 2100,
        duration: 365, // days
        isActive: true,
        isTrial: false,
        expiryDate: new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)).toISOString(), // 1 year from now
        activatedAt: new Date().toISOString(),
        paymentId: 'dev_payment_001',
        mpesaReceipt: 'DEV_RCPT_001',
        autoRenew: true
    },
    
    // Trial configuration
    trialConfig: {
        duration: 3 * 60 * 60 * 1000, // 3 hours in milliseconds
        enabled: true,
        onePerDevice: true
    },
    
    /**
     * Initialize subscription manager
     */
    init() {
        console.log('Subscription Manager initialized');
        
        // Load or create default subscription for development
        this.ensureDefaultSubscription();
        
        // Check trial eligibility
        this.checkTrialEligibility();
        
        // Start subscription monitoring
        this.startMonitoring();
        
        // Update UI with subscription status
        this.updateSubscriptionUI();
        
        return this.getSubscriptionStatus();
    },
    
    /**
     * Ensure default subscription exists for development
     */
    ensureDefaultSubscription() {
        let subscription = localStorage.getItem('subscription');
        
        if (!subscription) {
            console.log('Creating default subscription for development');
            localStorage.setItem('subscription', JSON.stringify(this.defaultSubscription));
            
            // Also mark device as having used trial to avoid confusion
            const deviceId = this.getDeviceId();
            localStorage.setItem(`trialUsed_${deviceId}`, 'true');
            
            // Set trial as used but not active
            localStorage.removeItem('trialStartTime');
            localStorage.removeItem('trialEndTime');
        } else {
            // Make sure existing subscription is active
            try {
                const subData = JSON.parse(subscription);
                if (!subData.isActive || new Date(subData.expiryDate) <= new Date()) {
                    console.log('Fixing expired subscription for development');
                    subData.isActive = true;
                    subData.expiryDate = new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)).toISOString();
                    localStorage.setItem('subscription', JSON.stringify(subData));
                }
            } catch (error) {
                console.error('Error parsing subscription data:', error);
                localStorage.setItem('subscription', JSON.stringify(this.defaultSubscription));
            }
        }
    },
    
    /**
     * Get current subscription status
     */
    getSubscriptionStatus() {
        try {
            const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
            const now = new Date();
            const expiryDate = new Date(subscription.expiryDate || 0);
            
            return {
                hasSubscription: !!subscription.plan,
                isActive: subscription.isActive === true && expiryDate > now,
                plan: subscription.plan || 'none',
                isTrial: subscription.isTrial === true,
                expiryDate: subscription.expiryDate,
                timeRemaining: Math.max(0, expiryDate - now),
                daysRemaining: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)),
                hoursRemaining: Math.ceil((expiryDate - now) / (1000 * 60 * 60)),
                activatedAt: subscription.activatedAt,
                paymentId: subscription.paymentId,
                mpesaReceipt: subscription.mpesaReceipt
            };
        } catch (error) {
            console.error('Error getting subscription status:', error);
            return {
                hasSubscription: false,
                isActive: false,
                plan: 'none',
                isTrial: false,
                expiryDate: null,
                timeRemaining: 0,
                daysRemaining: 0,
                hoursRemaining: 0
            };
        }
    },
    
    /**
     * Check if user has access to a feature
     */
    hasAccess(feature = 'all') {
        const status = this.getSubscriptionStatus();
        
        if (!status.isActive) {
            return false;
        }
        
        // Feature-based access control
        switch(feature) {
            case 'exam':
                return status.isActive;
                
            case 'analytics':
                return status.isActive && !status.isTrial;
                
            case 'certificates':
                return status.isActive && !status.isTrial;
                
            case 'export':
                return status.isActive && !status.isTrial;
                
            case 'priority_support':
                return status.isActive && status.plan === 'yearly';
                
            case 'all':
            default:
                return status.isActive;
        }
    },
    
    /**
     * Check trial eligibility
     */
    checkTrialEligibility() {
        const deviceId = this.getDeviceId();
        const trialUsed = localStorage.getItem(`trialUsed_${deviceId}`) === 'true';
        const hasActiveSubscription = this.getSubscriptionStatus().isActive;
        
        return {
            eligible: this.trialConfig.enabled && !trialUsed && !hasActiveSubscription,
            trialUsed: trialUsed,
            deviceId: deviceId,
            hasActiveSubscription: hasActiveSubscription
        };
    },
    
    /**
     * Start free trial
     */
    startFreeTrial() {
        const eligibility = this.checkTrialEligibility();
        
        if (!eligibility.eligible) {
            return {
                success: false,
                message: eligibility.trialUsed ? 
                    'Free trial already used on this device' : 
                    eligibility.hasActiveSubscription ? 
                    'You already have an active subscription' :
                    'Free trial not available'
            };
        }
        
        const trialStartTime = Date.now();
        const trialEndTime = trialStartTime + this.trialConfig.duration;
        
        // Create trial subscription
        const trialSubscription = {
            plan: 'trial',
            price: 0,
            duration: this.trialConfig.duration,
            isActive: true,
            isTrial: true,
            expiryDate: new Date(trialEndTime).toISOString(),
            activatedAt: new Date(trialStartTime).toISOString(),
            trialStarted: true
        };
        
        // Save trial data
        localStorage.setItem('subscription', JSON.stringify(trialSubscription));
        localStorage.setItem('trialStartTime', trialStartTime.toString());
        localStorage.setItem('trialEndTime', trialEndTime.toString());
        localStorage.setItem(`trialUsed_${eligibility.deviceId}`, 'true');
        
        console.log('Free trial started:', trialSubscription);
        
        // Start trial countdown
        this.startTrialCountdown(trialEndTime);
        
        // Update UI
        this.updateSubscriptionUI();
        
        return {
            success: true,
            message: 'Free trial activated successfully!',
            data: trialSubscription,
            timeRemaining: this.trialConfig.duration
        };
    },
    
    /**
     * Start trial countdown
     */
    startTrialCountdown(trialEndTime) {
        // Update countdown every second
        const countdownInterval = setInterval(() => {
            const now = Date.now();
            const remaining = trialEndTime - now;
            
            if (remaining <= 0) {
                // Trial expired
                clearInterval(countdownInterval);
                this.handleTrialExpiry();
                return;
            }
            
            // Update trial progress in localStorage for other pages to read
            const progress = {
                remaining: remaining,
                hours: Math.floor(remaining / (1000 * 60 * 60)),
                minutes: Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60)),
                seconds: Math.floor((remaining % (1000 * 60)) / 1000),
                percentage: (remaining / this.trialConfig.duration) * 100
            };
            
            localStorage.setItem('trialProgress', JSON.stringify(progress));
            
            // Dispatch event for UI updates
            this.dispatchTrialUpdate(progress);
            
        }, 1000);
    },
    
    /**
     * Handle trial expiry
     */
    handleTrialExpiry() {
        const subscription = this.getSubscriptionStatus();
        
        if (subscription.isTrial && subscription.isActive) {
            // Update subscription to expired
            const subData = JSON.parse(localStorage.getItem('subscription') || '{}');
            subData.isActive = false;
            localStorage.setItem('subscription', JSON.stringify(subData));
            
            // Clear trial progress
            localStorage.removeItem('trialProgress');
            localStorage.removeItem('trialStartTime');
            localStorage.removeItem('trialEndTime');
            
            console.log('Free trial expired');
            
            // Dispatch expiry event
            this.dispatchTrialExpired();
            
            // Update UI
            this.updateSubscriptionUI();
        }
    },
    
    /**
     * Subscribe to a plan (simulated for now)
     */
    subscribeToPlan(plan = 'monthly') {
        const plans = {
            monthly: { price: 350, duration: 30, name: 'Monthly Plan' },
            quarterly: { price: 850, duration: 90, name: 'Quarterly Plan' },
            yearly: { price: 2100, duration: 365, name: 'Yearly Plan' }
        };
        
        const selectedPlan = plans[plan] || plans.monthly;
        const now = new Date();
        const expiryDate = new Date(now);
        expiryDate.setDate(expiryDate.getDate() + selectedPlan.duration);
        
        // Create subscription
        const subscription = {
            plan: plan,
            price: selectedPlan.price,
            duration: selectedPlan.duration,
            isActive: true,
            isTrial: false,
            expiryDate: expiryDate.toISOString(),
            activatedAt: now.toISOString(),
            paymentId: `dev_payment_${Date.now()}`,
            mpesaReceipt: `DEV_RCPT_${Date.now()}`,
            autoRenew: true
        };
        
        // Save subscription
        localStorage.setItem('subscription', JSON.stringify(subscription));
        
        // Clear any trial data
        localStorage.removeItem('trialProgress');
        localStorage.removeItem('trialStartTime');
        localStorage.removeItem('trialEndTime');
        
        console.log(`Subscribed to ${plan} plan:`, subscription);
        
        // Update UI
        this.updateSubscriptionUI();
        
        return {
            success: true,
            message: `Successfully subscribed to ${selectedPlan.name}`,
            data: subscription
        };
    },
    
    /**
     * Simulate M-Pesa payment
     */
    simulateMpesaPayment(plan = 'monthly', phoneNumber = '254700000000') {
        console.log(`Simulating M-Pesa payment for ${plan} plan...`);
        
        // Simulate payment processing delay
        return new Promise((resolve) => {
            setTimeout(() => {
                const result = this.subscribeToPlan(plan);
                result.paymentSimulated = true;
                result.phoneNumber = phoneNumber;
                result.transactionId = `MPESA_${Date.now()}`;
                
                resolve(result);
            }, 2000);
        });
    },
    
    /**
     * Extend subscription (admin function)
     */
    extendSubscription(days = 30, reason = 'Manual extension') {
        const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
        
        if (!subscription.plan) {
            return { success: false, message: 'No subscription found' };
        }
        
        // Calculate new expiry date
        const currentExpiry = new Date(subscription.expiryDate || new Date());
        const newExpiry = new Date(currentExpiry);
        newExpiry.setDate(newExpiry.getDate() + days);
        
        // Update subscription
        subscription.expiryDate = newExpiry.toISOString();
        subscription.isActive = true;
        
        // Add extension log
        subscription.extensions = subscription.extensions || [];
        subscription.extensions.push({
            date: new Date().toISOString(),
            days: days,
            reason: reason
        });
        
        localStorage.setItem('subscription', JSON.stringify(subscription));
        
        console.log(`Subscription extended by ${days} days:`, subscription);
        
        // Update UI
        this.updateSubscriptionUI();
        
        return {
            success: true,
            message: `Subscription extended by ${days} days`,
            data: subscription,
            newExpiry: newExpiry.toISOString()
        };
    },
    
    /**
     * Cancel subscription
     */
    cancelSubscription() {
        const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
        
        if (!subscription.plan) {
            return { success: false, message: 'No subscription found' };
        }
        
        // Disable auto-renewal
        subscription.autoRenew = false;
        subscription.cancelledAt = new Date().toISOString();
        
        localStorage.setItem('subscription', JSON.stringify(subscription));
        
        console.log('Subscription auto-renewal cancelled:', subscription);
        
        return {
            success: true,
            message: 'Auto-renewal cancelled. Your subscription will remain active until expiry.',
            data: subscription
        };
    },
    
    /**
     * Get subscription plans
     */
    getSubscriptionPlans() {
        return {
            plans: [
                {
                    id: 'trial',
                    name: 'Free Trial',
                    price: 0,
                    duration: '3 hours',
                    durationDays: 0.125, // 3 hours in days
                    features: [
                        'All 8 subjects',
                        '5,000+ questions',
                        '100% offline',
                        'Basic analytics',
                        'Weak area identification'
                    ],
                    limitations: [
                        'No certificates',
                        'Limited reports',
                        'One per device'
                    ]
                },
                {
                    id: 'monthly',
                    name: 'Monthly Plan',
                    price: 350,
                    duration: '1 month',
                    durationDays: 30,
                    features: [
                        'All 8 subjects',
                        '5,000+ questions',
                        '100% offline',
                        'Detailed analytics',
                        'Progress reports',
                        'Certificates',
                        'Weak area identification'
                    ],
                    bestFor: 'Short-term preparation'
                },
                {
                    id: 'quarterly',
                    name: 'Quarterly Plan',
                    price: 850,
                    duration: '3 months',
                    durationDays: 90,
                    features: [
                        'All 8 subjects',
                        '5,000+ questions',
                        '100% offline',
                        'Detailed analytics',
                        'Progress reports',
                        'Certificates',
                        'Weak area identification',
                        'Save KES 200'
                    ],
                    bestFor: 'Semester preparation',
                    savings: 200,
                    valuePerMonth: 283
                },
                {
                    id: 'yearly',
                    name: 'Yearly Plan',
                    price: 2100,
                    duration: '1 year',
                    durationDays: 365,
                    features: [
                        'All 8 subjects',
                        '5,000+ questions',
                        '100% offline',
                        'Premium analytics',
                        'Advanced reports',
                        'Certificates',
                        'Weak area identification',
                        'Priority support',
                        'Save KES 1,100'
                    ],
                    bestFor: 'Long-term preparation',
                    savings: 1100,
                    valuePerMonth: 175
                }
            ],
            currency: 'KES',
            paymentMethods: ['mpesa'],
            defaultPlan: 'yearly'
        };
    },
    
    /**
     * Get device ID
     */
    getDeviceId() {
        let deviceId = localStorage.getItem('deviceId');
        
        if (!deviceId) {
            // Generate a device fingerprint
            const components = [
                navigator.userAgent,
                navigator.language,
                navigator.platform,
                screen.width + 'x' + screen.height,
                new Date().getTimezoneOffset()
            ].join('|');
            
            // Simple hash
            let hash = 0;
            for (let i = 0; i < components.length; i++) {
                const char = components.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            
            deviceId = 'device_' + Math.abs(hash).toString(16);
            localStorage.setItem('deviceId', deviceId);
        }
        
        return deviceId;
    },
    
    /**
     * Update subscription UI on current page
     */
    updateSubscriptionUI() {
        const status = this.getSubscriptionStatus();
        const statusElement = document.getElementById('subscriptionStatus');
        
        if (statusElement) {
            let statusHTML = '';
            let statusClass = '';
            
            if (status.isActive) {
                if (status.isTrial) {
                    const hours = Math.floor(status.timeRemaining / (1000 * 60 * 60));
                    const minutes = Math.floor((status.timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
                    
                    statusHTML = `
                        <span class="status-icon">⏳</span>
                        <span class="status-text">
                            Free Trial: ${hours}h ${minutes}m remaining
                        </span>
                    `;
                    statusClass = 'trial';
                } else {
                    const days = Math.ceil(status.timeRemaining / (1000 * 60 * 60 * 24));
                    
                    statusHTML = `
                        <span class="status-icon">✅</span>
                        <span class="status-text">
                            ${status.plan.charAt(0).toUpperCase() + status.plan.slice(1)} Plan (${days} days left)
                        </span>
                    `;
                    statusClass = 'active';
                }
            } else {
                statusHTML = `
                    <span class="status-icon">⚠️</span>
                    <span class="status-text">
                        No Active Subscription
                    </span>
                `;
                statusClass = 'expired';
            }
            
            statusElement.innerHTML = statusHTML;
            statusElement.className = `subscription-status ${statusClass}`;
        }
        
        // Update any subscription buttons
        document.querySelectorAll('.subscription-action').forEach(button => {
            if (status.isActive) {
                if (status.isTrial) {
                    button.textContent = 'Upgrade Now';
                    button.onclick = () => window.location.href = 'subscription.html';
                } else {
                    button.textContent = 'Manage Subscription';
                    button.onclick = () => this.showSubscriptionDetails();
                }
            } else {
                button.textContent = 'Subscribe Now';
                button.onclick = () => window.location.href = 'subscription.html';
            }
        });
        
        // Dispatch subscription update event
        document.dispatchEvent(new CustomEvent('subscriptionUpdate', {
            detail: status
        }));
    },
    
    /**
     * Show subscription details
     */
    showSubscriptionDetails() {
        const status = this.getSubscriptionStatus();
        
        const details = `
            <div class="subscription-details">
                <h3>Subscription Details</h3>
                <div class="details-grid">
                    <div class="detail-item">
                        <span class="detail-label">Plan:</span>
                        <span class="detail-value">${status.plan.charAt(0).toUpperCase() + status.plan.slice(1)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value ${status.isActive ? 'active' : 'inactive'}">
                            ${status.isActive ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Type:</span>
                        <span class="detail-value">${status.isTrial ? 'Free Trial' : 'Paid Subscription'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Expiry Date:</span>
                        <span class="detail-value">${new Date(status.expiryDate).toLocaleDateString()}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Time Remaining:</span>
                        <span class="detail-value">${this.formatTimeRemaining(status.timeRemaining)}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Activated:</span>
                        <span class="detail-value">${new Date(status.activatedAt).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="details-actions">
                    <button class="btn-primary" onclick="SubscriptionManager.extendSubscription(30, 'User extension')">
                        Extend 30 Days
                    </button>
                    <button class="btn-secondary" onclick="window.location.href='subscription.html'">
                        Change Plan
                    </button>
                    ${!status.isTrial ? `
                    <button class="btn-warning" onclick="SubscriptionManager.cancelSubscription()">
                        Cancel Auto-renew
                    </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        // Create modal or update existing element
        const modal = document.createElement('div');
        modal.className = 'modal subscription-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Subscription Information</h2>
                    <button class="modal-close" onclick="this.parentElement.parentElement.remove()">×</button>
                </div>
                <div class="modal-body">
                    ${details}
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    },
    
    /**
     * Format time remaining
     */
    formatTimeRemaining(milliseconds) {
        if (milliseconds <= 0) return 'Expired';
        
        const days = Math.floor(milliseconds / (1000 * 60 * 60 * 24));
        const hours = Math.floor((milliseconds % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) {
            return `${days} day${days !== 1 ? 's' : ''} ${hours} hour${hours !== 1 ? 's' : ''}`;
        } else if (hours > 0) {
            return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else {
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        }
    },
    
    /**
     * Start subscription monitoring
     */
    startMonitoring() {
        // Check subscription status every minute
        setInterval(() => {
            this.checkSubscriptionValidity();
            this.updateSubscriptionUI();
        }, 60000); // 1 minute
        
        // Also check on page visibility change
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkSubscriptionValidity();
                this.updateSubscriptionUI();
            }
        });
    },
    
    /**
     * Check subscription validity
     */
    checkSubscriptionValidity() {
        const status = this.getSubscriptionStatus();
        
        if (status.isActive && status.timeRemaining <= 0) {
            // Subscription expired
            const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
            subscription.isActive = false;
            localStorage.setItem('subscription', JSON.stringify(subscription));
            
            console.log('Subscription expired');
            this.dispatchSubscriptionExpired();
        }
        
        return status.isActive;
    },
    
    /**
     * Dispatch trial update event
     */
    dispatchTrialUpdate(progress) {
        document.dispatchEvent(new CustomEvent('trialUpdate', {
            detail: progress
        }));
    },
    
    /**
     * Dispatch trial expired event
     */
    dispatchTrialExpired() {
        document.dispatchEvent(new CustomEvent('trialExpired'));
    },
    
    /**
     * Dispatch subscription expired event
     */
    dispatchSubscriptionExpired() {
        document.dispatchEvent(new CustomEvent('subscriptionExpired'));
    },
    
    /**
     * Get access restrictions for trial users
     */
    getTrialRestrictions() {
        return {
            canTakeExams: true,
            canReviewQuestions: true,
            canViewAnalytics: true,
            canExportResults: false,
            canGenerateCertificates: false,
            canSaveNotes: true,
            canCreatePresets: false,
            maxQuestionsPerExam: 50,
            maxExamsPerDay: 10,
            watermarkOnResults: true,
            adsShown: false
        };
    },
    
    /**
     * Get access for paid users
     */
    getPaidAccess() {
        return {
            canTakeExams: true,
            canReviewQuestions: true,
            canViewAnalytics: true,
            canExportResults: true,
            canGenerateCertificates: true,
            canSaveNotes: true,
            canCreatePresets: true,
            maxQuestionsPerExam: 1000,
            maxExamsPerDay: 100,
            watermarkOnResults: false,
            adsShown: false,
            prioritySupport: true,
            offlineAccess: true
        };
    },
    
    /**
     * Check if user can access a specific feature
     */
    canAccessFeature(feature) {
        const status = this.getSubscriptionStatus();
        const isTrial = status.isTrial;
        
        const restrictions = isTrial ? this.getTrialRestrictions() : this.getPaidAccess();
        
        return restrictions[feature] !== undefined ? restrictions[feature] : true;
    },
    
    /**
     * Reset subscription for testing
     */
    resetForTesting() {
        localStorage.removeItem('subscription');
        localStorage.removeItem('trialStartTime');
        localStorage.removeItem('trialEndTime');
        localStorage.removeItem('trialProgress');
        
        const deviceId = this.getDeviceId();
        localStorage.removeItem(`trialUsed_${deviceId}`);
        
        console.log('Subscription data reset for testing');
        
        // Reinitialize with default
        this.ensureDefaultSubscription();
        this.updateSubscriptionUI();
        
        return { success: true, message: 'Subscription reset complete' };
    },
    
    /**
     * Export subscription data
     */
    exportSubscriptionData() {
        const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
        const trialProgress = JSON.parse(localStorage.getItem('trialProgress') || '{}');
        
        return {
            subscription: subscription,
            trialProgress: trialProgress,
            deviceId: this.getDeviceId(),
            exportDate: new Date().toISOString(),
            appVersion: '1.0.0'
        };
    }
};

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => SubscriptionManager.init());
} else {
    SubscriptionManager.init();
}

// Export for use in other scripts
window.SubscriptionManager = SubscriptionManager;

// Also create a simpler alias
window.MedicalExamSubscription = SubscriptionManager;

/**
 * Helper function to check subscription status from any script
 */
function checkSubscription() {
    return SubscriptionManager.getSubscriptionStatus();
}

/**
 * Helper function to check if user has access
 */
function hasSubscriptionAccess(feature = 'all') {
    return SubscriptionManager.hasAccess(feature);
}
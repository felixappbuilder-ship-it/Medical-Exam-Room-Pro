// ============================================
// security.js - Security & Anti-Cheating System
// ============================================
// Main Focus: Prevent revenue loss without aggressive locking
// Philosophy: User-friendly, tolerant of natural human errors
// Time tolerance: 5 minutes (300,000 ms)
// ============================================

// Security states
const SecurityState = {
    NORMAL: 'normal',
    WARNING: 'warning',
    TIME_CORRECTION_NEEDED: 'time_correction_needed',
    SUSPICIOUS: 'suspicious',
    LOCKED: 'locked'
};

// Security configuration
const SecurityConfig = {
    // Time manipulation detection
    TIME_TOLERANCE: 300000, // 5 minutes in milliseconds
    MAX_TIME_DISCREPANCY: 3600000, // 1 hour for extreme cases
    TIME_CHECK_INTERVAL: 60000, // Check every minute
    
    // Suspicious behavior
    MAX_SUSPICIOUS_EVENTS: 5,
    SUSPICIOUS_WINDOW: 3600000, // 1 hour window
    
    // Notifications
    NOTIFICATION_DURATION: 5000, // 5 seconds max
    MIN_NOTIFICATION_INTERVAL: 300000, // 5 minutes between same notifications
    
    // Device fingerprint
    FINGERPRINT_KEY: 'medexam_device_fingerprint',
    FINGERPRINT_VERSION: '1.0',
    
    // Storage keys
    LAST_SECURITY_CHECK: 'last_security_check',
    SECURITY_EVENTS: 'security_events',
    TIME_HISTORY: 'time_history',
    SUBSCRIPTION_CHECKS: 'subscription_checks'
};

// Security event types
const SecurityEventType = {
    TIME_MISMATCH: 'time_mismatch',
    TIME_ROLLBACK: 'time_rollback',
    MULTIPLE_DEVICES: 'multiple_devices',
    SUBSCRIPTION_TAMPER: 'subscription_tamper',
    OFFLINE_LONG_PERIOD: 'offline_long_period',
    EXAM_TAMPER: 'exam_tamper',
    PAYMENT_BYPASS_ATTEMPT: 'payment_bypass_attempt'
};

class SecuritySystem {
    constructor() {
        this.currentState = SecurityState.NORMAL;
        this.deviceFingerprint = null;
        this.lastNotificationTime = {};
        this.isMonitoring = false;
        this.timeCheckInterval = null;
        this.syncInProgress = false;
        this.initialize();
    }

    // ============================================
    // INITIALIZATION
    // ============================================

    async initialize() {
        console.log('[Security] Initializing security system...');
        
        try {
            // Generate or retrieve device fingerprint
            await this.generateDeviceFingerprint();
            
            // Initialize security storage
            await this.initSecurityStorage();
            
            // Start monitoring (subtly, without being intrusive)
            this.startMonitoring();
            
            // Check initial state
            await this.performSecurityCheck();
            
            console.log('[Security] Security system initialized successfully');
        } catch (error) {
            console.error('[Security] Initialization error:', error);
        }
    }

    async generateDeviceFingerprint() {
        try {
            // Check if fingerprint already exists
            const storedFingerprint = localStorage.getItem(SecurityConfig.FINGERPRINT_KEY);
            
            if (storedFingerprint) {
                this.deviceFingerprint = storedFingerprint;
                console.log('[Security] Using existing device fingerprint');
                return this.deviceFingerprint;
            }

            // Generate new fingerprint
            const components = [
                navigator.userAgent,
                navigator.language,
                navigator.platform,
                screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
                new Date().getTimezoneOffset().toString(),
                navigator.hardwareConcurrency?.toString() || 'unknown',
                navigator.deviceMemory?.toString() || 'unknown',
                'v' + SecurityConfig.FINGERPRINT_VERSION
            ];

            // Create a stable hash
            const fingerprintString = components.join('|');
            const hash = await this.hashString(fingerprintString);
            
            this.deviceFingerprint = hash.substring(0, 32); // 32 chars for readability
            localStorage.setItem(SecurityConfig.FINGERPRINT_KEY, this.deviceFingerprint);
            
            console.log('[Security] Generated new device fingerprint:', this.deviceFingerprint);
            return this.deviceFingerprint;
        } catch (error) {
            console.error('[Security] Error generating fingerprint:', error);
            // Fallback to simpler fingerprint
            this.deviceFingerprint = 'fallback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem(SecurityConfig.FINGERPRINT_KEY, this.deviceFingerprint);
            return this.deviceFingerprint;
        }
    }

    async hashString(str) {
        // Simple hash function for fingerprint
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    async initSecurityStorage() {
        // Initialize security events array if not exists
        if (!localStorage.getItem(SecurityConfig.SECURITY_EVENTS)) {
            localStorage.setItem(SecurityConfig.SECURITY_EVENTS, JSON.stringify([]));
        }
        
        // Initialize time history
        if (!localStorage.getItem(SecurityConfig.TIME_HISTORY)) {
            localStorage.setItem(SecurityConfig.TIME_HISTORY, JSON.stringify([]));
        }
        
        // Initialize subscription checks
        if (!localStorage.getItem(SecurityConfig.SUBSCRIPTION_CHECKS)) {
            localStorage.setItem(SecurityConfig.SUBSCRIPTION_CHECKS, JSON.stringify([]));
        }
    }

    // ============================================
    // MONITORING SYSTEM
    // ============================================

    startMonitoring() {
        if (this.isMonitoring) return;
        
        console.log('[Security] Starting security monitoring');
        this.isMonitoring = true;
        
        // Periodic time checks (every minute)
        this.timeCheckInterval = setInterval(() => {
            this.checkTimeIntegrity();
        }, SecurityConfig.TIME_CHECK_INTERVAL);
        
        // Listen for online/offline events
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Listen for visibility changes (tab switches)
        document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
        
        // Monitor storage changes (for subscription tampering attempts)
        window.addEventListener('storage', (e) => this.handleStorageChange(e));
    }

    stopMonitoring() {
        if (this.timeCheckInterval) {
            clearInterval(this.timeCheckInterval);
            this.timeCheckInterval = null;
        }
        this.isMonitoring = false;
        console.log('[Security] Security monitoring stopped');
    }

    // ============================================
    // TIME INTEGRITY CHECKS (Main Anti-Cheating)
    // ============================================

    async checkTimeIntegrity() {
        try {
            // Don't check if we're already in time correction mode
            if (this.currentState === SecurityState.TIME_CORRECTION_NEEDED) {
                return;
            }
            
            const clientTime = Date.now();
            let serverTime = null;
            
            // Try to get server time if online
            if (navigator.onLine) {
                serverTime = await this.getServerTime();
            }
            
            if (serverTime) {
                // We have server time, compare
                const timeDiff = Math.abs(serverTime - clientTime);
                
                if (timeDiff > SecurityConfig.TIME_TOLERANCE) {
                    // Time discrepancy detected
                    await this.handleTimeDiscrepancy(clientTime, serverTime, timeDiff);
                } else {
                    // Time is within tolerance, record good time
                    await this.recordGoodTime(clientTime, serverTime);
                }
            } else {
                // Offline mode - check against last known good time
                await this.checkOfflineTimeIntegrity(clientTime);
            }
        } catch (error) {
            console.warn('[Security] Time check error:', error);
        }
    }

    async getServerTime() {
        try {
            // Try multiple methods to get accurate time
            const responses = await Promise.race([
                fetch('https://worldtimeapi.org/api/timezone/Africa/Nairobi', { 
                    method: 'HEAD',
                    cache: 'no-cache'
                }),
                fetch('https://api.timezonedb.com/v2.1/get-time-zone?key=demo&format=json&by=zone&zone=Africa/Nairobi', {
                    method: 'HEAD',
                    cache: 'no-cache'
                }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
            ]);
            
            // Get time from response headers
            const dateHeader = responses.headers.get('date');
            if (dateHeader) {
                return new Date(dateHeader).getTime();
            }
            
            // Fallback to current time with network latency adjustment
            const startTime = Date.now();
            await fetch('/api/time-check', { method: 'HEAD', cache: 'no-cache' });
            const endTime = Date.now();
            const latency = (endTime - startTime) / 2;
            
            return endTime - latency;
            
        } catch (error) {
            console.warn('[Security] Could not get server time:', error);
            return null;
        }
    }

    async handleTimeDiscrepancy(clientTime, serverTime, timeDiff) {
        console.warn(`[Security] Time discrepancy detected: ${timeDiff}ms`);
        
        // Record the event
        await this.logSecurityEvent(SecurityEventType.TIME_MISMATCH, {
            clientTime,
            serverTime,
            timeDiff,
            tolerance: SecurityConfig.TIME_TOLERANCE
        });
        
        // Check if this is extreme (more than 1 hour)
        if (timeDiff > SecurityConfig.MAX_TIME_DISCREPANCY) {
            // Extreme time manipulation suspected
            await this.handleExtremeTimeManipulation(clientTime, serverTime, timeDiff);
            return;
        }
        
        // Check time history for patterns
        const timeHistory = JSON.parse(localStorage.getItem(SecurityConfig.TIME_HISTORY) || '[]');
        const recentMismatches = timeHistory.filter(event => 
            event.type === SecurityEventType.TIME_MISMATCH && 
            Date.now() - event.timestamp < 3600000 // Last hour
        );
        
        if (recentMismatches.length >= 3) {
            // Pattern detected - multiple time mismatches in short period
            await this.handleTimeManipulationPattern(recentMismatches);
        } else {
            // Single or infrequent mismatch - gentle correction
            await this.gentlyCorrectTime(clientTime, serverTime, timeDiff);
        }
    }

    async gentlyCorrectTime(clientTime, serverTime, timeDiff) {
        // Don't show notification for first minor discrepancy
        if (timeDiff < 600000) { // Less than 10 minutes
            console.log('[Security] Minor time discrepancy, adjusting silently');
            
            // Store the correction for future reference
            const corrections = JSON.parse(localStorage.getItem('time_corrections') || '[]');
            corrections.push({
                clientTime,
                serverTime,
                correctedAt: Date.now(),
                difference: timeDiff
            });
            localStorage.setItem('time_corrections', JSON.stringify(corrections.slice(-10))); // Keep last 10
            
            return;
        }
        
        // Show gentle notification (like WhatsApp)
        if (this.canShowNotification('time_correction')) {
            this.showTemporaryNotification({
                type: 'warning',
                title: 'Time Sync Needed',
                message: 'Your device time appears to be incorrect. Please sync your device time for optimal experience.',
                duration: SecurityConfig.NOTIFICATION_DURATION,
                actions: [
                    {
                        text: 'Sync Now',
                        action: () => this.syncDeviceTime()
                    },
                    {
                        text: 'Ignore',
                        action: () => {
                            this.lastNotificationTime['time_correction'] = Date.now();
                        }
                    }
                ]
            });
            
            this.lastNotificationTime['time_correction'] = Date.now();
        }
        
        // Set state to time correction needed
        this.currentState = SecurityState.TIME_CORRECTION_NEEDED;
        
        // Store this state
        localStorage.setItem('security_state', SecurityState.TIME_CORRECTION_NEEDED);
        
        // Prevent navigation beyond index.html if time is way off
        if (timeDiff > 1800000) { // More than 30 minutes
            this.restrictNavigation();
        }
    }

    restrictNavigation() {
        // Only allow access to index.html and time correction pages
        const currentPage = window.location.pathname.split('/').pop();
        const allowedPages = ['index.html', 'welcome.html', 'login.html', 'signup.html'];
        
        if (!allowedPages.includes(currentPage)) {
            console.log('[Security] Redirecting to index due to time issue');
            window.location.href = 'index.html';
            
            // Show notification on index page
            if (currentPage === 'index.html') {
                setTimeout(() => {
                    this.showTemporaryNotification({
                        type: 'info',
                        title: 'Time Adjustment Required',
                        message: 'Please correct your device time to continue using the app.',
                        duration: 8000
                    });
                }, 1000);
            }
        }
    }

    async handleExtremeTimeManipulation(clientTime, serverTime, timeDiff) {
        console.error('[Security] Extreme time manipulation detected:', timeDiff);
        
        // Log extreme event
        await this.logSecurityEvent('extreme_time_manipulation', {
            clientTime,
            serverTime,
            timeDiff,
            action: 'severe_warning'
        });
        
        // Show stronger warning
        if (this.canShowNotification('extreme_time_warning')) {
            this.showTemporaryNotification({
                type: 'error',
                title: 'Time Issue Detected',
                message: 'Your device time is significantly incorrect. Please correct it to avoid account restrictions.',
                duration: 8000,
                persistent: true
            });
            
            this.lastNotificationTime['extreme_time_warning'] = Date.now();
        }
        
        // Restrict all navigation except essential pages
        this.currentState = SecurityState.TIME_CORRECTION_NEEDED;
        localStorage.setItem('security_state', SecurityState.TIME_CORRECTION_NEEDED);
        this.restrictNavigation();
    }

    async handleTimeManipulationPattern(events) {
        console.warn('[Security] Time manipulation pattern detected');
        
        // Show pattern warning
        if (this.canShowNotification('time_pattern_warning')) {
            this.showTemporaryNotification({
                type: 'warning',
                title: 'Multiple Time Issues',
                message: 'Multiple time discrepancies detected. This may affect your subscription.',
                duration: 6000
            });
            
            this.lastNotificationTime['time_pattern_warning'] = Date.now();
        }
        
        // Send pattern to server for analysis
        if (navigator.onLine) {
            try {
                await fetch('/api/security/patterns', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Device-Fingerprint': this.deviceFingerprint
                    },
                    body: JSON.stringify({
                        pattern: 'time_manipulation',
                        events: events.slice(-5), // Last 5 events
                        deviceFingerprint: this.deviceFingerprint
                    })
                });
            } catch (error) {
                console.warn('[Security] Could not report pattern:', error);
            }
        }
    }

    async recordGoodTime(clientTime, serverTime) {
        // Record successful time check
        const timeHistory = JSON.parse(localStorage.getItem(SecurityConfig.TIME_HISTORY) || '[]');
        
        timeHistory.push({
            clientTime,
            serverTime,
            timestamp: Date.now(),
            type: 'time_check_ok'
        });
        
        // Keep only last 100 entries
        if (timeHistory.length > 100) {
            timeHistory.splice(0, timeHistory.length - 100);
        }
        
        localStorage.setItem(SecurityConfig.TIME_HISTORY, JSON.stringify(timeHistory));
        
        // Update security state if it was in time correction mode
        if (this.currentState === SecurityState.TIME_CORRECTION_NEEDED) {
            this.currentState = SecurityState.NORMAL;
            localStorage.removeItem('security_state');
            
            // Show success notification
            this.showTemporaryNotification({
                type: 'success',
                title: 'Time Synced',
                message: 'Your device time is now correct.',
                duration: 3000
            });
        }
    }

    async checkOfflineTimeIntegrity(clientTime) {
        // Check against last known good time
        const timeHistory = JSON.parse(localStorage.getItem(SecurityConfig.TIME_HISTORY) || '[]');
        const lastGoodTime = timeHistory.filter(t => t.type === 'time_check_ok').pop();
        
        if (lastGoodTime) {
            const expectedPassedTime = clientTime - lastGoodTime.clientTime;
            const actualPassedTime = Date.now() - lastGoodTime.timestamp;
            
            const timeDrift = Math.abs(expectedPassedTime - actualPassedTime);
            
            if (timeDrift > SecurityConfig.TIME_TOLERANCE * 2) { // More tolerant offline
                console.warn('[Security] Offline time drift detected:', timeDrift);
                
                await this.logSecurityEvent(SecurityEventType.TIME_MISMATCH, {
                    clientTime,
                    lastGoodTime: lastGoodTime.serverTime,
                    timeDrift,
                    isOffline: true
                });
            }
        }
    }

    // ============================================
    // SUBSCRIPTION PROTECTION
    // ============================================

    async validateSubscription(subscriptionData) {
        try {
            if (!subscriptionData) {
                return { isValid: false, reason: 'No subscription data' };
            }
            
            const now = Date.now();
            const checks = JSON.parse(localStorage.getItem(SecurityConfig.SUBSCRIPTION_CHECKS) || '[]');
            
            // Check for rapid subscription validation attempts
            const recentChecks = checks.filter(check => 
                now - check.timestamp < 60000 // Last minute
            );
            
            if (recentChecks.length > 10) {
                // Too many checks in short time - suspicious
                await this.logSecurityEvent(SecurityEventType.SUBSCRIPTION_TAMPER, {
                    checkCount: recentChecks.length,
                    timeframe: '1 minute'
                });
                
                return { 
                    isValid: false, 
                    reason: 'Too many validation attempts',
                    requiresDelay: true 
                };
            }
            
            // Record this check
            checks.push({
                timestamp: now,
                subscriptionId: subscriptionData.id,
                action: 'validation'
            });
            
            // Keep only last 50 checks
            if (checks.length > 50) {
                checks.splice(0, checks.length - 50);
            }
            
            localStorage.setItem(SecurityConfig.SUBSCRIPTION_CHECKS, JSON.stringify(checks));
            
            // Validate expiry date
            if (subscriptionData.expiryDate) {
                const expiryTime = new Date(subscriptionData.expiryDate).getTime();
                
                if (expiryTime < now) {
                    return { isValid: false, reason: 'Subscription expired' };
                }
                
                // Check for suspicious expiry dates (far in future)
                const maxFutureExpiry = now + (365 * 24 * 60 * 60 * 1000); // 1 year max
                if (expiryTime > maxFutureExpiry) {
                    await this.logSecurityEvent(SecurityEventType.SUBSCRIPTION_TAMPER, {
                        expiryDate: subscriptionData.expiryDate,
                        suspicious: 'too_far_future'
                    });
                    
                    return { isValid: false, reason: 'Invalid expiry date' };
                }
            }
            
            return { isValid: true };
            
        } catch (error) {
            console.error('[Security] Subscription validation error:', error);
            return { isValid: false, reason: 'Validation error' };
        }
    }

    async checkSubscriptionTampering(subscriptionData) {
        // Check for signs of subscription tampering
        const signs = [];
        
        // 1. Check if subscription was modified offline
        const lastSync = localStorage.getItem('last_subscription_sync');
        if (lastSync && subscriptionData.lastModified > lastSync) {
            signs.push('modified_offline');
        }
        
        // 2. Check for unrealistic subscription durations
        if (subscriptionData.durationDays > 3650) { // More than 10 years
            signs.push('unrealistic_duration');
        }
        
        // 3. Check for rapid plan changes
        const planChanges = JSON.parse(localStorage.getItem('plan_changes') || '[]');
        const recentChanges = planChanges.filter(change => 
            Date.now() - change.timestamp < 3600000 // Last hour
        );
        
        if (recentChanges.length > 3) {
            signs.push('rapid_plan_changes');
        }
        
        if (signs.length > 0) {
            await this.logSecurityEvent(SecurityEventType.SUBSCRIPTION_TAMPER, {
                signs,
                subscriptionData
            });
            
            return { isTampered: true, signs };
        }
        
        return { isTampered: false };
    }

    // ============================================
    // PAYMENT BYPROTECTION
    // ============================================

    async validatePaymentFlow(paymentData) {
        try {
            // Check for duplicate payment attempts
            const paymentAttempts = JSON.parse(localStorage.getItem('payment_attempts') || '[]');
            const recentAttempts = paymentAttempts.filter(attempt => 
                Date.now() - attempt.timestamp < 300000 // Last 5 minutes
            );
            
            if (recentAttempts.length > 3) {
                // Too many payment attempts
                await this.logSecurityEvent(SecurityEventType.PAYMENT_BYPASS_ATTEMPT, {
                    attempts: recentAttempts.length,
                    timeframe: '5 minutes'
                });
                
                return { 
                    isValid: false, 
                    reason: 'Too many payment attempts',
                    cooloffPeriod: 300000 // 5 minutes
                };
            }
            
            // Record this attempt
            paymentAttempts.push({
                timestamp: Date.now(),
                amount: paymentData.amount,
                plan: paymentData.plan,
                deviceFingerprint: this.deviceFingerprint
            });
            
            // Keep only last 20 attempts
            if (paymentAttempts.length > 20) {
                paymentAttempts.splice(0, paymentAttempts.length - 20);
            }
            
            localStorage.setItem('payment_attempts', JSON.stringify(paymentAttempts));
            
            return { isValid: true };
            
        } catch (error) {
            console.error('[Security] Payment validation error:', error);
            return { isValid: false, reason: 'Validation error' };
        }
    }

    async detectPaymentBypass() {
        // Check for signs of payment bypass attempts
        const signs = [];
        
        // 1. Check for modified subscription data without payment record
        const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
        const payments = JSON.parse(localStorage.getItem('payments') || '[]');
        
        if (subscription.isActive && subscription.plan !== 'trial') {
            const correspondingPayment = payments.find(p => 
                p.subscriptionId === subscription.id
            );
            
            if (!correspondingPayment) {
                signs.push('active_subscription_without_payment');
            }
        }
        
        // 2. Check for trial abuse
        const trialData = JSON.parse(localStorage.getItem('trial_data') || '{}');
        if (trialData.used && trialData.devices && trialData.devices.length > 1) {
            signs.push('multiple_device_trial');
        }
        
        if (signs.length > 0) {
            await this.logSecurityEvent(SecurityEventType.PAYMENT_BYPASS_ATTEMPT, {
                signs,
                subscription,
                deviceFingerprint: this.deviceFingerprint
            });
            
            return { bypassDetected: true, signs };
        }
        
        return { bypassDetected: false };
    }

    // ============================================
    // DEVICE & SESSION PROTECTION
    // ============================================

    async detectMultipleDevices() {
        try {
            // Get stored device sessions
            const sessions = JSON.parse(localStorage.getItem('device_sessions') || '[]');
            
            // Check for concurrent sessions
            const activeSessions = sessions.filter(session => 
                Date.now() - session.lastActive < 300000 // Active in last 5 minutes
            );
            
            if (activeSessions.length > 1) {
                // Multiple active sessions detected
                const differentDevices = activeSessions.filter(session => 
                    session.deviceFingerprint !== this.deviceFingerprint
                );
                
                if (differentDevices.length > 0) {
                    await this.logSecurityEvent(SecurityEventType.MULTIPLE_DEVICES, {
                        currentDevice: this.deviceFingerprint,
                        otherDevices: differentDevices.map(d => d.deviceFingerprint),
                        sessionCount: activeSessions.length
                    });
                    
                    return { multipleDevices: true, deviceCount: activeSessions.length };
                }
            }
            
            // Update current session
            const currentSessionIndex = sessions.findIndex(s => 
                s.deviceFingerprint === this.deviceFingerprint
            );
            
            if (currentSessionIndex >= 0) {
                sessions[currentSessionIndex].lastActive = Date.now();
            } else {
                sessions.push({
                    deviceFingerprint: this.deviceFingerprint,
                    lastActive: Date.now(),
                    userAgent: navigator.userAgent,
                    platform: navigator.platform
                });
            }
            
            // Keep only recent sessions (last 24 hours)
            const filteredSessions = sessions.filter(session => 
                Date.now() - session.lastActive < 86400000
            );
            
            localStorage.setItem('device_sessions', JSON.stringify(filteredSessions));
            
            return { multipleDevices: false };
            
        } catch (error) {
            console.error('[Security] Multiple device detection error:', error);
            return { multipleDevices: false };
        }
    }

    // ============================================
    // EXAM INTEGRITY
    // ============================================

    async monitorExamSession(examData) {
        try {
            const monitoringData = {
                examId: examData.id,
                startTime: Date.now(),
                deviceFingerprint: this.deviceFingerprint,
                events: []
            };
            
            // Start monitoring exam-specific events
            const examMonitor = {
                logEvent: (eventType, data) => {
                    monitoringData.events.push({
                        type: eventType,
                        timestamp: Date.now(),
                        data
                    });
                },
                
                checkIntegrity: () => {
                    // Check for suspicious patterns
                    const suspiciousPatterns = [];
                    
                    // 1. Check answer timing patterns
                    const answerEvents = monitoringData.events.filter(e => 
                        e.type === 'answer_submitted'
                    );
                    
                    if (answerEvents.length > 0) {
                        const answerTimes = answerEvents.map(e => e.data.timeSpent);
                        const avgTime = answerTimes.reduce((a, b) => a + b, 0) / answerTimes.length;
                        
                        // Check for unrealistically consistent times
                        const variance = answerTimes.reduce((sum, time) => 
                            sum + Math.pow(time - avgTime, 2), 0) / answerTimes.length;
                        
                        if (variance < 0.1 && answerTimes.length > 5) {
                            suspiciousPatterns.push('too_consistent_timing');
                        }
                    }
                    
                    // 2. Check for rapid question answering
                    const rapidAnswers = monitoringData.events.filter(e => 
                        e.type === 'answer_submitted' && e.data.timeSpent < 2
                    );
                    
                    if (rapidAnswers.length > 3) {
                        suspiciousPatterns.push('rapid_answering');
                    }
                    
                    // 3. Check for tab switching during exam
                    const visibilityChanges = monitoringData.events.filter(e => 
                        e.type === 'visibility_change'
                    );
                    
                    if (visibilityChanges.length > 5) {
                        suspiciousPatterns.push('frequent_tab_switching');
                    }
                    
                    return suspiciousPatterns;
                },
                
                getReport: () => {
                    const suspiciousPatterns = examMonitor.checkIntegrity();
                    return {
                        examId: monitoringData.examId,
                        duration: Date.now() - monitoringData.startTime,
                        eventCount: monitoringData.events.length,
                        suspiciousPatterns,
                        deviceFingerprint: this.deviceFingerprint
                    };
                }
            };
            
            // Log initial exam start
            examMonitor.logEvent('exam_started', {
                subject: examData.subject,
                questionCount: examData.questionCount,
                mode: examData.mode
            });
            
            return examMonitor;
            
        } catch (error) {
            console.error('[Security] Exam monitoring error:', error);
            return null;
        }
    }

    // ============================================
    // NOTIFICATION SYSTEM (User-friendly)
    // ============================================

    canShowNotification(notificationType) {
        // Check if enough time has passed since last same notification
        const lastTime = this.lastNotificationTime[notificationType];
        if (lastTime) {
            const timeSinceLast = Date.now() - lastTime;
            if (timeSinceLast < SecurityConfig.MIN_NOTIFICATION_INTERVAL) {
                return false;
            }
        }
        
        // Don't show notifications during critical moments (like exams)
        if (document.body.classList.contains('exam-mode')) {
            return false;
        }
        
        // Don't show if user is interacting with payment or subscription pages
        const currentPage = window.location.pathname.split('/').pop();
        const sensitivePages = ['payment.html', 'subscription.html', 'free-trial.html'];
        if (sensitivePages.includes(currentPage)) {
            return false;
        }
        
        return true;
    }

    showTemporaryNotification(options) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `security-notification security-notification-${options.type}`;
        
        notification.innerHTML = `
            <div class="security-notification-content">
                <div class="security-notification-icon">${this.getNotificationIcon(options.type)}</div>
                <div class="security-notification-text">
                    <div class="security-notification-title">${options.title}</div>
                    <div class="security-notification-message">${options.message}</div>
                </div>
                <button class="security-notification-close">&times;</button>
            </div>
            ${options.actions ? `
            <div class="security-notification-actions">
                ${options.actions.map(action => `
                    <button class="security-notification-action" data-action="${action.text}">
                        ${action.text}
                    </button>
                `).join('')}
            </div>
            ` : ''}
        `;
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .security-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                max-width: 400px;
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                overflow: hidden;
                animation: slideIn 0.3s ease-out;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            
            .dark-theme .security-notification {
                background: #2d2d2d;
                color: white;
            }
            
            .security-notification-warning {
                border-left: 4px solid #ff9800;
            }
            
            .security-notification-error {
                border-left: 4px solid #f44336;
            }
            
            .security-notification-info {
                border-left: 4px solid #2196f3;
            }
            
            .security-notification-success {
                border-left: 4px solid #4caf50;
            }
            
            .security-notification-content {
                display: flex;
                align-items: flex-start;
                padding: 16px;
            }
            
            .security-notification-icon {
                font-size: 24px;
                margin-right: 12px;
                flex-shrink: 0;
            }
            
            .security-notification-text {
                flex-grow: 1;
            }
            
            .security-notification-title {
                font-weight: 600;
                font-size: 16px;
                margin-bottom: 4px;
            }
            
            .security-notification-message {
                font-size: 14px;
                line-height: 1.4;
                color: #666;
            }
            
            .dark-theme .security-notification-message {
                color: #aaa;
            }
            
            .security-notification-close {
                background: none;
                border: none;
                font-size: 20px;
                color: #999;
                cursor: pointer;
                padding: 0;
                margin-left: 8px;
                line-height: 1;
            }
            
            .security-notification-actions {
                display: flex;
                padding: 0 16px 16px 16px;
                gap: 8px;
            }
            
            .security-notification-action {
                flex: 1;
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                background: #f5f5f5;
                color: #333;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: background 0.2s;
            }
            
            .dark-theme .security-notification-action {
                background: #3d3d3d;
                color: white;
            }
            
            .security-notification-action:hover {
                background: #e0e0e0;
            }
            
            .dark-theme .security-notification-action:hover {
                background: #4d4d4d;
            }
            
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        
        document.head.appendChild(style);
        document.body.appendChild(notification);
        
        // Add close functionality
        const closeBtn = notification.querySelector('.security-notification-close');
        closeBtn.addEventListener('click', () => {
            notification.style.animation = 'slideOut 0.3s ease-out forwards';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        });
        
        // Add action handlers
        if (options.actions) {
            notification.querySelectorAll('.security-notification-action').forEach((btn, index) => {
                btn.addEventListener('click', () => {
                    options.actions[index].action();
                    notification.style.animation = 'slideOut 0.3s ease-out forwards';
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    }, 300);
                });
            });
        }
        
        // Auto-remove after duration
        if (options.duration) {
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.style.animation = 'slideOut 0.3s ease-out forwards';
                    setTimeout(() => {
                        if (notification.parentNode) {
                            notification.parentNode.removeChild(notification);
                        }
                    }, 300);
                }
            }, options.duration);
        }
    }

    getNotificationIcon(type) {
        const icons = {
            warning: '⚠️',
            error: '❌',
            info: 'ℹ️',
            success: '✅'
        };
        return icons[type] || 'ℹ️';
    }

    // ============================================
    // EVENT HANDLERS
    // ============================================

    async handleOnline() {
        console.log('[Security] Device is online, performing security check...');
        await this.performSecurityCheck();
        
        // Sync security events with server
        if (!this.syncInProgress) {
            this.syncSecurityEvents();
        }
    }

    async handleOffline() {
        console.log('[Security] Device is offline, adjusting security checks...');
        // Reduce monitoring frequency when offline
        if (this.timeCheckInterval) {
            clearInterval(this.timeCheckInterval);
            this.timeCheckInterval = setInterval(() => {
                this.checkTimeIntegrity();
            }, SecurityConfig.TIME_CHECK_INTERVAL * 5); // Check less frequently
        }
    }

    handleVisibilityChange() {
        if (document.hidden) {
            // Tab/window hidden
            this.logSecurityEvent('visibility_change', {
                state: 'hidden',
                timestamp: Date.now()
            });
        } else {
            // Tab/window visible again
            this.logSecurityEvent('visibility_change', {
                state: 'visible',
                timestamp: Date.now()
            });
            
            // Check time integrity when returning
            setTimeout(() => {
                this.checkTimeIntegrity();
            }, 1000);
        }
    }

    handleStorageChange(event) {
        // Monitor for suspicious storage changes
        if (event.key === 'subscription' || event.key === 'trial_data') {
            console.warn('[Security] Suspicious storage change detected:', event.key);
            
            // Log the event
            this.logSecurityEvent('storage_modified', {
                key: event.key,
                oldValue: event.oldValue,
                newValue: event.newValue,
                url: event.url
            });
        }
    }

    // ============================================
    // LOGGING & REPORTING
    // ============================================

    async logSecurityEvent(eventType, data) {
        try {
            const event = {
                type: eventType,
                timestamp: Date.now(),
                data,
                deviceFingerprint: this.deviceFingerprint,
                userAgent: navigator.userAgent,
                page: window.location.pathname
            };
            
            // Get existing events
            const events = JSON.parse(localStorage.getItem(SecurityConfig.SECURITY_EVENTS) || '[]');
            
            // Add new event
            events.push(event);
            
            // Keep only last 100 events
            if (events.length > 100) {
                events.splice(0, events.length - 100);
            }
            
            // Save back to localStorage
            localStorage.setItem(SecurityConfig.SECURITY_EVENTS, JSON.stringify(events));
            
            // Send to server if online (non-blocking)
            if (navigator.onLine && !this.syncInProgress) {
                this.syncSecurityEvent(event);
            }
            
            console.log(`[Security] Event logged: ${eventType}`, data);
            
            // Check for suspicious patterns
            await this.checkForSuspiciousPatterns(events);
            
        } catch (error) {
            console.error('[Security] Error logging event:', error);
        }
    }

    async syncSecurityEvent(event) {
        try {
            // Don't sync if already in progress
            if (this.syncInProgress) return;
            
            this.syncInProgress = true;
            
            await fetch('/api/security/events', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-Fingerprint': this.deviceFingerprint
                },
                body: JSON.stringify(event)
            });
            
            this.syncInProgress = false;
            
        } catch (error) {
            console.warn('[Security] Could not sync event:', error);
            this.syncInProgress = false;
        }
    }

    async syncSecurityEvents() {
        try {
            const events = JSON.parse(localStorage.getItem(SecurityConfig.SECURITY_EVENTS) || '[]');
            const unsyncedEvents = events.filter(event => !event.synced);
            
            if (unsyncedEvents.length === 0) return;
            
            this.syncInProgress = true;
            
            for (const event of unsyncedEvents.slice(0, 10)) { // Sync max 10 at a time
                try {
                    await fetch('/api/security/events', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Device-Fingerprint': this.deviceFingerprint
                        },
                        body: JSON.stringify(event)
                    });
                    
                    // Mark as synced
                    event.synced = true;
                    
                } catch (error) {
                    console.warn('[Security] Failed to sync event:', error);
                    break; // Stop on first error
                }
            }
            
            // Update localStorage with synced status
            localStorage.setItem(SecurityConfig.SECURITY_EVENTS, JSON.stringify(events));
            
            this.syncInProgress = false;
            
        } catch (error) {
            console.error('[Security] Error syncing events:', error);
            this.syncInProgress = false;
        }
    }

    async checkForSuspiciousPatterns(events) {
        // Check for patterns that might indicate cheating
        const now = Date.now();
        const recentEvents = events.filter(event => 
            now - event.timestamp < SecurityConfig.SUSPICIOUS_WINDOW
        );
        
        // Group by type
        const eventCounts = {};
        recentEvents.forEach(event => {
            eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
        });
        
        // Check for excessive time mismatches
        if (eventCounts[SecurityEventType.TIME_MISMATCH] > SecurityConfig.MAX_SUSPICIOUS_EVENTS) {
            console.warn('[Security] Excessive time mismatches detected');
            
            // Show gentle warning
            if (this.canShowNotification('excessive_time_warnings')) {
                this.showTemporaryNotification({
                    type: 'warning',
                    title: 'Time Sync Issues',
                    message: 'Multiple time sync issues detected. Please ensure your device time is set correctly.',
                    duration: SecurityConfig.NOTIFICATION_DURATION
                });
                
                this.lastNotificationTime['excessive_time_warnings'] = Date.now();
            }
        }
        
        // Check for subscription tampering patterns
        if (eventCounts[SecurityEventType.SUBSCRIPTION_TAMPER] > 2) {
            console.warn('[Security] Subscription tampering pattern detected');
            
            // This is more serious - show stronger warning
            if (this.canShowNotification('subscription_tampering')) {
                this.showTemporaryNotification({
                    type: 'error',
                    title: 'Account Issue',
                    message: 'Suspicious activity detected. Please contact support if you need assistance.',
                    duration: 8000,
                    persistent: true
                });
                
                this.lastNotificationTime['subscription_tampering'] = Date.now();
            }
        }
    }

    // ============================================
    // PUBLIC API
    // ============================================

    async performSecurityCheck() {
        console.log('[Security] Performing comprehensive security check...');
        
        try {
            // 1. Check time integrity
            await this.checkTimeIntegrity();
            
            // 2. Check for multiple devices
            await this.detectMultipleDevices();
            
            // 3. Check subscription tampering
            const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
            if (subscription.isActive) {
                await this.checkSubscriptionTampering(subscription);
            }
            
            // 4. Check for payment bypass attempts
            await this.detectPaymentBypass();
            
            // 5. Update last check timestamp
            localStorage.setItem(SecurityConfig.LAST_SECURITY_CHECK, Date.now().toString());
            
            console.log('[Security] Security check completed');
            
        } catch (error) {
            console.error('[Security] Security check error:', error);
        }
    }

    getSecurityStatus() {
        return {
            state: this.currentState,
            deviceFingerprint: this.deviceFingerprint,
            lastCheck: localStorage.getItem(SecurityConfig.LAST_SECURITY_CHECK),
            eventCount: JSON.parse(localStorage.getItem(SecurityConfig.SECURITY_EVENTS) || '[]').length
        };
    }

    resetSecurityState() {
        // Only reset if not in locked state
        if (this.currentState !== SecurityState.LOCKED) {
            this.currentState = SecurityState.NORMAL;
            localStorage.removeItem('security_state');
            
            // Clear notifications
            document.querySelectorAll('.security-notification').forEach(notification => {
                notification.remove();
            });
            
            console.log('[Security] Security state reset to NORMAL');
        }
    }

    async syncDeviceTime() {
        try {
            // Get accurate server time
            const serverTime = await this.getServerTime();
            
            if (serverTime) {
                // Calculate correction
                const clientTime = Date.now();
                const correction = serverTime - clientTime;
                
                // Store correction for future reference
                const corrections = JSON.parse(localStorage.getItem('time_corrections') || '[]');
                corrections.push({
                    clientTime,
                    serverTime,
                    correction,
                    correctedAt: Date.now()
                });
                localStorage.setItem('time_corrections', JSON.stringify(corrections.slice(-10)));
                
                // Show success message
                this.showTemporaryNotification({
                    type: 'success',
                    title: 'Time Synced',
                    message: `Time adjusted by ${Math.abs(correction) > 60000 ? 
                        `${Math.round(Math.abs(correction) / 60000)} minutes` : 
                        `${Math.round(Math.abs(correction) / 1000)} seconds'}`,
                    duration: 3000
                });
                
                // Reset security state
                this.resetSecurityState();
                
                return true;
            }
        } catch (error) {
            console.error('[Security] Time sync error:', error);
            this.showTemporaryNotification({
                type: 'error',
                title: 'Sync Failed',
                message: 'Could not sync time. Please check your internet connection.',
                duration: 5000
            });
        }
        
        return false;
    }

    // ============================================
    // DESTRUCTOR
    // ============================================

    destroy() {
        this.stopMonitoring();
        
        // Remove event listeners
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.handleOffline);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('storage', this.handleStorageChange);
        
        console.log('[Security] Security system destroyed');
    }
}

// ============================================
// GLOBAL SECURITY INSTANCE
// ============================================

let securityInstance = null;

function initSecurity() {
    if (!securityInstance) {
        securityInstance = new SecuritySystem();
    }
    return securityInstance;
}

function getSecurity() {
    if (!securityInstance) {
        return initSecurity();
    }
    return securityInstance;
}

// ============================================
// SECURITY HELPER FUNCTIONS
// ============================================

function validateSubscriptionAccess() {
    const security = getSecurity();
    const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
    
    return security.validateSubscription(subscription);
}

function checkExamIntegrity(examData) {
    const security = getSecurity();
    return security.monitorExamSession(examData);
}

function performQuickSecurityCheck() {
    const security = getSecurity();
    return security.performSecurityCheck();
}

// ============================================
// EXPORTS (if using modules)
// ============================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SecuritySystem,
        SecurityState,
        SecurityConfig,
        SecurityEventType,
        initSecurity,
        getSecurity,
        validateSubscriptionAccess,
        checkExamIntegrity,
        performQuickSecurityCheck
    };
} else {
    // Browser global
    window.MedicalExamSecurity = {
        SecuritySystem,
        SecurityState,
        SecurityConfig,
        SecurityEventType,
        initSecurity,
        getSecurity,
        validateSubscriptionAccess,
        checkExamIntegrity,
        performQuickSecurityCheck
    };
}

// Auto-initialize if in browser
if (typeof window !== 'undefined') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                initSecurity();
            }, 1000); // Small delay to not interfere with page load
        });
    } else {
        setTimeout(() => {
            initSecurity();
        }, 1000);
    }
}
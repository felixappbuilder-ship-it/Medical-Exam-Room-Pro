/**
 * Medical Exam Room Pro - Main Application Controller
 * Handles app initialization, state management, and core functionality
 */

const MedicalExamApp = (function() {
    // App state
    const state = {
        user: null,
        subscription: null,
        exam: null,
        isOnline: navigator.onLine,
        theme: 'light',
        isInitialized: false,
        security: {
            deviceFingerprint: null,
            lastTimeCheck: null,
            isLocked: false
        }
    };

    // Event bus for component communication
    const events = {};

    // Public methods
    return {
        // Initialize the application
        async init() {
            if (state.isInitialized) return;

            try {
                console.log('Initializing Medical Exam Room Pro...');

                // Load saved state
                await this.loadSavedState();

                // Initialize security
                await this.initSecurity();

                // Set up event listeners
                this.setupEventListeners();

                // Check subscription status
                await this.checkSubscriptionStatus();

                // Update UI based on state
                this.updateUI();

                // Mark as initialized
                state.isInitialized = true;

                console.log('App initialized successfully');
                this.triggerEvent('app:initialized', state);

            } catch (error) {
                console.error('App initialization failed:', error);
                this.showError('Failed to initialize app. Please refresh.');
            }
        },

        // Load saved state from localStorage
        async loadSavedState() {
            try {
                // Load user data
                const userData = localStorage.getItem('userData');
                if (userData) {
                    state.user = JSON.parse(userData);
                }

                // Load subscription data
                const subscriptionData = localStorage.getItem('subscription');
                if (subscriptionData) {
                    state.subscription = JSON.parse(subscriptionData);
                }

                // Load theme preference
                const savedTheme = localStorage.getItem('theme');
                if (savedTheme) {
                    state.theme = savedTheme;
                    document.body.classList.toggle('dark-theme', savedTheme === 'dark');
                }

                // Load exam progress if any
                const examProgress = localStorage.getItem('examProgress');
                if (examProgress) {
                    state.exam = JSON.parse(examProgress);
                }

                console.log('State loaded from localStorage');
            } catch (error) {
                console.warn('Failed to load saved state:', error);
            }
        },

        // Initialize security features
        async initSecurity() {
            try {
                // Generate or retrieve device fingerprint
                state.security.deviceFingerprint = this.generateDeviceFingerprint();
                localStorage.setItem('deviceFingerprint', state.security.deviceFingerprint);

                // Check if account is locked
                const lockReason = localStorage.getItem('lockReason');
                if (lockReason) {
                    state.security.isLocked = true;
                    this.redirectToLocked(lockReason);
                    return;
                }

                // Perform time validation
                await this.validateTime();

                // Check for cheating attempts
                await this.checkSecurityViolations();

                console.log('Security initialized');
            } catch (error) {
                console.error('Security initialization failed:', error);
            }
        },

        // Generate device fingerprint
        generateDeviceFingerprint() {
            // Check if already exists
            const existingFingerprint = localStorage.getItem('deviceFingerprint');
            if (existingFingerprint) {
                return existingFingerprint;
            }

            // Generate new fingerprint
            const components = [
                navigator.userAgent,
                navigator.language,
                navigator.platform,
                screen.width + 'x' + screen.height,
                new Date().getTimezoneOffset(),
                'medical_exam_room_pro_v1'
            ];

            // Simple hash function
            let hash = 0;
            for (let i = 0; i < components.length; i++) {
                const char = components[i].charCodeAt(i % components[i].length);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }

            const fingerprint = 'device_' + Math.abs(hash).toString(16);
            return fingerprint;
        },

        // Validate time to prevent cheating
        async validateTime() {
            try {
                const clientTime = Date.now();
                state.security.lastTimeCheck = clientTime;

                // Store client time for server validation
                localStorage.setItem('lastClientTime', clientTime.toString());

                // Check for time manipulation
                const lastSavedTime = localStorage.getItem('lastValidatedTime');
                if (lastSavedTime) {
                    const timeDiff = Math.abs(clientTime - parseInt(lastSavedTime));
                    
                    // If time difference is too large (more than 5 minutes), suspect cheating
                    if (timeDiff > 300000) { // 5 minutes
                        this.logSecurityViolation('time_manipulation', {
                            clientTime,
                            savedTime: parseInt(lastSavedTime),
                            difference: timeDiff
                        });
                        
                        // Only lock if offline (online will be validated by server)
                        if (!state.isOnline) {
                            this.lockAccount('Time manipulation detected');
                        }
                    }
                }

                // Save current time for next validation
                localStorage.setItem('lastValidatedTime', clientTime.toString());

            } catch (error) {
                console.error('Time validation failed:', error);
            }
        },

        // Check for security violations
        async checkSecurityViolations() {
            try {
                // Check for multiple failed logins
                const failedLogins = parseInt(localStorage.getItem('failedLoginAttempts') || '0');
                if (failedLogins > 5) {
                    this.logSecurityViolation('multiple_failed_logins', { count: failedLogins });
                    this.lockAccount('Multiple failed login attempts');
                }

                // Check subscription tampering
                if (state.subscription) {
                    const encryptedExpiry = localStorage.getItem('encryptedExpiry');
                    if (encryptedExpiry) {
                        // In production, this would decrypt and validate
                        // For now, just check if it exists
                        const isValid = await this.validateSubscriptionEncryption(encryptedExpiry);
                        if (!isValid) {
                            this.lockAccount('Subscription tampering detected');
                        }
                    }
                }

            } catch (error) {
                console.error('Security check failed:', error);
            }
        },

        // Validate subscription encryption (placeholder)
        async validateSubscriptionEncryption(encryptedData) {
            // In production, this would decrypt and validate against server
            // For now, return true
            return true;
        },

        // Log security violation
        logSecurityViolation(type, data) {
            const violation = {
                type,
                data,
                timestamp: new Date().toISOString(),
                deviceFingerprint: state.security.deviceFingerprint,
                user: state.user?.email || 'unknown'
            };

            // Save to localStorage
            const violations = JSON.parse(localStorage.getItem('securityViolations') || '[]');
            violations.push(violation);
            localStorage.setItem('securityViolations', JSON.stringify(violations));

            // Send to server if online
            if (state.isOnline) {
                this.sendSecurityLog(violation);
            }

            console.warn('Security violation:', violation);
        },

        // Send security log to server
        async sendSecurityLog(violation) {
            try {
                // In production, this would send to backend API
                // For now, just log to console
                console.log('Security log sent:', violation);
            } catch (error) {
                console.error('Failed to send security log:', error);
            }
        },

        // Lock account
        lockAccount(reason) {
            state.security.isLocked = true;
            
            const lockData = {
                reason,
                timestamp: new Date().toISOString(),
                deviceFingerprint: state.security.deviceFingerprint,
                lockId: 'LOCK_' + Date.now()
            };

            localStorage.setItem('lockReason', reason);
            localStorage.setItem('lockData', JSON.stringify(lockData));
            localStorage.setItem('lockId', lockData.lockId);
            localStorage.setItem('lockTime', lockData.timestamp);

            this.redirectToLocked(reason);
        },

        // Redirect to locked page
        redirectToLocked(reason) {
            // Don't redirect if already on locked page
            if (window.location.pathname.includes('locked.html')) return;

            // Store current page to return to after unlock
            if (!window.location.pathname.includes('locked.html')) {
                sessionStorage.setItem('lastPage', window.location.href);
            }

            window.location.href = 'locked.html';
        },

        // Check subscription status
        async checkSubscriptionStatus() {
            try {
                if (!state.subscription) {
                    // No subscription found
                    return;
                }

                // Check if subscription is expired
                if (state.subscription.expiryDate) {
                    const expiryDate = new Date(state.subscription.expiryDate);
                    const now = new Date();
                    
                    if (expiryDate <= now) {
                        state.subscription.isActive = false;
                        localStorage.setItem('subscription', JSON.stringify(state.subscription));
                    }
                }

                // If online, validate with server
                if (state.isOnline) {
                    await this.validateSubscriptionWithServer();
                }

            } catch (error) {
                console.error('Subscription check failed:', error);
            }
        },

        // Validate subscription with server (placeholder)
        async validateSubscriptionWithServer() {
            // In production, this would call backend API
            // For now, just update localStorage
            if (state.subscription) {
                localStorage.setItem('subscription', JSON.stringify(state.subscription));
            }
        },

        // Set up event listeners
        setupEventListeners() {
            // Online/offline detection
            window.addEventListener('online', () => {
                state.isOnline = true;
                this.triggerEvent('network:online');
                this.handleOnline();
            });

            window.addEventListener('offline', () => {
                state.isOnline = false;
                this.triggerEvent('network:offline');
                this.handleOffline();
            });

            // Visibility change (tab switching)
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.triggerEvent('app:background');
                } else {
                    this.triggerEvent('app:foreground');
                }
            });

            // Before unload (save state)
            window.addEventListener('beforeunload', (e) => {
                if (state.exam && state.exam.isActive) {
                    e.preventDefault();
                    e.returnValue = 'You have an active exam. Are you sure you want to leave?';
                    this.saveExamProgress();
                }
            });

            // Error handling
            window.addEventListener('error', (error) => {
                this.logError(error);
            });

            // Unhandled promise rejections
            window.addEventListener('unhandledrejection', (event) => {
                this.logError(event.reason);
            });

            console.log('Event listeners setup complete');
        },

        // Handle coming online
        async handleOnline() {
            console.log('App is online');
            
            // Sync data with server
            await this.syncData();
            
            // Validate subscription
            await this.checkSubscriptionStatus();
            
            // Send pending security logs
            await this.sendPendingSecurityLogs();
            
            // Update UI
            this.updateUI();
        },

        // Handle going offline
        handleOffline() {
            console.log('App is offline');
            
            // Save current state
            this.saveState();
            
            // Show offline indicator
            this.showOfflineIndicator();
        },

        // Sync data with server
        async syncData() {
            try {
                // Sync exam results
                await this.syncExamResults();
                
                // Sync user data
                await this.syncUserData();
                
                // Download updates
                await this.downloadUpdates();
                
                this.triggerEvent('sync:complete');
            } catch (error) {
                console.error('Sync failed:', error);
                this.triggerEvent('sync:failed', error);
            }
        },

        // Sync exam results (placeholder)
        async syncExamResults() {
            // In production, this would upload pending exam results
            const pendingResults = JSON.parse(localStorage.getItem('pendingExamResults') || '[]');
            if (pendingResults.length > 0) {
                console.log(`Syncing ${pendingResults.length} exam results...`);
                // Upload logic here
                localStorage.removeItem('pendingExamResults');
            }
        },

        // Sync user data (placeholder)
        async syncUserData() {
            // In production, this would sync user profile and preferences
            console.log('Syncing user data...');
        },

        // Download updates (placeholder)
        async downloadUpdates() {
            // In production, this would download question updates, etc.
            console.log('Checking for updates...');
        },

        // Send pending security logs
        async sendPendingSecurityLogs() {
            const pendingLogs = JSON.parse(localStorage.getItem('pendingSecurityLogs') || '[]');
            if (pendingLogs.length > 0) {
                console.log(`Sending ${pendingLogs.length} pending security logs...`);
                // Send logic here
                localStorage.removeItem('pendingSecurityLogs');
            }
        },

        // Save exam progress
        saveExamProgress() {
            if (state.exam) {
                localStorage.setItem('examProgress', JSON.stringify(state.exam));
                console.log('Exam progress saved');
            }
        },

        // Save app state
        saveState() {
            try {
                if (state.user) {
                    localStorage.setItem('userData', JSON.stringify(state.user));
                }
                
                if (state.subscription) {
                    localStorage.setItem('subscription', JSON.stringify(state.subscription));
                }
                
                console.log('App state saved');
            } catch (error) {
                console.error('Failed to save state:', error);
            }
        },

        // Update UI based on state
        updateUI() {
            // Update online/offline indicator
            this.updateNetworkIndicator();
            
            // Update subscription status display
            this.updateSubscriptionIndicator();
            
            // Update user info if available
            this.updateUserInfo();
            
            // Update theme
            this.updateTheme();
        },

        // Update network indicator
        updateNetworkIndicator() {
            const indicators = document.querySelectorAll('.network-indicator');
            indicators.forEach(indicator => {
                indicator.textContent = state.isOnline ? 'Online' : 'Offline';
                indicator.className = `network-indicator ${state.isOnline ? 'online' : 'offline'}`;
            });
        },

        // Update subscription indicator
        updateSubscriptionIndicator() {
            const indicators = document.querySelectorAll('.subscription-indicator');
            indicators.forEach(indicator => {
                if (!state.subscription || !state.subscription.isActive) {
                    indicator.textContent = 'No Active Subscription';
                    indicator.className = 'subscription-indicator inactive';
                } else {
                    const expiryDate = new Date(state.subscription.expiryDate);
                    const daysLeft = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
                    indicator.textContent = `Expires in ${daysLeft} days`;
                    indicator.className = 'subscription-indicator active';
                }
            });
        },

        // Update user info
        updateUserInfo() {
            const userElements = document.querySelectorAll('.user-info');
            userElements.forEach(element => {
                if (state.user) {
                    element.textContent = `${state.user.firstName} ${state.user.lastName}`;
                    element.style.display = 'block';
                } else {
                    element.style.display = 'none';
                }
            });
        },

        // Update theme
        updateTheme() {
            document.body.classList.toggle('dark-theme', state.theme === 'dark');
        },

        // Show offline indicator
        showOfflineIndicator() {
            // Create or show offline indicator
            let indicator = document.querySelector('.offline-notification');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'offline-notification';
                indicator.innerHTML = `
                    <div class="offline-content">
                        <span class="offline-icon">📶</span>
                        <span class="offline-text">You are offline. Some features may be limited.</span>
                    </div>
                `;
                document.body.appendChild(indicator);
                
                // Auto-hide after 5 seconds
                setTimeout(() => {
                    indicator.style.display = 'none';
                }, 5000);
            } else {
                indicator.style.display = 'block';
            }
        },

        // Show error message
        showError(message, duration = 5000) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-notification';
            errorDiv.innerHTML = `
                <div class="error-content">
                    <span class="error-icon">❌</span>
                    <span class="error-text">${message}</span>
                    <button class="error-close">×</button>
                </div>
            `;
            
            document.body.appendChild(errorDiv);
            
            // Close button
            errorDiv.querySelector('.error-close').addEventListener('click', () => {
                errorDiv.remove();
            });
            
            // Auto-remove after duration
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.remove();
                }
            }, duration);
        },

        // Log error
        logError(error) {
            const errorLog = {
                message: error.message || String(error),
                stack: error.stack,
                timestamp: new Date().toISOString(),
                url: window.location.href,
                userAgent: navigator.userAgent
            };

            // Save to localStorage
            const errors = JSON.parse(localStorage.getItem('errorLogs') || '[]');
            errors.push(errorLog);
            localStorage.setItem('errorLogs', JSON.stringify(errors));

            console.error('Error logged:', errorLog);
        },

        // Event system
        on(event, callback) {
            if (!events[event]) events[event] = [];
            events[event].push(callback);
        },

        off(event, callback) {
            if (!events[event]) return;
            const index = events[event].indexOf(callback);
            if (index > -1) {
                events[event].splice(index, 1);
            }
        },

        triggerEvent(event, data) {
            if (!events[event]) return;
            events[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event handler for ${event}:`, error);
                }
            });
        },

        // Get app state
        getState() {
            return { ...state };
        },

        // Get user
        getUser() {
            return state.user ? { ...state.user } : null;
        },

        // Get subscription
        getSubscription() {
            return state.subscription ? { ...state.subscription } : null;
        },

        // Set user
        setUser(userData) {
            state.user = { ...userData };
            localStorage.setItem('userData', JSON.stringify(state.user));
            this.triggerEvent('user:updated', state.user);
            this.updateUI();
        },

        // Set subscription
        setSubscription(subscriptionData) {
            state.subscription = { ...subscriptionData };
            localStorage.setItem('subscription', JSON.stringify(state.subscription));
            this.triggerEvent('subscription:updated', state.subscription);
            this.updateUI();
        },

        // Set theme
        setTheme(theme) {
            if (theme !== 'light' && theme !== 'dark') return;
            state.theme = theme;
            localStorage.setItem('theme', theme);
            this.updateTheme();
            this.triggerEvent('theme:changed', theme);
        },

        // Toggle theme
        toggleTheme() {
            const newTheme = state.theme === 'light' ? 'dark' : 'light';
            this.setTheme(newTheme);
        },

        // Clear all data (logout)
        clearData() {
            state.user = null;
            state.subscription = null;
            state.exam = null;
            
            // Clear sensitive data from localStorage
            localStorage.removeItem('userData');
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('tokenExpiry');
            
            // Keep device fingerprint and preferences
            // localStorage.removeItem('deviceFingerprint');
            // localStorage.removeItem('userPreferences');
            
            this.triggerEvent('app:loggedout');
            this.updateUI();
            
            console.log('App data cleared');
        },

        // Check if user is authenticated
        isAuthenticated() {
            return !!state.user && !!localStorage.getItem('accessToken');
        },

        // Check if subscription is active
        hasActiveSubscription() {
            if (!state.subscription || !state.subscription.isActive) return false;
            
            if (state.subscription.expiryDate) {
                const expiryDate = new Date(state.subscription.expiryDate);
                return expiryDate > new Date();
            }
            
            return state.subscription.isActive;
        },

        // Check if trial is available
        isTrialAvailable() {
            const deviceId = state.security.deviceFingerprint;
            const trialUsed = localStorage.getItem(`trialUsed_${deviceId}`);
            return trialUsed !== 'true' && !this.hasActiveSubscription();
        },

        // Get remaining trial time (if active)
        getRemainingTrialTime() {
            if (!state.subscription || state.subscription.plan !== 'trial') return 0;
            
            if (state.subscription.expiryDate) {
                const expiryDate = new Date(state.subscription.expiryDate);
                const now = new Date();
                const remaining = expiryDate - now;
                return Math.max(0, remaining);
            }
            
            return 0;
        }
    };
})();

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    MedicalExamApp.init();
});

// Make app globally available
window.MedicalExamApp = MedicalExamApp;
window.initApp = MedicalExamApp.init.bind(MedicalExamApp);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MedicalExamApp;
}
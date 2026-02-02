// scripts/router.js

/**
 * Medical Exam Room Pro - Router & Navigation Manager
 * 
 * This router handles navigation validation, subscription checking,
 * authentication verification, and security checks for all page transitions.
 */

const Router = {
    // Current page state
    currentPage: '',
    userState: null,
    subscriptionState: null,
    securityState: null,
    
    // Page access requirements
    pageRequirements: {
        // Public pages (no authentication required)
        'index.html': { auth: false, subscription: false },
        'welcome.html': { auth: false, subscription: false },
        'login.html': { auth: false, subscription: false },
        'signup.html': { auth: false, subscription: false },
        'free-trial.html': { auth: false, subscription: false },
        'locked.html': { auth: false, subscription: false },
        
        // Protected pages (authentication required)
        'subjects.html': { auth: true, subscription: false },
        'anatomy.html': { auth: true, subscription: false },
        'physiology.html': { auth: true, subscription: false },
        'biochemistry.html': { auth: true, subscription: false },
        'histology.html': { auth: true, subscription: false },
        'embryology.html': { auth: true, subscription: false },
        'pathology.html': { auth: true, subscription: false },
        'pharmacology.html': { auth: true, subscription: false },
        'microbiology.html': { auth: true, subscription: false },
        'profile.html': { auth: true, subscription: false },
        'performance.html': { auth: true, subscription: false },
        
        // Subscription-required pages
        'subscription.html': { auth: true, subscription: true },
        'payment.html': { auth: true, subscription: true },
        'exam-settings.html': { auth: true, subscription: true },
        'exam-room.html': { auth: true, subscription: true },
        'results.html': { auth: true, subscription: true }
    },
    
    // Navigation flow (what pages can navigate to what)
    navigationFlow: {
        'index.html': ['welcome.html', 'login.html', 'signup.html', 'subjects.html'],
        'welcome.html': ['login.html', 'signup.html', 'free-trial.html', 'subjects.html'],
        'login.html': ['welcome.html', 'subjects.html', 'profile.html'],
        'signup.html': ['welcome.html', 'free-trial.html'],
        'free-trial.html': ['subjects.html', 'subscription.html'],
        'subjects.html': ['anatomy.html', 'physiology.html', 'biochemistry.html', 'histology.html', 
                         'embryology.html', 'pathology.html', 'pharmacology.html', 'microbiology.html',
                         'subscription.html', 'profile.html', 'performance.html'],
        // Subject pages can go to exam-settings
        'anatomy.html': ['subjects.html', 'exam-settings.html'],
        'physiology.html': ['subjects.html', 'exam-settings.html'],
        'biochemistry.html': ['subjects.html', 'exam-settings.html'],
        'histology.html': ['subjects.html', 'exam-settings.html'],
        'embryology.html': ['subjects.html', 'exam-settings.html'],
        'pathology.html': ['subjects.html', 'exam-settings.html'],
        'pharmacology.html': ['subjects.html', 'exam-settings.html'],
        'microbiology.html': ['subjects.html', 'exam-settings.html'],
        'subscription.html': ['payment.html', 'subjects.html'],
        'payment.html': ['subjects.html', 'subscription.html'],
        'exam-settings.html': ['exam-room.html', 'subjects.html'],
        'exam-room.html': ['results.html', 'exam-settings.html'],
        'results.html': ['performance.html', 'subjects.html', 'exam-settings.html'],
        'performance.html': ['subjects.html', 'results.html'],
        'profile.html': ['subjects.html', 'index.html']
    },
    
    /**
     * Initialize the router
     */
    init() {
        this.currentPage = this.getCurrentPage();
        this.loadUserState();
        this.loadSubscriptionState();
        this.loadSecurityState();
        
        console.log(`Router initialized on ${this.currentPage}`);
        console.log('User state:', this.userState);
        console.log('Subscription state:', this.subscriptionState);
        
        // Check if user should be redirected
        this.checkPageAccess();
        
        // Set up navigation event listeners
        this.setupNavigationListeners();
        
        // Check for time manipulation
        this.checkTimeManipulation();
        
        // Start security monitoring
        this.startSecurityMonitoring();
        
        // Apply saved theme
        this.applyTheme();
    },
    
    /**
     * Get current page filename
     */
    getCurrentPage() {
        const path = window.location.pathname;
        const page = path.substring(path.lastIndexOf('/') + 1);
        return page || 'index.html';
    },
    
    /**
     * Load user authentication state
     */
    loadUserState() {
        const accessToken = localStorage.getItem('accessToken');
        const userData = localStorage.getItem('userData');
        const tokenExpiry = localStorage.getItem('tokenExpiry');
        
        this.userState = {
            isAuthenticated: false,
            userData: null,
            tokenValid: false
        };
        
        if (accessToken && userData) {
            try {
                this.userState.userData = JSON.parse(userData);
                this.userState.isAuthenticated = true;
                
                // Check token expiry
                if (tokenExpiry) {
                    const expiryDate = new Date(tokenExpiry);
                    this.userState.tokenValid = expiryDate > new Date();
                    
                    if (!this.userState.tokenValid) {
                        // Token expired, clear it
                        localStorage.removeItem('accessToken');
                        localStorage.removeItem('userData');
                        localStorage.removeItem('tokenExpiry');
                        this.userState.isAuthenticated = false;
                        this.userState.userData = null;
                    }
                }
            } catch (error) {
                console.error('Error parsing user data:', error);
                this.userState.isAuthenticated = false;
                this.userState.userData = null;
            }
        }
    },
    
    /**
     * Load subscription state
     */
    loadSubscriptionState() {
        const subscriptionData = localStorage.getItem('subscription');
        
        this.subscriptionState = {
            hasSubscription: false,
            isActive: false,
            plan: null,
            expiryDate: null,
            isTrial: false,
            timeRemaining: 0
        };
        
        if (subscriptionData) {
            try {
                const subscription = JSON.parse(subscriptionData);
                this.subscriptionState.hasSubscription = true;
                this.subscriptionState.plan = subscription.plan;
                this.subscriptionState.isTrial = subscription.trial || false;
                
                if (subscription.expiryDate) {
                    const expiryDate = new Date(subscription.expiryDate);
                    const now = new Date();
                    
                    this.subscriptionState.expiryDate = expiryDate;
                    this.subscriptionState.isActive = expiryDate > now;
                    this.subscriptionState.timeRemaining = expiryDate - now;
                }
            } catch (error) {
                console.error('Error parsing subscription data:', error);
            }
        }
        
        // Check for active trial
        const trialEndTime = localStorage.getItem('trialEndTime');
        if (trialEndTime && !this.subscriptionState.isActive) {
            const trialEnd = parseInt(trialEndTime);
            const now = Date.now();
            
            if (trialEnd > now) {
                this.subscriptionState.hasSubscription = true;
                this.subscriptionState.isActive = true;
                this.subscriptionState.isTrial = true;
                this.subscriptionState.plan = 'trial';
                this.subscriptionState.timeRemaining = trialEnd - now;
            }
        }
    },
    
    /**
     * Load security state
     */
    loadSecurityState() {
        const isLocked = localStorage.getItem('accountLocked') === 'true';
        const lockReason = localStorage.getItem('lockReason');
        const lockTime = localStorage.getItem('lockTime');
        
        this.securityState = {
            isLocked: isLocked,
            lockReason: lockReason,
            lockTime: lockTime,
            lastTimeCheck: localStorage.getItem('lastTimeCheck') || Date.now(),
            timeManipulationDetected: localStorage.getItem('timeManipulationDetected') === 'true'
        };
    },
    
    /**
     * Check if current page access is allowed
     */
    checkPageAccess() {
        const page = this.currentPage;
        const requirements = this.pageRequirements[page];
        
        if (!requirements) {
            console.warn(`No requirements defined for page: ${page}`);
            return true;
        }
        
        // Check if account is locked
        if (this.securityState.isLocked && page !== 'locked.html') {
            this.redirectToLocked();
            return false;
        }
        
        // Check authentication requirement
        if (requirements.auth && !this.userState.isAuthenticated) {
            this.redirectToLogin();
            return false;
        }
        
        // Check subscription requirement
        if (requirements.subscription && !this.subscriptionState.isActive) {
            this.redirectToSubscription();
            return false;
        }
        
        // Special case: If user is authenticated and tries to access login/signup,
        // redirect them to subjects page
        if ((page === 'login.html' || page === 'signup.html' || page === 'welcome.html') && 
            this.userState.isAuthenticated && this.subscriptionState.isActive) {
            window.location.href = 'subjects.html';
            return false;
        }
        
        return true;
    },
    
    /**
     * Check if navigation to target page is allowed
     */
    canNavigateTo(targetPage) {
        // Get source page (current page)
        const sourcePage = this.currentPage;
        
        // Check if target page exists in requirements
        if (!this.pageRequirements[targetPage]) {
            console.warn(`Target page not found in requirements: ${targetPage}`);
            return false;
        }
        
        // Check if account is locked
        if (this.securityState.isLocked && targetPage !== 'locked.html') {
            return false;
        }
        
        // Check navigation flow
        const allowedPages = this.navigationFlow[sourcePage];
        if (allowedPages && !allowedPages.includes(targetPage)) {
            console.warn(`Navigation from ${sourcePage} to ${targetPage} not allowed in flow`);
            // Still allow if user is going back (browser history)
            return window.history.length > 1;
        }
        
        // Check page requirements
        const requirements = this.pageRequirements[targetPage];
        
        if (requirements.auth && !this.userState.isAuthenticated) {
            return false;
        }
        
        if (requirements.subscription && !this.subscriptionState.isActive) {
            return false;
        }
        
        return true;
    },
    
    /**
     * Navigate to a page with validation
     */
    navigateTo(page, force = false) {
        if (!force && !this.canNavigateTo(page)) {
            // Show appropriate error message
            if (this.securityState.isLocked) {
                this.redirectToLocked();
            } else if (!this.userState.isAuthenticated) {
                this.redirectToLogin();
            } else if (!this.subscriptionState.isActive) {
                this.redirectToSubscription();
            } else {
                alert('Navigation to this page is not allowed from your current location.');
            }
            return false;
        }
        
        // Save navigation state
        this.saveNavigationState(page);
        
        // Navigate
        window.location.href = page;
        return true;
    },
    
    /**
     * Save navigation state for next page
     */
    saveNavigationState(targetPage) {
        // Save the source page for the target page to check flow
        localStorage.setItem('lastSourcePage', this.currentPage);
        
        // Save any data needed for the target page
        if (targetPage === 'exam-room.html') {
            // Ensure exam configuration exists
            const examConfig = localStorage.getItem('examConfiguration');
            if (!examConfig) {
                console.warn('No exam configuration found, creating default');
                localStorage.setItem('examConfiguration', JSON.stringify({
                    examMode: 'timed',
                    questionCount: 25,
                    difficulty: 'mixed',
                    timerMode: 'adaptive'
                }));
            }
        }
    },
    
    /**
     * Set up navigation event listeners
     */
    setupNavigationListeners() {
        // Intercept all link clicks
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (link && link.href) {
                e.preventDefault();
                
                const href = link.getAttribute('href');
                const target = link.getAttribute('target');
                
                // Handle external links
                if (href.startsWith('http') || href.startsWith('//') || target === '_blank') {
                    window.open(href, target);
                    return;
                }
                
                // Handle internal navigation
                this.navigateTo(href);
            }
        });
        
        // Intercept form submissions that navigate
        document.addEventListener('submit', (e) => {
            const form = e.target;
            const action = form.getAttribute('action');
            
            if (action && action.endsWith('.html')) {
                e.preventDefault();
                
                // Validate form first
                if (form.checkValidity()) {
                    this.navigateTo(action);
                } else {
                    form.reportValidity();
                }
            }
        });
        
        // Handle back/forward browser navigation
        window.addEventListener('popstate', () => {
            this.checkPageAccess();
        });
    },
    
    /**
     * Check for time manipulation
     */
    checkTimeManipulation() {
        const lastTimeCheck = parseInt(localStorage.getItem('lastTimeCheck') || Date.now());
        const currentTime = Date.now();
        const timeDiff = Math.abs(currentTime - lastTimeCheck);
        
        // If time difference is more than 5 minutes (300,000 ms) and user is offline,
        // it might indicate time manipulation
        if (timeDiff > 300000 && !navigator.onLine) {
            console.warn('Possible time manipulation detected:', {
                lastCheck: new Date(lastTimeCheck).toLocaleString(),
                currentTime: new Date(currentTime).toLocaleString(),
                difference: Math.round(timeDiff / 1000) + ' seconds'
            });
            
            // If difference is more than 1 hour, lock account
            if (timeDiff > 3600000) {
                this.lockAccount('Time manipulation detected');
            }
        }
        
        // Update last time check
        localStorage.setItem('lastTimeCheck', currentTime.toString());
    },
    
    /**
     * Start security monitoring
     */
    startSecurityMonitoring() {
        // Monitor online/offline status
        window.addEventListener('online', () => {
            this.handleOnlineStatus();
        });
        
        window.addEventListener('offline', () => {
            this.handleOfflineStatus();
        });
        
        // Monitor visibility changes (tab switching)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.currentPage === 'exam-room.html') {
                this.handleTabSwitch();
            }
        });
        
        // Monitor beforeunload for exam in progress
        window.addEventListener('beforeunload', (e) => {
            if (this.currentPage === 'exam-room.html') {
                const examProgress = localStorage.getItem('examInProgress');
                if (examProgress === 'true') {
                    e.preventDefault();
                    e.returnValue = 'You have an exam in progress. Are you sure you want to leave?';
                }
            }
        });
    },
    
    /**
     * Handle online status
     */
    handleOnlineStatus() {
        console.log('Device is online');
        
        // Sync data if needed
        this.syncData();
        
        // Validate subscription with server
        this.validateSubscription();
        
        // Check for time sync
        this.syncTimeWithServer();
    },
    
    /**
     * Handle offline status
     */
    handleOfflineStatus() {
        console.log('Device is offline');
        
        // Check if user can continue in offline mode
        if (this.currentPage === 'exam-room.html') {
            // Allow exam to continue offline
            console.log('Exam can continue offline');
        } else if (this.subscriptionState.isActive) {
            // Allow access to most features offline
            console.log('Subscription active, offline access allowed');
        } else {
            // Limited offline access
            console.log('Limited offline access');
        }
    },
    
    /**
     * Handle tab switching during exam
     */
    handleTabSwitch() {
        if (this.currentPage === 'exam-room.html') {
            // Log tab switch event
            const examId = localStorage.getItem('currentExamId');
            console.warn(`Tab switched during exam: ${examId}`);
            
            // In strict mode, could pause or end the exam
            const examConfig = JSON.parse(localStorage.getItem('examConfiguration') || '{}');
            if (examConfig.pauseDetection) {
                // Show warning or pause exam
                this.showTabSwitchWarning();
            }
        }
    },
    
    /**
     * Show tab switch warning
     */
    showTabSwitchWarning() {
        if (document.hidden) return;
        
        const warning = document.createElement('div');
        warning.className = 'tab-switch-warning';
        warning.innerHTML = `
            <div class="warning-content">
                <div class="warning-icon">⚠️</div>
                <div class="warning-text">
                    <h4>Exam Interrupted</h4>
                    <p>Switching tabs during exams is not allowed. Continued violations may result in exam termination.</p>
                </div>
                <button class="warning-close">OK</button>
            </div>
        `;
        
        warning.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 15px;
            max-width: 400px;
            z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        
        document.body.appendChild(warning);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (warning.parentNode) {
                warning.remove();
            }
        }, 5000);
        
        // Close button
        warning.querySelector('.warning-close').addEventListener('click', () => {
            warning.remove();
        });
    },
    
    /**
     * Sync data with server
     */
    async syncData() {
        if (!this.userState.isAuthenticated) return;
        
        try {
            // Check for pending sync data
            const pendingSync = localStorage.getItem('pendingSync');
            if (pendingSync) {
                console.log('Syncing pending data...');
                
                // In a real app, this would send data to the server
                // For now, just clear pending sync
                localStorage.removeItem('pendingSync');
                
                // Update last sync time
                localStorage.setItem('lastSyncTime', new Date().toISOString());
            }
        } catch (error) {
            console.error('Sync failed:', error);
        }
    },
    
    /**
     * Validate subscription with server
     */
    async validateSubscription() {
        if (!this.userState.isAuthenticated || !this.subscriptionState.hasSubscription) return;
        
        try {
            // In a real app, this would call an API endpoint
            // For now, just update local state
            console.log('Validating subscription...');
            
            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Update subscription state
            this.loadSubscriptionState();
            
        } catch (error) {
            console.error('Subscription validation failed:', error);
        }
    },
    
    /**
     * Sync time with server
     */
    async syncTimeWithServer() {
        try {
            // In a real app, this would get time from server
            // For now, use local time but log it
            const serverTime = Date.now(); // This would come from API
            const clientTime = Date.now();
            const timeDiff = Math.abs(serverTime - clientTime);
            
            if (timeDiff > 300000) { // 5 minutes
                console.warn('Time discrepancy detected:', {
                    serverTime: new Date(serverTime).toLocaleString(),
                    clientTime: new Date(clientTime).toLocaleString(),
                    difference: Math.round(timeDiff / 1000) + ' seconds'
                });
                
                // If difference is too large, suspect cheating
                if (timeDiff > 3600000) { // 1 hour
                    this.lockAccount('Time synchronization failure');
                }
            }
            
            // Update last sync time
            localStorage.setItem('lastTimeSync', clientTime.toString());
            
        } catch (error) {
            console.error('Time sync failed:', error);
        }
    },
    
    /**
     * Lock account for security violation
     */
    lockAccount(reason = 'Security violation') {
        this.securityState.isLocked = true;
        this.securityState.lockReason = reason;
        this.securityState.lockTime = new Date().toISOString();
        
        localStorage.setItem('accountLocked', 'true');
        localStorage.setItem('lockReason', reason);
        localStorage.setItem('lockTime', this.securityState.lockTime);
        localStorage.setItem('lockId', 'LOCK_' + Date.now());
        
        console.error(`Account locked: ${reason}`);
        
        // Redirect to locked page if not already there
        if (this.currentPage !== 'locked.html') {
            this.redirectToLocked();
        }
    },
    
    /**
     * Unlock account
     */
    unlockAccount() {
        this.securityState.isLocked = false;
        this.securityState.lockReason = null;
        this.securityState.lockTime = null;
        
        localStorage.removeItem('accountLocked');
        localStorage.removeItem('lockReason');
        localStorage.removeItem('lockTime');
        localStorage.removeItem('lockId');
        
        console.log('Account unlocked');
    },
    
    /**
     * Redirect to login page
     */
    redirectToLogin() {
        if (this.currentPage !== 'login.html') {
            window.location.href = 'login.html';
        }
    },
    
    /**
     * Redirect to subscription page
     */
    redirectToSubscription() {
        if (this.currentPage !== 'subscription.html') {
            window.location.href = 'subscription.html';
        }
    },
    
    /**
     * Redirect to locked page
     */
    redirectToLocked() {
        if (this.currentPage !== 'locked.html') {
            window.location.href = 'locked.html';
        }
    },
    
    /**
     * Apply saved theme
     */
    applyTheme() {
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    },
    
    /**
     * Get subscription status for display
     */
    getSubscriptionStatus() {
        if (!this.subscriptionState.hasSubscription) {
            return {
                text: 'No Subscription',
                icon: '❌',
                color: '#f44336',
                action: 'Subscribe'
            };
        }
        
        if (this.subscriptionState.isActive) {
            if (this.subscriptionState.isTrial) {
                const hours = Math.floor(this.subscriptionState.timeRemaining / (1000 * 60 * 60));
                const minutes = Math.floor((this.subscriptionState.timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
                
                return {
                    text: `Trial: ${hours}h ${minutes}m remaining`,
                    icon: '⏳',
                    color: '#ff9800',
                    action: 'Upgrade'
                };
            } else {
                const expiryDate = new Date(this.subscriptionState.expiryDate);
                const days = Math.ceil((expiryDate - new Date()) / (1000 * 60 * 60 * 24));
                
                return {
                    text: `${this.subscriptionState.plan} (${days} days left)`,
                    icon: '✅',
                    color: '#4caf50',
                    action: 'Manage'
                };
            }
        } else {
            return {
                text: 'Subscription Expired',
                icon: '⚠️',
                color: '#ff9800',
                action: 'Renew'
            };
        }
    },
    
    /**
     * Get user display name
     */
    getUserDisplayName() {
        if (this.userState.userData) {
            return `${this.userState.userData.firstName || ''} ${this.userState.userData.lastName || ''}`.trim() || 
                   this.userState.userData.email || 'User';
        }
        return 'Guest';
    },
    
    /**
     * Log user activity
     */
    logActivity(action, details = {}) {
        const activity = {
            timestamp: new Date().toISOString(),
            page: this.currentPage,
            user: this.userState.userData?.email || 'guest',
            action: action,
            details: details
        };
        
        // Get existing logs
        const logs = JSON.parse(localStorage.getItem('activityLogs') || '[]');
        
        // Add new log
        logs.push(activity);
        
        // Keep only last 100 logs
        if (logs.length > 100) {
            logs.splice(0, logs.length - 100);
        }
        
        // Save logs
        localStorage.setItem('activityLogs', JSON.stringify(logs));
        
        console.log('Activity logged:', activity);
    },
    
    /**
     * Check if exam is in progress
     */
    isExamInProgress() {
        return localStorage.getItem('examInProgress') === 'true';
    },
    
    /**
     * Start exam session
     */
    startExamSession(examId) {
        localStorage.setItem('examInProgress', 'true');
        localStorage.setItem('currentExamId', examId);
        localStorage.setItem('examStartTime', Date.now().toString());
        
        this.logActivity('exam_started', { examId: examId });
    },
    
    /**
     * End exam session
     */
    endExamSession(examId, results) {
        localStorage.removeItem('examInProgress');
        localStorage.removeItem('currentExamId');
        localStorage.removeItem('examStartTime');
        
        this.logActivity('exam_completed', { 
            examId: examId,
            score: results?.score,
            questions: results?.totalQuestions
        });
    },
    
    /**
     * Force logout user
     */
    forceLogout() {
        // Clear authentication data
        localStorage.removeItem('accessToken');
        localStorage.removeItem('userData');
        localStorage.removeItem('tokenExpiry');
        
        // Clear exam session if any
        localStorage.removeItem('examInProgress');
        localStorage.removeItem('currentExamId');
        localStorage.removeItem('examStartTime');
        
        // Update state
        this.loadUserState();
        
        // Redirect to login
        this.redirectToLogin();
    },
    
    /**
     * Check device compatibility
     */
    checkDeviceCompatibility() {
        const issues = [];
        
        // Check for required features
        if (!('indexedDB' in window)) {
            issues.push('IndexedDB not supported - Offline functionality limited');
        }
        
        if (!('serviceWorker' in navigator)) {
            issues.push('Service Workers not supported - PWA features limited');
        }
        
        if (!('localStorage' in window)) {
            issues.push('LocalStorage not supported - Data cannot be saved');
        }
        
        // Check screen size
        if (window.innerWidth < 320) {
            issues.push('Screen too small - Minimum 320px width required');
        }
        
        // Check browser
        const isChrome = /Chrome/.test(navigator.userAgent);
        const isSafari = /Safari/.test(navigator.userAgent);
        const isFirefox = /Firefox/.test(navigator.userAgent);
        const isEdge = /Edg/.test(navigator.userAgent);
        
        if (!isChrome && !isSafari && !isFirefox && !isEdge) {
            issues.push('Unsupported browser - Use Chrome, Safari, Firefox, or Edge');
        }
        
        return issues;
    },
    
    /**
     * Show compatibility warning if needed
     */
    showCompatibilityWarning() {
        const issues = this.checkDeviceCompatibility();
        
        if (issues.length > 0 && !localStorage.getItem('compatibilityWarningShown')) {
            const warning = document.createElement('div');
            warning.className = 'compatibility-warning';
            warning.innerHTML = `
                <div class="warning-content">
                    <div class="warning-icon">⚠️</div>
                    <div class="warning-text">
                        <h4>Compatibility Notice</h4>
                        <ul>
                            ${issues.map(issue => `<li>${issue}</li>`).join('')}
                        </ul>
                        <p>Some features may not work properly.</p>
                    </div>
                    <div class="warning-actions">
                        <button class="warning-close">Continue Anyway</button>
                        <button class="warning-dismiss">Don't Show Again</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(warning);
            
            // Style the warning
            warning.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: #fff3cd;
                border-bottom: 1px solid #ffeaa7;
                padding: 15px;
                z-index: 9999;
                max-height: 50vh;
                overflow-y: auto;
            `;
            
            // Add event listeners
            warning.querySelector('.warning-close').addEventListener('click', () => {
                warning.remove();
            });
            
            warning.querySelector('.warning-dismiss').addEventListener('click', () => {
                warning.remove();
                localStorage.setItem('compatibilityWarningShown', 'true');
            });
        }
    }
};

// Initialize router when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Router.init());
} else {
    Router.init();
}

// Show compatibility warning
Router.showCompatibilityWarning();

// Export for use in other scripts
window.MedicalExamRouter = Router;
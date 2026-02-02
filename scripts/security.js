// security.js - Security & Anti-Cheating System for Medical Exam Room Pro
// Blueprint Reference: Frontend User App Implementation - File #10
// MODIFIED: DevTools detection DISABLED for development

/**
 * Security System for Medical Exam Room Pro
 * Implements anti-cheating measures, device fingerprinting, and security monitoring
 * DEV MODE: DevTools detection disabled for development
 */

class SecuritySystem {
    constructor(config = {}) {
        this.config = {
            // Anti-cheating settings
            timeManipulationTolerance: 300000, // 5 minutes in milliseconds
            maxTimeRollback: -60000, // -1 minute (negative means going back in time)
            checkInterval: 30000, // Check every 30 seconds
            syncInterval: 60000, // Sync with server every minute
            
            // Device fingerprinting
            fingerprintComponents: [
                'userAgent',
                'language',
                'platform',
                'screenResolution',
                'timezone',
                'hardwareConcurrency',
                'deviceMemory',
                'localStorage',
                'sessionStorage',
                'indexedDB'
            ],
            
            // Storage encryption
            encryptionKey: 'medical_exam_secret_key_2024',
            encryptionAlgorithm: 'AES-GCM',
            
            // Security monitoring
            logSecurityEvents: true,
            alertThreshold: 10, // INCREASED: Number of violations before alert (from 3)
            autoLockOnCheating: false, // DISABLED: Don't auto-lock on cheating
            
            // API endpoints
            securityEndpoint: 'https://medicalexamroom.onrender.com/api/v1/security',
            syncEndpoint: 'https://medicalexamroom.onrender.com/api/v1/sync',
            
            // Callbacks
            onSecurityViolation: null,
            onAccountLock: null,
            onDeviceChange: null,
            onTimeManipulation: null,
            
            ...config
        };
        
        this.state = {
            deviceFingerprint: null,
            lastServerTime: null,
            lastLocalTime: null,
            timeOffset: 0,
            violationCount: 0,
            isLocked: false,
            lockReason: null,
            securityLog: [],
            sessionStart: Date.now(),
            lastSync: null,
            isOnline: navigator.onLine
        };
        
        this.init();
    }
    
    /**
     * Initialize security system
     */
    async init() {
        try {
            // Generate device fingerprint
            await this.generateDeviceFingerprint();
            
            // Load security state
            this.loadSecurityState();
            
            // Start security monitoring (with modified checks)
            this.startMonitoring();
            
            // Setup event listeners (without strict DevTools detection)
            this.setupEventListeners();
            
            // Initial security check
            this.performSecurityCheck();
            
            this.logSecurityEvent('system_initialized', {
                deviceId: this.state.deviceFingerprint?.substring(0, 12),
                devMode: true,
                message: 'Security system running in DEVELOPMENT mode'
            });
            
        } catch (error) {
            console.error('Security system initialization failed:', error);
            this.logSecurityEvent('init_failed', { error: error.message });
        }
    }
    
    /**
     * Generate unique device fingerprint
     */
    async generateDeviceFingerprint() {
        try {
            const components = {};
            
            // Collect fingerprint components
            components.userAgent = navigator.userAgent;
            components.language = navigator.language;
            components.platform = navigator.platform;
            components.screenResolution = `${screen.width}x${screen.height}`;
            components.timezone = new Date().getTimezoneOffset();
            components.hardwareConcurrency = navigator.hardwareConcurrency || 'unknown';
            components.deviceMemory = navigator.deviceMemory || 'unknown';
            components.maxTouchPoints = navigator.maxTouchPoints || 'unknown';
            components.pdfViewerEnabled = navigator.pdfViewerEnabled || 'unknown';
            
            // Browser features
            components.hasLocalStorage = !!window.localStorage;
            components.hasSessionStorage = !!window.sessionStorage;
            components.hasIndexedDB = !!window.indexedDB;
            components.hasServiceWorker = 'serviceWorker' in navigator;
            components.hasWebGL = this.detectWebGL();
            
            // Canvas fingerprint (for additional uniqueness)
            components.canvasFingerprint = await this.generateCanvasFingerprint();
            
            // Audio fingerprint
            components.audioFingerprint = await this.generateAudioFingerprint();
            
            // Timezone and locale
            components.locale = Intl.DateTimeFormat().resolvedOptions().locale;
            components.timezoneName = Intl.DateTimeFormat().resolvedOptions().timeZone;
            
            // Generate hash from components
            const fingerprintString = JSON.stringify(components);
            const fingerprintHash = await this.hashString(fingerprintString);
            
            this.state.deviceFingerprint = `device_${fingerprintHash.substring(0, 16)}`;
            
            // Store in localStorage
            localStorage.setItem('deviceFingerprint', this.state.deviceFingerprint);
            localStorage.setItem('fingerprintComponents', JSON.stringify(components));
            
            this.logSecurityEvent('fingerprint_generated', {
                deviceId: this.state.deviceFingerprint
            });
            
            return this.state.deviceFingerprint;
            
        } catch (error) {
            console.error('Failed to generate device fingerprint:', error);
            
            // Fallback to simpler fingerprint
            const fallbackComponents = [
                navigator.userAgent,
                navigator.platform,
                screen.width + 'x' + screen.height,
                new Date().getTimezoneOffset()
            ].join('|');
            
            const fallbackHash = await this.hashString(fallbackComponents);
            this.state.deviceFingerprint = `device_fallback_${fallbackHash.substring(0, 12)}`;
            
            localStorage.setItem('deviceFingerprint', this.state.deviceFingerprint);
            
            return this.state.deviceFingerprint;
        }
    }
    
    /**
     * Generate canvas fingerprint
     */
    async generateCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = 200;
            canvas.height = 50;
            
            // Draw text
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('Medical Exam Room Pro', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('Security Fingerprint', 4, 30);
            
            // Get image data
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            
            // Create hash from image data
            let hash = 0;
            for (let i = 0; i < Math.min(imageData.length, 1000); i++) {
                hash = ((hash << 5) - hash) + imageData[i];
                hash = hash & hash;
            }
            
            return hash.toString(16);
            
        } catch (error) {
            return 'canvas_unavailable';
        }
    }
    
    /**
     * Generate audio fingerprint
     */
    async generateAudioFingerprint() {
        try {
            if (!window.AudioContext && !window.webkitAudioContext) {
                return 'audio_unavailable';
            }
            
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContext();
            
            // Create oscillator
            const oscillator = audioContext.createOscillator();
            const analyser = audioContext.createAnalyser();
            
            oscillator.connect(analyser);
            analyser.connect(audioContext.destination);
            
            oscillator.type = 'triangle';
            oscillator.frequency.value = 1000;
            
            // Start and stop quickly
            oscillator.start();
            await new Promise(resolve => setTimeout(resolve, 100));
            oscillator.stop();
            
            // Get frequency data
            const frequencyData = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(frequencyData);
            
            // Close audio context
            await audioContext.close();
            
            // Create hash from frequency data
            let hash = 0;
            for (let i = 0; i < Math.min(frequencyData.length, 100); i++) {
                hash = ((hash << 5) - hash) + frequencyData[i];
                hash = hash & hash;
            }
            
            return hash.toString(16);
            
        } catch (error) {
            return 'audio_error';
        }
    }
    
    /**
     * Detect WebGL support
     */
    detectWebGL() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            return !!gl;
        } catch (e) {
            return false;
        }
    }
    
    /**
     * Hash a string using SHA-256
     */
    async hashString(str) {
        try {
            // Use Web Crypto API if available
            if (window.crypto && window.crypto.subtle) {
                const encoder = new TextEncoder();
                const data = encoder.encode(str);
                const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (error) {
            // Fallback to simple hash
        }
        
        // Simple hash fallback
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }
    
    /**
     * Load security state from storage
     */
    loadSecurityState() {
        try {
            // Load device fingerprint
            const storedFingerprint = localStorage.getItem('deviceFingerprint');
            if (storedFingerprint) {
                this.state.deviceFingerprint = storedFingerprint;
            }
            
            // Load security logs
            const storedLogs = localStorage.getItem('securityLogs');
            if (storedLogs) {
                this.state.securityLog = JSON.parse(storedLogs).slice(-100); // Keep last 100 logs
            }
            
            // Load violation count
            const storedViolations = localStorage.getItem('violationCount');
            if (storedViolations) {
                this.state.violationCount = parseInt(storedViolations);
            }
            
            // Check if account is locked
            const lockStatus = localStorage.getItem('accountLocked');
            if (lockStatus === 'true') {
                this.state.isLocked = true;
                this.state.lockReason = localStorage.getItem('lockReason');
            }
            
            // Load last sync time
            const lastSync = localStorage.getItem('lastSecuritySync');
            if (lastSync) {
                this.state.lastSync = parseInt(lastSync);
            }
            
        } catch (error) {
            console.warn('Failed to load security state:', error);
        }
    }
    
    /**
     * Save security state to storage
     */
    saveSecurityState() {
        try {
            localStorage.setItem('deviceFingerprint', this.state.deviceFingerprint);
            localStorage.setItem('securityLogs', JSON.stringify(this.state.securityLog.slice(-100)));
            localStorage.setItem('violationCount', this.state.violationCount.toString());
            localStorage.setItem('accountLocked', this.state.isLocked.toString());
            
            if (this.state.lockReason) {
                localStorage.setItem('lockReason', this.state.lockReason);
            }
            
            if (this.state.lastSync) {
                localStorage.setItem('lastSecuritySync', this.state.lastSync.toString());
            }
            
        } catch (error) {
            console.warn('Failed to save security state:', error);
        }
    }
    
    /**
     * Setup event listeners for security monitoring
     */
    setupEventListeners() {
        // Online/offline detection
        window.addEventListener('online', () => {
            this.state.isOnline = true;
            this.logSecurityEvent('network_online');
            this.syncWithServer();
        });
        
        window.addEventListener('offline', () => {
            this.state.isOnline = false;
            this.logSecurityEvent('network_offline');
        });
        
        // Visibility change (tab switching) - MONITOR BUT DON'T LOCK
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.logSecurityEvent('tab_switched', {
                    timestamp: Date.now(),
                    visibilityState: document.visibilityState
                });
            }
        });
        
        // Window blur/focus - MONITOR ONLY
        window.addEventListener('blur', () => {
            this.logSecurityEvent('window_blurred', {
                timestamp: Date.now()
            });
        });
        
        window.addEventListener('focus', () => {
            this.logSecurityEvent('window_focused', {
                timestamp: Date.now(),
                timeSinceBlur: Date.now() - parseInt(localStorage.getItem('lastBlurTime') || Date.now())
            });
        });
        
        // DEV MODE: Skip DevTools detection entirely
        console.log('🔓 DEV MODE: DevTools detection DISABLED');
        
        // Beforeunload (user leaving)
        window.addEventListener('beforeunload', (e) => {
            this.handleBeforeUnload(e);
        });
        
        // Resize (potential screen sharing detection)
        window.addEventListener('resize', () => {
            this.logSecurityEvent('window_resized', {
                width: window.innerWidth,
                height: window.innerHeight
            });
        });
    }
    
    /**
     * Setup DevTools detection - DISABLED FOR DEVELOPMENT
     */
    setupDevToolsDetection() {
        // COMPLETELY DISABLED - Only log for monitoring
        console.log('🔓 DEV MODE: DevTools detection bypassed - safe to use console');
        
        // Still log console usage for debugging (but don't count as violation)
        const originalConsoleLog = console.log;
        const originalConsoleError = console.error;
        const originalConsoleWarn = console.warn;
        
        // Monitor but don't penalize
        console.log = function(...args) {
            this.logSecurityEvent('console_usage', {
                type: 'log',
                argsCount: args.length,
                firstArg: typeof args[0]
            });
            originalConsoleLog.apply(console, args);
        }.bind(this);
        
        console.error = function(...args) {
            this.logSecurityEvent('console_usage', {
                type: 'error',
                argsCount: args.length
            });
            originalConsoleError.apply(console, args);
        }.bind(this);
        
        console.warn = function(...args) {
            this.logSecurityEvent('console_usage', {
                type: 'warn',
                argsCount: args.length
            });
            originalConsoleWarn.apply(console, args);
        }.bind(this);
    }
    
    /**
     * Start security monitoring intervals
     */
    startMonitoring() {
        // Time validation check
        this.timeCheckInterval = setInterval(() => {
            this.performSecurityCheck();
        }, this.config.checkInterval);
        
        // Sync with server
        this.syncInterval = setInterval(() => {
            if (this.state.isOnline) {
                this.syncWithServer();
            }
        }, this.config.syncInterval);
        
        // Periodic fingerprint verification
        this.fingerprintCheckInterval = setInterval(async () => {
            await this.verifyDeviceFingerprint();
        }, 300000); // Every 5 minutes
        
        console.log('🔓 DEV MODE: Security monitoring started (reduced restrictions)');
    }
    
    /**
     * Perform comprehensive security check
     */
    async performSecurityCheck() {
        const checks = [
            this.checkTimeManipulation(),
            this.checkDeviceConsistency(),
            this.checkStorageTampering(),
            this.checkEnvironment()
        ];
        
        const results = await Promise.allSettled(checks);
        
        let violations = [];
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value?.isViolation) {
                violations.push({
                    check: ['time', 'device', 'storage', 'environment'][index],
                    ...result.value
                });
            }
        });
        
        if (violations.length > 0) {
            this.handleSecurityViolations(violations);
        }
        
        return { violations, timestamp: Date.now() };
    }
    
    /**
     * Check for time manipulation
     */
    async checkTimeManipulation() {
        try {
            const currentTime = Date.now();
            const storedTime = parseInt(localStorage.getItem('lastTimeCheck') || currentTime);
            
            // Calculate time difference
            const timeDiff = currentTime - storedTime;
            const expectedDiff = this.config.checkInterval; // Expected time since last check
            
            // Check for significant deviation
            const deviation = Math.abs(timeDiff - expectedDiff);
            const isViolation = deviation > this.config.timeManipulationTolerance;
            
            // Check for time rollback
            const isRollback = timeDiff < this.config.maxTimeRollback;
            
            // Store current time for next check
            localStorage.setItem('lastTimeCheck', currentTime.toString());
            
            // Get server time if online
            let serverTime = null;
            if (this.state.isOnline) {
                serverTime = await this.getServerTime();
            }
            
            const result = {
                isViolation: isViolation || isRollback,
                deviation,
                expectedDiff,
                actualDiff: timeDiff,
                isRollback,
                serverTime,
                localTime: currentTime
            };
            
            if (isViolation || isRollback) {
                this.logSecurityEvent('time_manipulation_detected', result);
                console.warn('⚠️ Time manipulation detected (logged but not penalized):', result);
            }
            
            return result;
            
        } catch (error) {
            this.logSecurityEvent('time_check_failed', { error: error.message });
            return { isViolation: false, error: error.message };
        }
    }
    
    /**
     * Check device consistency
     */
    async checkDeviceConsistency() {
        try {
            const originalFingerprint = this.state.deviceFingerprint;
            const currentFingerprint = await this.generateDeviceFingerprint();
            
            const isViolation = originalFingerprint !== currentFingerprint;
            
            const result = {
                isViolation,
                originalFingerprint: originalFingerprint?.substring(0, 12),
                currentFingerprint: currentFingerprint?.substring(0, 12),
                match: !isViolation
            };
            
            if (isViolation) {
                this.logSecurityEvent('device_fingerprint_changed', result);
                console.warn('⚠️ Device fingerprint changed (logged but not penalized):', result);
            }
            
            return result;
            
        } catch (error) {
            return { isViolation: false, error: error.message };
        }
    }
    
    /**
     * Check for storage tampering
     */
    checkStorageTampering() {
        try {
            // Check subscription expiry encryption
            const encryptedExpiry = localStorage.getItem('subscriptionExpiry');
            const isTampered = this.isStorageTampered();
            
            // Check for forced values
            const forcedSubscription = localStorage.getItem('forceSubscription');
            const isForced = forcedSubscription === 'true';
            
            const result = {
                isViolation: isTampered || isForced,
                isTampered,
                isForced,
                hasEncryptedExpiry: !!encryptedExpiry
            };
            
            if (isTampered || isForced) {
                this.logSecurityEvent('storage_tampering_detected', result);
                console.warn('⚠️ Storage tampering detected (logged but not penalized):', result);
            }
            
            return result;
            
        } catch (error) {
            return { isViolation: false, error: error.message };
        }
    }
    
    /**
     * Check environment for suspicious activity
     */
    checkEnvironment() {
        const checks = {
            // Check if running in iframe (could be embedded maliciously)
            isInIframe: window.self !== window.top,
            
            // Check for automation tools - LOG BUT DON'T PENALIZE
            hasWebDriver: navigator.webdriver || false,
            
            // Check for headless browser indicators
            hasChrome: !!window.chrome,
            hasPermissions: !!navigator.permissions,
            
            // Check for common bot/automation indicators
            pluginsLength: navigator.plugins?.length || 0,
            languagesLength: navigator.languages?.length || 0
        };
        
        // Determine if any indicators suggest automation
        const isSuspicious = checks.isInIframe || 
                            checks.hasWebDriver || 
                            checks.pluginsLength === 0;
        
        const result = {
            isViolation: false, // ALWAYS FALSE IN DEV MODE
            ...checks
        };
        
        if (isSuspicious) {
            this.logSecurityEvent('suspicious_environment', result);
            console.warn('⚠️ Suspicious environment detected (logged but not penalized):', result);
        }
        
        return result;
    }
    
    /**
     * Verify device fingerprint
     */
    async verifyDeviceFingerprint() {
        try {
            const storedComponents = JSON.parse(localStorage.getItem('fingerprintComponents') || '{}');
            const currentComponents = {};
            
            // Check key components
            currentComponents.userAgent = navigator.userAgent;
            currentComponents.screenResolution = `${screen.width}x${screen.height}`;
            currentComponents.timezone = new Date().getTimezoneOffset();
            
            let mismatchCount = 0;
            const mismatches = [];
            
            for (const key in storedComponents) {
                if (currentComponents[key] !== undefined && 
                    storedComponents[key] !== currentComponents[key]) {
                    mismatchCount++;
                    mismatches.push({ key, stored: storedComponents[key], current: currentComponents[key] });
                }
            }
            
            const isViolation = mismatchCount > 2; // Allow minor changes
            
            if (isViolation) {
                this.logSecurityEvent('fingerprint_mismatch', {
                    mismatchCount,
                    mismatches,
                    isViolation
                });
                console.warn('⚠️ Fingerprint mismatch (logged but not penalized):', { mismatchCount, mismatches });
            }
            
            return { isViolation, mismatchCount, mismatches };
            
        } catch (error) {
            return { isViolation: false, error: error.message };
        }
    }
    
    /**
     * Check if storage has been tampered with
     */
    isStorageTampered() {
        try {
            // Check subscription data
            const subscription = JSON.parse(localStorage.getItem('subscription') || '{}');
            
            // Verify expiry date is encrypted or properly formatted
            if (subscription.expiryDate) {
                const expiry = new Date(subscription.expiryDate);
                const now = new Date();
                
                // Check for impossibly far future dates
                if (expiry > new Date(now.getFullYear() + 10, 0, 1)) {
                    return true;
                }
                
                // Check for past dates that claim to be active
                if (expiry < now && subscription.isActive === true) {
                    return true;
                }
            }
            
            // Check for manual override flags
            if (localStorage.getItem('bypassSubscription') === 'true') {
                return true;
            }
            
            // Check for multiple device fingerprints
            const fingerprints = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith('deviceFingerprint')) {
                    fingerprints.push(localStorage.getItem(key));
                }
            }
            
            if (fingerprints.length > 1) {
                return true;
            }
            
            return false;
            
        } catch (error) {
            return false; // In dev mode, assume not tampered
        }
    }
    
    /**
     * Handle security violations - MODIFIED FOR DEV MODE
     */
    handleSecurityViolations(violations) {
        // In DEV MODE: Only log violations, don't lock account
        this.state.violationCount += violations.length;
        
        // Log each violation with DEV MODE warning
        violations.forEach(violation => {
            this.logSecurityEvent('security_violation_dev_mode', {
                ...violation,
                devMode: true,
                action: 'logged_only'
            });
            console.warn('🔓 DEV MODE VIOLATION (not penalized):', violation);
        });
        
        // DEV MODE: Don't lock account, just warn
        if (this.state.violationCount >= this.config.alertThreshold) {
            console.warn(`🔓 DEV MODE: Would lock account for ${this.state.violationCount} violations`);
            this.logSecurityEvent('would_lock_account_dev_mode', {
                violationCount: this.state.violationCount,
                threshold: this.config.alertThreshold,
                action: 'skipped_in_dev_mode'
            });
        }
        
        // Call violation callback if exists
        if (typeof this.config.onSecurityViolation === 'function') {
            this.config.onSecurityViolation(violations, this.state.violationCount);
        }
        
        // Save updated state
        this.saveSecurityState();
    }
    
    /**
     * Lock the account - MODIFIED FOR DEV MODE
     */
    lockAccount(reason = 'security_violation') {
        // In DEV MODE: Only simulate locking
        console.warn(`🔓 DEV MODE: Would lock account for: ${reason}`);
        
        this.logSecurityEvent('account_lock_simulated_dev_mode', { 
            reason,
            simulated: true,
            devMode: true
        });
        
        // Don't actually lock in dev mode
        return false;
    }
    
    /**
     * Unlock the account
     */
    unlockAccount() {
        this.state.isLocked = false;
        this.state.lockReason = null;
        this.state.violationCount = 0;
        
        // Remove lock from localStorage
        localStorage.removeItem('accountLocked');
        localStorage.removeItem('lockReason');
        localStorage.removeItem('lockTime');
        
        this.logSecurityEvent('account_unlocked');
        this.saveSecurityState();
        
        return true;
    }
    
    /**
     * Handle tab switching - MODIFIED FOR DEV MODE
     */
    handleTabSwitch() {
        this.logSecurityEvent('tab_switched_dev_mode', {
            timestamp: Date.now(),
            visibilityState: document.visibilityState,
            action: 'monitored_only'
        });
        
        // In DEV MODE: Monitor but don't penalize rapid switching
        const lastSwitch = parseInt(localStorage.getItem('lastTabSwitch') || '0');
        const now = Date.now();
        
        if (lastSwitch && now - lastSwitch < 5000) { // Switched twice within 5 seconds
            this.logSecurityEvent('rapid_tab_switching_dev_mode', {
                timeBetweenSwitches: now - lastSwitch,
                action: 'logged_only'
            });
            console.warn('🔓 DEV MODE: Rapid tab switching detected (logged only)');
        }
        
        localStorage.setItem('lastTabSwitch', now.toString());
    }
    
    /**
     * Handle window blur - MODIFIED FOR DEV MODE
     */
    handleWindowBlur() {
        this.logSecurityEvent('window_blurred_dev_mode', {
            timestamp: Date.now(),
            action: 'monitored_only'
        });
    }
    
    /**
     * Handle window focus - MODIFIED FOR DEV MODE
     */
    handleWindowFocus() {
        this.logSecurityEvent('window_focused_dev_mode', {
            timestamp: Date.now(),
            timeSinceBlur: Date.now() - parseInt(localStorage.getItem('lastBlurTime') || Date.now())
        });
    }
    
    /**
     * Handle DevTools opening - MODIFIED FOR DEV MODE
     */
    handleDevToolsOpen() {
        // In DEV MODE: Log but don't penalize
        this.logSecurityEvent('devtools_opened_dev_mode', {
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            action: 'allowed_in_dev_mode'
        });
        
        console.log('🔓 DEV MODE: DevTools usage allowed');
        
        // Don't increment violation count for DevTools usage
        return;
    }
    
    /**
     * Handle before unload
     */
    handleBeforeUnload(event) {
        // Check if user is trying to leave during exam
        const isExamActive = localStorage.getItem('examActive') === 'true';
        
        if (isExamActive) {
            this.logSecurityEvent('page_leave_during_exam', {
                timestamp: Date.now(),
                examId: localStorage.getItem('currentExamId')
            });
            
            // Show warning message
            event.preventDefault();
            event.returnValue = 'Are you sure you want to leave? Your exam progress may be lost.';
            
            return event.returnValue;
        }
    }
    
    /**
     * Encrypt sensitive data
     */
    async encryptData(data, key = this.config.encryptionKey) {
        try {
            const textEncoder = new TextEncoder();
            const dataBuffer = textEncoder.encode(JSON.stringify(data));
            
            // Generate random IV
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            // Import key
            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                textEncoder.encode(key),
                { name: 'AES-GCM' },
                false,
                ['encrypt']
            );
            
            // Encrypt data
            const encryptedBuffer = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                cryptoKey,
                dataBuffer
            );
            
            // Combine IV and encrypted data
            const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(encryptedBuffer), iv.length);
            
            // Convert to base64 for storage
            return btoa(String.fromCharCode.apply(null, combined));
            
        } catch (error) {
            console.error('Encryption failed:', error);
            
            // Fallback to simple obfuscation
            const fallback = JSON.stringify(data);
            return btoa(unescape(encodeURIComponent(fallback)));
        }
    }
    
    /**
     * Decrypt sensitive data
     */
    async decryptData(encryptedData, key = this.config.encryptionKey) {
        try {
            // Convert from base64
            const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
            
            // Extract IV and encrypted data
            const iv = combined.slice(0, 12);
            const encryptedBuffer = combined.slice(12);
            
            // Import key
            const textEncoder = new TextEncoder();
            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                textEncoder.encode(key),
                { name: 'AES-GCM' },
                false,
                ['decrypt']
            );
            
            // Decrypt data
            const decryptedBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                cryptoKey,
                encryptedBuffer
            );
            
            // Convert to string
            const textDecoder = new TextDecoder();
            const decryptedText = textDecoder.decode(decryptedBuffer);
            
            return JSON.parse(decryptedText);
            
        } catch (error) {
            console.error('Decryption failed:', error);
            
            // Try fallback decryption
            try {
                const fallbackText = decodeURIComponent(escape(atob(encryptedData)));
                return JSON.parse(fallbackText);
            } catch (e) {
                throw new Error('Failed to decrypt data');
            }
        }
    }
    
    /**
     * Encrypt subscription expiry date
     */
    async encryptSubscriptionExpiry(expiryDate) {
        const encrypted = await this.encryptData({
            expiry: expiryDate,
            deviceId: this.state.deviceFingerprint,
            timestamp: Date.now()
        });
        
        localStorage.setItem('subscriptionExpiry', encrypted);
        return encrypted;
    }
    
    /**
     * Decrypt and verify subscription expiry
     */
    async verifySubscriptionExpiry() {
        try {
            const encrypted = localStorage.getItem('subscriptionExpiry');
            if (!encrypted) return null;
            
            const decrypted = await this.decryptData(encrypted);
            
            // Verify device matches
            if (decrypted.deviceId !== this.state.deviceFingerprint) {
                this.logSecurityEvent('subscription_device_mismatch', {
                    storedDevice: decrypted.deviceId?.substring(0, 12),
                    currentDevice: this.state.deviceFingerprint?.substring(0, 12)
                });
                return null;
            }
            
            // Check if expiry is valid
            const expiryDate = new Date(decrypted.expiry);
            const now = new Date();
            
            return {
                expiryDate,
                isValid: expiryDate > now,
                daysRemaining: Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
            };
            
        } catch (error) {
            this.logSecurityEvent('subscription_verification_failed', {
                error: error.message
            });
            return null;
        }
    }
    
    /**
     * Get server time for synchronization
     */
    async getServerTime() {
        try {
            if (!this.state.isOnline) return null;
            
            const startTime = Date.now();
            const response = await fetch(`${this.config.securityEndpoint}/time`, {
                method: 'GET',
                headers: {
                    'X-Device-Fingerprint': this.state.deviceFingerprint,
                    'X-Client-Time': Date.now().toString()
                },
                cache: 'no-cache'
            });
            
            const endTime = Date.now();
            const roundTripTime = endTime - startTime;
            
            if (response.ok) {
                const data = await response.json();
                const serverTime = data.serverTime;
                
                // Calculate time offset
                this.state.timeOffset = serverTime - endTime + Math.round(roundTripTime / 2);
                this.state.lastServerTime = serverTime;
                this.state.lastLocalTime = endTime;
                
                this.logSecurityEvent('time_synced', {
                    serverTime,
                    localTime: endTime,
                    offset: this.state.timeOffset,
                    roundTripTime
                });
                
                return serverTime;
            }
            
            return null;
            
        } catch (error) {
            this.logSecurityEvent('time_sync_failed', { error: error.message });
            return null;
        }
    }
    
    /**
     * Sync security data with server
     */
    async syncWithServer() {
        try {
            if (!this.state.isOnline) return;
            
            const syncData = {
                deviceFingerprint: this.state.deviceFingerprint,
                securityLog: this.state.securityLog.slice(-20), // Send last 20 logs
                violationCount: this.state.violationCount,
                isLocked: this.state.isLocked,
                lastSync: this.state.lastSync,
                clientTime: Date.now(),
                devMode: true // Indicate this is from dev mode
            };
            
            const response = await fetch(this.config.syncEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Device-Fingerprint': this.state.deviceFingerprint,
                    'X-Client-Time': Date.now().toString()
                },
                body: JSON.stringify(syncData)
            });
            
            if (response.ok) {
                const result = await response.json();
                
                // Update local state based on server response
                if (result.lockAccount) {
                    console.warn('🔓 DEV MODE: Server requested lock (ignored in dev mode)');
                }
                
                if (result.resetViolations) {
                    this.state.violationCount = 0;
                }
                
                this.state.lastSync = Date.now();
                this.saveSecurityState();
                
                this.logSecurityEvent('sync_completed', {
                    success: true,
                    serverResponse: result
                });
                
                return result;
            }
            
        } catch (error) {
            this.logSecurityEvent('sync_failed', { error: error.message });
        }
    }
    
    /**
     * Log security event
     */
    logSecurityEvent(event, data = {}) {
        const logEntry = {
            timestamp: Date.now(),
            event,
            deviceFingerprint: this.state.deviceFingerprint?.substring(0, 12),
            isOnline: this.state.isOnline,
            isLocked: this.state.isLocked,
            violationCount: this.state.violationCount,
            devMode: true, // Mark all logs as from dev mode
            ...data
        };
        
        // Add to security log
        this.state.securityLog.push(logEntry);
        
        // Keep log size manageable
        if (this.state.securityLog.length > 1000) {
            this.state.securityLog = this.state.securityLog.slice(-500);
        }
        
        // Save to localStorage
        if (this.config.logSecurityEvents) {
            try {
                localStorage.setItem('securityLogs', JSON.stringify(this.state.securityLog.slice(-100)));
            } catch (e) {
                // Storage might be full
            }
        }
        
        // Console log in development (this is safe now)
        console.log(`[Security-DEV] ${event}:`, logEntry);
        
        return logEntry;
    }
    
    /**
     * Get security logs
     */
    getSecurityLogs(limit = 100) {
        return this.state.securityLog.slice(-limit);
    }
    
    /**
     * Clear security logs
     */
    clearSecurityLogs() {
        this.state.securityLog = [];
        localStorage.removeItem('securityLogs');
    }
    
    /**
     * Get security status
     */
    getSecurityStatus() {
        return {
            deviceFingerprint: this.state.deviceFingerprint,
            isLocked: this.state.isLocked,
            lockReason: this.state.lockReason,
            violationCount: this.state.violationCount,
            isOnline: this.state.isOnline,
            lastSync: this.state.lastSync,
            timeOffset: this.state.timeOffset,
            sessionDuration: Date.now() - this.state.sessionStart,
            checksPerformed: this.state.securityLog.length,
            devMode: true, // Indicate dev mode
            restrictions: 'reduced'
        };
    }
    
    /**
     * Check if access is allowed - MODIFIED FOR DEV MODE
     */
    isAccessAllowed() {
        // DEV MODE: Always allow access
        return {
            allowed: true,
            violationCount: this.state.violationCount,
            deviceId: this.state.deviceFingerprint?.substring(0, 12),
            devMode: true,
            message: 'Development mode - all access allowed'
        };
    }
    
    /**
     * Validate exam environment before starting - MODIFIED FOR DEV MODE
     */
    async validateExamEnvironment() {
        const checks = await this.performSecurityCheck();
        
        // DEV MODE: Always return valid
        return {
            valid: true,
            violations: checks.violations,
            deviceId: this.state.deviceFingerprint,
            devMode: true,
            message: 'Development mode - environment validation bypassed',
            timestamp: Date.now()
        };
    }
    
    /**
     * Start exam monitoring - MODIFIED FOR DEV MODE
     */
    startExamMonitoring(examId) {
        // Set exam as active
        localStorage.setItem('examActive', 'true');
        localStorage.setItem('currentExamId', examId);
        localStorage.setItem('examStartTime', Date.now().toString());
        
        // Increase security check frequency during exam (but still dev mode)
        clearInterval(this.timeCheckInterval);
        this.timeCheckInterval = setInterval(() => {
            this.performSecurityCheck();
        }, 10000); // Check every 10 seconds during exam
        
        this.logSecurityEvent('exam_monitoring_started_dev_mode', { 
            examId,
            devMode: true,
            restrictions: 'reduced'
        });
        
        console.log('🔓 DEV MODE: Exam monitoring started (reduced restrictions)');
    }
    
    /**
     * Stop exam monitoring
     */
    stopExamMonitoring() {
        localStorage.removeItem('examActive');
        localStorage.removeItem('currentExamId');
        localStorage.removeItem('examStartTime');
        
        // Restore normal check frequency
        clearInterval(this.timeCheckInterval);
        this.timeCheckInterval = setInterval(() => {
            this.performSecurityCheck();
        }, this.config.checkInterval);
        
        this.logSecurityEvent('exam_monitoring_stopped');
    }
    
    /**
     * Export security data
     */
    exportSecurityData() {
        return {
            config: this.config,
            state: this.state,
            logs: this.getSecurityLogs(),
            exportTime: Date.now(),
            devMode: true
        };
    }
    
    /**
     * Destroy security system
     */
    destroy() {
        clearInterval(this.timeCheckInterval);
        clearInterval(this.syncInterval);
        clearInterval(this.fingerprintCheckInterval);
        
        // Remove event listeners
        window.removeEventListener('online', () => {});
        window.removeEventListener('offline', () => {});
        document.removeEventListener('visibilitychange', () => {});
        window.removeEventListener('blur', () => {});
        window.removeEventListener('focus', () => {});
        window.removeEventListener('beforeunload', () => {});
        window.removeEventListener('resize', () => {});
    }
}

// Utility functions for standalone security operations
const SecurityUtils = {
    /**
     * Generate a simple device fingerprint
     */
    generateSimpleFingerprint() {
        const components = [
            navigator.userAgent,
            navigator.language,
            navigator.platform,
            screen.width + 'x' + screen.height,
            new Date().getTimezoneOffset()
        ].join('|');
        
        let hash = 0;
        for (let i = 0; i < components.length; i++) {
            const char = components.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return 'device_' + Math.abs(hash).toString(16);
    },
    
    /**
     * Check for time manipulation
     */
    checkTimeManipulationSimple() {
        const currentTime = Date.now();
        const storedTime = parseInt(localStorage.getItem('lastSecurityCheck') || currentTime);
        
        // Allow up to 5 minutes deviation
        const timeDiff = Math.abs(currentTime - storedTime);
        const isManipulated = timeDiff > 300000; // 5 minutes
        
        localStorage.setItem('lastSecurityCheck', currentTime.toString());
        
        return {
            isManipulated,
            timeDiff,
            currentTime,
            storedTime
        };
    },
    
    /**
     * Simple data encryption
     */
    simpleEncrypt(data) {
        try {
            const jsonString = JSON.stringify(data);
            const base64 = btoa(unescape(encodeURIComponent(jsonString)));
            
            // Add device identifier
            const deviceId = SecurityUtils.generateSimpleFingerprint().substring(0, 8);
            return `${deviceId}_${base64}`;
            
        } catch (error) {
            console.error('Simple encryption failed:', error);
            return null;
        }
    },
    
    /**
     * Simple data decryption
     */
    simpleDecrypt(encryptedData) {
        try {
            if (!encryptedData) return null;
            
            // Remove device identifier
            const parts = encryptedData.split('_');
            if (parts.length < 2) return null;
            
            const base64 = parts.slice(1).join('_');
            const jsonString = decodeURIComponent(escape(atob(base64)));
            
            return JSON.parse(jsonString);
            
        } catch (error) {
            console.error('Simple decryption failed:', error);
            return null;
        }
    },
    
    /**
     * Validate Kenyan phone number
     */
    validatePhoneNumber(phone) {
        const digits = phone.replace(/\D/g, '');
        
        // Acceptable formats:
        // 254712345678 (12 digits, starts with 254)
        // 0712345678 (10 digits, starts with 07)
        // 712345678 (9 digits, starts with 7)
        
        if (digits.length === 12 && digits.startsWith('254')) {
            return {
                valid: true,
                formatted: digits,
                type: 'international'
            };
        } else if (digits.length === 10 && digits.startsWith('07')) {
            return {
                valid: true,
                formatted: '254' + digits.substring(1),
                type: 'local'
            };
        } else if (digits.length === 9 && digits.startsWith('7')) {
            return {
                valid: true,
                formatted: '254' + digits,
                type: 'local_short'
            };
        }
        
        return {
            valid: false,
            reason: 'Invalid Kenyan phone number format'
        };
    },
    
    /**
     * Validate password strength
     */
    validatePassword(password) {
        const checks = {
            length: password.length >= 8,
            uppercase: /[A-Z]/.test(password),
            lowercase: /[a-z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[^A-Za-z0-9]/.test(password)
        };
        
        const passed = Object.values(checks).filter(Boolean).length;
        let strength = 'weak';
        
        if (passed === 5) strength = 'very_strong';
        else if (passed >= 4) strength = 'strong';
        else if (passed >= 3) strength = 'medium';
        
        return {
            valid: checks.length && checks.uppercase && checks.lowercase && checks.number,
            strength,
            checks,
            score: passed
        };
    },
    
    /**
     * Detect DevTools - MODIFIED FOR DEV MODE
     */
    detectDevTools() {
        // DEV MODE: Always return that DevTools are not open (even if they are)
        return {
            isDevToolsOpen: false, // Always false in dev mode
            detectors: ['dev_mode_bypassed'],
            debuggerTime: 0,
            message: 'DevTools detection disabled in development mode'
        };
    },
    
    /**
     * Prevent copy-paste in exam - MODIFIED FOR DEV MODE
     */
    preventCopyPaste(element) {
        if (!element) return;
        
        // In DEV MODE: Allow copy-paste but log it
        const handlers = {
            copy: (e) => {
                console.log('🔓 DEV MODE: Copy event (allowed)');
                // Don't prevent default
            },
            cut: (e) => {
                console.log('🔓 DEV MODE: Cut event (allowed)');
                // Don't prevent default
            },
            paste: (e) => {
                console.log('🔓 DEV MODE: Paste event (allowed)');
                // Don't prevent default
            },
            contextmenu: (e) => {
                console.log('🔓 DEV MODE: Right-click (allowed)');
                // Don't prevent default
            },
            selectstart: (e) => {
                // Don't prevent default
            }
        };
        
        // Attach handlers
        Object.entries(handlers).forEach(([event, handler]) => {
            element.addEventListener(event, handler);
        });
        
        // Return cleanup function
        return () => {
            Object.entries(handlers).forEach(([event, handler]) => {
                element.removeEventListener(event, handler);
            });
        };
    },
    
    /**
     * Generate security headers for API requests
     */
    generateSecurityHeaders() {
        const deviceId = localStorage.getItem('deviceFingerprint') || 
                        SecurityUtils.generateSimpleFingerprint();
        
        return {
            'X-Device-Fingerprint': deviceId,
            'X-Client-Time': Date.now().toString(),
            'X-Client-Version': '1.0.0',
            'X-Security-Check': 'development_mode' // Indicate dev mode
        };
    }
};

// CSS for security warnings (to be injected)
const SecurityStyles = `
.security-warning {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    background-color: #f8d7da;
    border: 1px solid #f5c6cb;
    border-radius: 4px;
    padding: 15px;
    max-width: 300px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    animation: security-warning-slide 0.3s ease;
}

@keyframes security-warning-slide {
    from {
        transform: translateX(100%);
        opacity: 0;
    }
    to {
        transform: translateX(0);
        opacity: 1;
    }
}

.security-warning-title {
    font-weight: bold;
    color: #721c24;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 8px;
}

.security-warning-message {
    color: #721c24;
    font-size: 14px;
    line-height: 1.4;
}

.security-warning-icon {
    font-size: 18px;
}

.security-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0,0,0,0.8);
    z-index: 10000;
    display: flex;
    justify-content: center;
    align-items: center;
}

.security-modal {
    background-color: white;
    border-radius: 8px;
    padding: 30px;
    max-width: 500px;
    width: 90%;
    text-align: center;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
}

.security-modal-title {
    font-size: 24px;
    font-weight: bold;
    margin-bottom: 15px;
    color: #dc3545;
}

.security-modal-message {
    margin-bottom: 20px;
    line-height: 1.6;
}

.security-modal-contact {
    background-color: #f8f9fa;
    border-radius: 4px;
    padding: 15px;
    margin-top: 20px;
}

.security-modal-contact h4 {
    margin-bottom: 10px;
    color: #495057;
}

.security-modal-contact p {
    margin: 5px 0;
    color: #6c757d;
}

.no-copy {
    user-select: none !important;
    -webkit-user-select: none !important;
    -moz-user-select: none !important;
    -ms-user-select: none !important;
}

.no-context-menu {
    -webkit-touch-callout: none !important;
    -webkit-user-select: none !important;
    -khtml-user-select: none !important;
    -moz-user-select: none !important;
    -ms-user-select: none !important;
    user-select: none !important;
}

.anti-cheat-warning {
    background-color: #fff3cd;
    border: 1px solid #ffeaa7;
    color: #856404;
    padding: 10px;
    border-radius: 4px;
    margin: 10px 0;
    font-size: 14px;
}

.time-manipulation-detected {
    animation: time-warning-pulse 1s infinite;
    background-color: #f8d7da;
    border-color: #f5c6cb;
}

@keyframes time-warning-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}

.device-mismatch-warning {
    border-left: 4px solid #dc3545;
    padding-left: 15px;
    margin: 15px 0;
}

/* DEV MODE Indicator */
.dev-mode-indicator {
    position: fixed;
    bottom: 10px;
    left: 10px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 8px 15px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: bold;
    z-index: 99999;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    gap: 8px;
}

.dev-mode-flashing {
    animation: dev-mode-pulse 2s infinite;
}

@keyframes dev-mode-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
}
`;

// Inject styles into the document
if (typeof document !== 'undefined') {
    const styleElement = document.createElement('style');
    styleElement.textContent = SecurityStyles;
    document.head.appendChild(styleElement);
    
    // Add DEV MODE indicator to page
    const devIndicator = document.createElement('div');
    devIndicator.className = 'dev-mode-indicator dev-mode-flashing';
    devIndicator.innerHTML = `
        <span>🔓</span>
        <span>DEVELOPMENT MODE</span>
    `;
    devIndicator.title = 'Security restrictions reduced for development';
    document.body.appendChild(devIndicator);
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SecuritySystem,
        SecurityUtils,
        SecurityStyles
    };
} else if (typeof define === 'function' && define.amd) {
    define([], function() {
        return {
            SecuritySystem,
            SecurityUtils,
            SecurityStyles
        };
    });
} else {
    window.SecuritySystem = SecuritySystem;
    window.SecurityUtils = SecurityUtils;
    window.SecurityStyles = SecurityStyles;
    
    // Initialize global security instance with DEV MODE
    if (!window.medicalExamSecurity) {
        window.medicalExamSecurity = new SecuritySystem({
            debug: true, // Enable debug logging
            autoLockOnCheating: false, // Disable auto-lock
            alertThreshold: 10 // Higher threshold
        });
        
        console.log('🔓 DEVELOPMENT MODE: Security system initialized with reduced restrictions');
        console.log('🔓 You can safely use DevTools without getting locked');
    }
}
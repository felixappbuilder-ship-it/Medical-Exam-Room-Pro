// auth.js - Authentication management (mocked for Phase 1)
class AuthManager {
    constructor() {
        this.currentUser = null;
        this.token = null;
        this.refreshToken = null;
        this.deviceFingerprint = null;
        this.sessionTimeout = null;
        this.rememberMe = false;
        
        this.init();
    }

    // Initialize authentication manager
    init() {
        // Load saved session if exists
        this.loadSession();
        
        // Generate device fingerprint
        this.generateDeviceFingerprint();
        
        console.log('Auth manager initialized');
    }

    // Generate device fingerprint
    generateDeviceFingerprint() {
        // For Phase 1: simple fingerprint
        const components = [
            navigator.userAgent,
            navigator.language,
            navigator.platform,
            screen.width + 'x' + screen.height,
            new Date().getTimezoneOffset()
        ].join('|');
        
        // Simple hash function
        let hash = 0;
        for (let i = 0; i < components.length; i++) {
            const char = components.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        this.deviceFingerprint = `device_${Math.abs(hash).toString(36)}`;
        
        // Save to localStorage
        localStorage.setItem('device_fingerprint', this.deviceFingerprint);
        
        return this.deviceFingerprint;
    }

    // Load saved session
    loadSession() {
        try {
            const savedToken = localStorage.getItem('auth_token');
            const savedUser = localStorage.getItem('auth_user');
            const savedRefresh = localStorage.getItem('refresh_token');
            const savedRemember = localStorage.getItem('remember_me');
            
            if (savedToken && savedUser) {
                this.token = savedToken;
                this.currentUser = JSON.parse(savedUser);
                this.refreshToken = savedRefresh;
                this.rememberMe = savedRemember === 'true';
                
                // Restart session timeout if remember me is false
                if (!this.rememberMe) {
                    this.startSessionTimeout();
                }
                
                console.log('Session loaded from storage');
                return true;
            }
        } catch (error) {
            console.error('Failed to load session:', error);
            this.clearSession();
        }
        
        return false;
    }

    // Save session
    saveSession() {
        try {
            if (this.token && this.currentUser) {
                localStorage.setItem('auth_token', this.token);
                localStorage.setItem('auth_user', JSON.stringify(this.currentUser));
                
                if (this.refreshToken) {
                    localStorage.setItem('refresh_token', this.refreshToken);
                }
                
                localStorage.setItem('remember_me', this.rememberMe.toString());
                
                console.log('Session saved to storage');
                return true;
            }
        } catch (error) {
            console.error('Failed to save session:', error);
        }
        
        return false;
    }

    // Mock user registration (Phase 1)
    async register(userData) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    // Validate input
                    const validation = this.validateRegistration(userData);
                    if (!validation.isValid) {
                        reject(new Error(validation.errors[0]));
                        return;
                    }
                    
                    // Create user object
                    const user = {
                        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        email: userData.email,
                        phone: userData.phone,
                        name: userData.name,
                        password: this.hashPassword(userData.password),
                        profile: {
                            institution: userData.institution || '',
                            course: userData.course || '',
                            yearOfStudy: userData.yearOfStudy || 1
                        },
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        isVerified: false,
                        isActive: true
                    };
                    
                    // Generate tokens
                    const tokens = this.generateTokens(user);
                    
                    // Set current user
                    this.currentUser = user;
                    this.token = tokens.accessToken;
                    this.refreshToken = tokens.refreshToken;
                    this.rememberMe = userData.rememberMe || false;
                    
                    // Save to IndexedDB
                    DB.saveUser(user);
                    
                    // Save session
                    this.saveSession();
                    
                    // Start session timeout if not remember me
                    if (!this.rememberMe) {
                        this.startSessionTimeout();
                    }
                    
                    console.log('User registered:', user.email);
                    
                    resolve({
                        success: true,
                        user: this.getSafeUser(user),
                        tokens: tokens,
                        deviceFingerprint: this.deviceFingerprint
                    });
                } catch (error) {
                    reject(error);
                }
            }, 1000); // Simulate API delay
        });
    }

    // Mock user login (Phase 1)
    async login(credentials) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    // Validate input
                    const validation = this.validateLogin(credentials);
                    if (!validation.isValid) {
                        reject(new Error(validation.errors[0]));
                        return;
                    }
                    
                    // For Phase 1: create demo user if not exists
                    let user = await DB.getUserByEmail(credentials.email);
                    
                    if (!user) {
                        // Create demo user
                        user = {
                            id: 'demo_user',
                            email: credentials.email,
                            phone: '254712345678',
                            name: 'Demo Student',
                            password: this.hashPassword('password123'),
                            profile: {
                                institution: 'University of Nairobi',
                                course: 'Medicine',
                                yearOfStudy: 3
                            },
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                            isVerified: true,
                            isActive: true
                        };
                        
                        await DB.saveUser(user);
                    }
                    
                    // Check password (for Phase 1: accept any password)
                    // In real implementation: compare hashed passwords
                    
                    // Generate tokens
                    const tokens = this.generateTokens(user);
                    
                    // Set current user
                    this.currentUser = user;
                    this.token = tokens.accessToken;
                    this.refreshToken = tokens.refreshToken;
                    this.rememberMe = credentials.rememberMe || false;
                    
                    // Save session
                    this.saveSession();
                    
                    // Start session timeout if not remember me
                    if (!this.rememberMe) {
                        this.startSessionTimeout();
                    }
                    
                    // Log security event
                    DB.logSecurityEvent('login_success', {
                        email: user.email,
                        timestamp: new Date().toISOString()
                    });
                    
                    console.log('User logged in:', user.email);
                    
                    resolve({
                        success: true,
                        user: this.getSafeUser(user),
                        tokens: tokens,
                        deviceFingerprint: this.deviceFingerprint,
                        isNewDevice: false // For Phase 1
                    });
                } catch (error) {
                    // Log failed attempt
                    DB.logSecurityEvent('login_failed', {
                        email: credentials.email,
                        timestamp: new Date().toISOString()
                    });
                    
                    reject(error);
                }
            }, 1000); // Simulate API delay
        });
    }

    // Mock password reset (Phase 1)
    async resetPassword(email) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    if (!Utils.validateEmail(email)) {
                        reject(new Error('Invalid email address'));
                        return;
                    }
                    
                    // For Phase 1: simulate password reset
                    console.log('Password reset requested for:', email);
                    
                    resolve({
                        success: true,
                        message: 'Password reset instructions sent to your email'
                    });
                } catch (error) {
                    reject(error);
                }
            }, 1000);
        });
    }

    // Mock change password (Phase 1)
    async changePassword(oldPassword, newPassword) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    if (!this.isAuthenticated()) {
                        reject(new Error('Not authenticated'));
                        return;
                    }
                    
                    // Validate passwords
                    if (newPassword.length < 8) {
                        reject(new Error('New password must be at least 8 characters'));
                        return;
                    }
                    
                    // For Phase 1: accept any old password
                    // In real implementation: verify old password
                    
                    // Update user password
                    this.currentUser.password = this.hashPassword(newPassword);
                    this.currentUser.updatedAt = new Date().toISOString();
                    
                    // Save to database
                    DB.saveUser(this.currentUser);
                    
                    // Log security event
                    DB.logSecurityEvent('password_changed', {
                        userId: this.currentUser.id,
                        timestamp: new Date().toISOString()
                    });
                    
                    resolve({
                        success: true,
                        message: 'Password changed successfully'
                    });
                } catch (error) {
                    reject(error);
                }
            }, 1000);
        });
    }

    // Logout user
    logout() {
        // Log security event
        if (this.currentUser) {
            DB.logSecurityEvent('logout', {
                userId: this.currentUser.id,
                timestamp: new Date().toISOString()
            });
        }
        
        // Clear session timeout
        this.clearSessionTimeout();
        
        // Clear current session
        this.currentUser = null;
        this.token = null;
        this.refreshToken = null;
        
        // Clear storage
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('remember_me');
        
        console.log('User logged out');
        
        return true;
    }

    // Check if user is authenticated
    isAuthenticated() {
        return !!(this.currentUser && this.token);
    }

    // Check if user has active subscription (mocked for Phase 1)
    hasActiveSubscription() {
        // For Phase 1: always return true
        return true;
    }

    // Get current user (safe version without sensitive data)
    getCurrentUser() {
        if (!this.currentUser) return null;
        return this.getSafeUser(this.currentUser);
    }

    // Get safe user object (without sensitive data)
    getSafeUser(user) {
        if (!user) return null;
        
        const safeUser = { ...user };
        
        // Remove sensitive data
        delete safeUser.password;
        delete safeUser.tokens;
        
        return safeUser;
    }

    // Generate mock tokens (Phase 1)
    generateTokens(user) {
        // For Phase 1: generate simple tokens
        const timestamp = Date.now();
        
        const accessToken = `eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({
            userId: user.id,
            email: user.email,
            iat: timestamp,
            exp: timestamp + (7 * 24 * 60 * 60 * 1000) // 7 days
        }))}.mock_signature`;
        
        const refreshToken = `refresh_${btoa(user.id + ':' + timestamp)}`;
        
        return {
            accessToken,
            refreshToken,
            expiresIn: 604800, // 7 days in seconds
            tokenType: 'Bearer'
        };
    }

    // Validate token (Phase 1)
    validateToken(token) {
        if (!token) return false;
        
        try {
            // For Phase 1: simple validation
            const parts = token.split('.');
            if (parts.length !== 3) return false;
            
            const payload = JSON.parse(atob(parts[1]));
            const now = Date.now();
            
            // Check expiration
            if (payload.exp && payload.exp < now) {
                return false;
            }
            
            return true;
        } catch (error) {
            return false;
        }
    }

    // Refresh token (Phase 1)
    async refreshAccessToken() {
        if (!this.refreshToken || !this.currentUser) {
            return false;
        }
        
        return new Promise((resolve) => {
            setTimeout(() => {
                const tokens = this.generateTokens(this.currentUser);
                this.token = tokens.accessToken;
                this.refreshToken = tokens.refreshToken;
                
                // Save updated token
                localStorage.setItem('auth_token', this.token);
                localStorage.setItem('refresh_token', this.refreshToken);
                
                resolve(true);
            }, 500);
        });
    }

    // Hash password (simple for Phase 1)
    hashPassword(password) {
        // For Phase 1: simple hash
        // In production, use bcrypt or similar
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    // Validate registration data
    validateRegistration(data) {
        const errors = [];
        
        if (!data.email || !Utils.validateEmail(data.email)) {
            errors.push('Valid email is required');
        }
        
        if (!data.name || data.name.length < 2) {
            errors.push('Name must be at least 2 characters');
        }
        
        if (data.phone && !Utils.validatePhone(data.phone)) {
            errors.push('Valid Kenyan phone number is required (format: 0712345678)');
        }
        
        if (!data.password || data.password.length < 8) {
            errors.push('Password must be at least 8 characters');
        }
        
        if (data.password !== data.confirmPassword) {
            errors.push('Passwords do not match');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Validate login data
    validateLogin(data) {
        const errors = [];
        
        if (!data.email || !Utils.validateEmail(data.email)) {
            errors.push('Valid email is required');
        }
        
        if (!data.password || data.password.length < 1) {
            errors.push('Password is required');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Start session timeout (2 hours for Phase 1)
    startSessionTimeout() {
        this.clearSessionTimeout();
        
        const timeoutDuration = 2 * 60 * 60 * 1000; // 2 hours
        
        this.sessionTimeout = setTimeout(() => {
            if (this.isAuthenticated() && !this.rememberMe) {
                this.logout();
                UIManager.showToast('Session expired. Please login again.', 'warning');
                AppRouter.navigate('/welcome');
            }
        }, timeoutDuration);
    }

    // Clear session timeout
    clearSessionTimeout() {
        if (this.sessionTimeout) {
            clearTimeout(this.sessionTimeout);
            this.sessionTimeout = null;
        }
    }

    // Reset session timeout (extend on activity)
    resetSessionTimeout() {
        if (!this.rememberMe && this.isAuthenticated()) {
            this.startSessionTimeout();
        }
    }

    // Update user profile
    async updateProfile(profileData) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    if (!this.isAuthenticated()) {
                        reject(new Error('Not authenticated'));
                        return;
                    }
                    
                    // Update user data
                    this.currentUser.name = profileData.name || this.currentUser.name;
                    this.currentUser.phone = profileData.phone || this.currentUser.phone;
                    
                    if (profileData.profile) {
                        this.currentUser.profile = {
                            ...this.currentUser.profile,
                            ...profileData.profile
                        };
                    }
                    
                    this.currentUser.updatedAt = new Date().toISOString();
                    
                    // Save to database
                    DB.saveUser(this.currentUser);
                    
                    // Update stored session
                    this.saveSession();
                    
                    resolve({
                        success: true,
                        user: this.getSafeUser(this.currentUser),
                        message: 'Profile updated successfully'
                    });
                } catch (error) {
                    reject(error);
                }
            }, 1000);
        });
    }

    // Delete account (Phase 1)
    async deleteAccount() {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    if (!this.isAuthenticated()) {
                        reject(new Error('Not authenticated'));
                        return;
                    }
                    
                    // Log security event
                    DB.logSecurityEvent('account_deleted', {
                        userId: this.currentUser.id,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Clear session
                    this.logout();
                    
                    // For Phase 1: just clear data
                    // In production: make API call to delete account
                    
                    resolve({
                        success: true,
                        message: 'Account deleted successfully'
                    });
                } catch (error) {
                    reject(error);
                }
            }, 1000);
        });
    }

    // Check if email exists (Phase 1)
    async checkEmailExists(email) {
        return new Promise((resolve) => {
            setTimeout(() => {
                // For Phase 1: always return false (email available)
                // In production: check database
                resolve({ exists: false });
            }, 500);
        });
    }

    // Check if phone exists (Phase 1)
    async checkPhoneExists(phone) {
        return new Promise((resolve) => {
            setTimeout(() => {
                // For Phase 1: always return false (phone available)
                // In production: check database
                resolve({ exists: false });
            }, 500);
        });
    }

    // Get session info
    getSessionInfo() {
        return {
            isAuthenticated: this.isAuthenticated(),
            user: this.getCurrentUser(),
            deviceFingerprint: this.deviceFingerprint,
            rememberMe: this.rememberMe,
            sessionStarted: localStorage.getItem('session_started')
        };
    }

    // Clear session (force logout)
    clearSession() {
        this.logout();
        localStorage.clear();
        sessionStorage.clear();
        
        console.log('Session cleared');
        return true;
    }

    // Initialize session monitoring
    initSessionMonitoring() {
        // Reset timeout on user activity
        const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
        
        activityEvents.forEach(event => {
            document.addEventListener(event, () => {
                this.resetSessionTimeout();
            });
        });
        
        // Check token validity periodically
        setInterval(() => {
            if (this.isAuthenticated() && !this.validateToken(this.token)) {
                // Try to refresh token
                this.refreshAccessToken().catch(() => {
                    // If refresh fails, logout
                    this.logout();
                    UIManager.showToast('Session expired. Please login again.', 'warning');
                    AppRouter.navigate('/welcome');
                });
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }
}

// Create global instance
const Auth = new AuthManager();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Auth;
}
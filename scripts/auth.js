// frontend-user/scripts/auth.js

/**
 * Authentication Handler – OFFLINE SINGLE-USER VERSION
 * Manages login, registration, password reset, profile updates.
 * Uses db.js for persistence and app.js for state.
 */

import * as app from './app.js';
import * as ui from './ui.js';
import * as utils from './utils.js';
import * as db from './db.js';
import * as security from './security.js';

// ==================== TOKEN MANAGEMENT ====================

export function getToken() {
    return utils.getLocalStorage('accessToken');
}

export function setToken(token) {
    utils.setLocalStorage('accessToken', token);
}

export function clearToken() {
    utils.removeLocalStorage('accessToken');
    utils.removeLocalStorage('refreshToken');
}

export function getRefreshToken() {
    return utils.getLocalStorage('refreshToken');
}

export function setRefreshToken(token) {
    utils.setLocalStorage('refreshToken', token);
}

export function isTokenValid() {
    return !!getToken();
}

export async function refreshToken() {
    const refresh = getRefreshToken();
    if (!refresh) return false;
    setToken('simulated-token-' + Date.now());
    return true;
}

// ==================== LOGIN ====================

/**
 * Login – compare credentials against the single stored user.
 */
export async function login(identifier, password, deviceInfo) {
    console.log('[Auth] Login attempt:', identifier);
    await new Promise(r => setTimeout(r, 500));

    const user = await db.getUser();
    if (!user) {
        throw new Error('No user registered. Please sign up first.');
    }

    // Check identifier (email or phone)
    const identifierMatch = user.email === identifier || user.phone === identifier;
    if (!identifierMatch || user.password !== password) {
        throw new Error('Invalid credentials');
    }

    // Check lock status
    const lockStatus = await db.getLockStatus();
    if (lockStatus?.locked) {
        const error = new Error('Account is locked');
        error.code = 'ACCOUNT_LOCKED';
        throw error;
    }

    // Set tokens
    setToken('simulated-token-' + Date.now());
    setRefreshToken('simulated-refresh-' + Date.now());

    // Set device fingerprint
    security.setDeviceFingerprint(deviceInfo.deviceFingerprint);

    // Update app state (this also saves to DB)
    await app.setUser(user);

    console.log('[Auth] Login successful:', user.email);
    return user;
}

// ==================== REGISTER ====================

/**
 * Register – delete any existing user and create new one.
 */
export async function register(userData) {
    console.log('[Auth] Register attempt:', userData.email);
    await new Promise(r => setTimeout(r, 500));

    // Delete any existing user
    await db.deleteAllUsers();

    const newUser = {
        id: 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: userData.name,
        email: userData.email.toLowerCase(),
        phone: userData.phone,
        password: userData.password,
        securityQuestions: userData.securityQuestions.map(q => ({
            question: q.question,
            answer: q.answer.trim().toLowerCase()
        })),
        deviceFingerprint: userData.deviceFingerprint,
        createdAt: new Date().toISOString(),
        preferences: {
            theme: 'auto',
            notifications: true
        }
    };

    // Save to DB (via app.setUser which also updates memory)
    await app.setUser(newUser);

    // Set tokens
    setToken('simulated-token-' + Date.now());
    setRefreshToken('simulated-refresh-' + Date.now());

    // Set device fingerprint
    security.setDeviceFingerprint(userData.deviceFingerprint);

    console.log('[Auth] Registration successful:', newUser.email);
    return newUser;
}

// ==================== LOGOUT ====================

export async function logout() {
    clearToken();
    await app.clearUser();   // clears memory and DB
    app.clearSubscription();
    app.clearExamConfig();
    app.clearExamState();
    ui.showToast('Logged out', 'info');
}

// ==================== PASSWORD RESET ====================

export async function getSecurityQuestions(identifier) {
    await new Promise(r => setTimeout(r, 300));
    const user = await db.getUser();
    if (!user) throw new Error('User not found');
    if (user.email !== identifier && user.phone !== identifier) {
        throw new Error('User not found');
    }
    return user.securityQuestions.map(q => q.question);
}

export async function verifySecurityAnswers(identifier, answers) {
    await new Promise(r => setTimeout(r, 300));
    const user = await db.getUser();
    if (!user) throw new Error('User not found');
    if (user.email !== identifier && user.phone !== identifier) {
        throw new Error('User not found');
    }

    const normalizedAnswers = answers.map(a => a.trim().toLowerCase());
    const allCorrect = user.securityQuestions.every((q, i) =>
        q.answer === normalizedAnswers[i]
    );

    if (!allCorrect) {
        throw new Error('Answers do not match');
    }

    const resetToken = 'reset-' + Date.now() + '-' + Math.random().toString(36);
    sessionStorage.setItem('resetToken', resetToken);
    return resetToken;
}

export async function resetPassword(identifier, newPassword) {
    const resetToken = sessionStorage.getItem('resetToken');
    if (!resetToken) throw new Error('No reset token. Please restart the process.');

    await new Promise(r => setTimeout(r, 300));
    const user = await db.getUser();
    if (!user) throw new Error('User not found');
    if (user.email !== identifier && user.phone !== identifier) {
        throw new Error('User not found');
    }

    user.password = newPassword;
    await db.saveUser(user);   // update DB
    // Also update memory if this user is currently logged in
    const currentUser = app.getUser();
    if (currentUser && (currentUser.email === identifier || currentUser.phone === identifier)) {
        app.setUser(user);
    }
    sessionStorage.removeItem('resetToken');
}

// ==================== PROFILE MANAGEMENT ====================

export async function updateProfile(updates) {
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');

    Object.assign(user, updates);
    await db.saveUser(user);
    app.setUser(user);   // update memory
    return user;
}

export async function changePassword({ currentPassword, newPassword }) {
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');
    if (user.password !== currentPassword) {
        throw new Error('Current password is incorrect');
    }
    user.password = newPassword;
    await db.saveUser(user);
    app.setUser(user);
    setToken('simulated-token-' + Date.now()); // refresh token
}

export async function updatePreferences(preferences) {
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');
    user.preferences = { ...user.preferences, ...preferences };
    await db.saveUser(user);
    app.setUser(user);
}

export async function exportData() {
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');

    const exams = await db.getAllExamResults();
    const analytics = await db.getUserStatistics?.() || {};
    const securityLogs = await db.getSecurityViolations?.() || [];

    const data = {
        user,
        exams,
        analytics,
        securityLogs,
        exportedAt: new Date().toISOString()
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medical-exam-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

export async function deleteAccount(password) {
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');
    if (user.password !== password) {
        throw new Error('Password incorrect');
    }
    await db.deleteAllUsers();
    await logout();  // clears tokens and app state
}

// ==================== SESSION MANAGEMENT ====================

let sessionTimeout;
const SESSION_DURATION = 2 * 60 * 60 * 1000; // 2 hours

export function startSession() {
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => {
        ui.showToast('Session expired. Please login again.', 'warning');
        logout();
        window.location.href = '/pages/login.html';
    }, SESSION_DURATION);
}

export function extendSession() {
    if (sessionTimeout) {
        clearTimeout(sessionTimeout);
        startSession();
    }
}

// ==================== EXPOSE GLOBALLY ====================

window.auth = {
    login,
    register,
    logout,
    getSecurityQuestions,
    verifySecurityAnswers,
    resetPassword,
    updateProfile,
    changePassword,
    updatePreferences,
    exportData,
    deleteAccount,
    startSession,
    extendSession,
    getToken,
    isTokenValid,
    refreshToken
};
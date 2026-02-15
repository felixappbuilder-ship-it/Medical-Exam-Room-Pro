// frontend-user/scripts/auth.js

/**
 * Authentication Handler – OFFLINE VERSION
 * Stores users in IndexedDB with localStorage fallback.
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

// ==================== HELPER ====================

async function findUser(identifier) {
    const users = await db.getAllUsers();
    console.log('[Auth] All users:', users);
    return users.find(u => 
        u.email.toLowerCase() === identifier.toLowerCase() || 
        u.phone === identifier
    );
}

// ==================== AUTH FUNCTIONS ====================

export async function login(identifier, password, deviceInfo) {
    console.log('[Auth] Login attempt:', identifier);
    await new Promise(r => setTimeout(r, 500)); // simulate network

    const users = await db.getAllUsers();
    console.log('[Auth] Users in DB:', users);

    const user = users.find(u => 
        (u.email.toLowerCase() === identifier.toLowerCase() || u.phone === identifier) && 
        u.password === password
    );

    if (!user) {
        console.warn('[Auth] Invalid credentials for', identifier);
        const error = new Error('Invalid credentials');
        error.code = 'INVALID_CREDENTIALS';
        throw error;
    }

    // Check if account is locked
    const lockStatus = await db.getLockStatus();
    if (lockStatus?.locked) {
        console.warn('[Auth] Account locked:', user.id);
        const error = new Error('Account is locked');
        error.code = 'ACCOUNT_LOCKED';
        throw error;
    }

    // Simulate tokens
    setToken('simulated-token-' + Date.now());
    setRefreshToken('simulated-refresh-' + Date.now());
    security.setDeviceFingerprint(deviceInfo.deviceFingerprint);

    // Set user in app state
    app.setUser(user);
    console.log('[Auth] Login successful:', user.email);

    return user;
}

export async function register(userData) {
    console.log('[Auth] Register attempt:', userData.email);
    await new Promise(r => setTimeout(r, 500));

    const users = await db.getAllUsers();
    const exists = users.some(u => 
        u.email.toLowerCase() === userData.email.toLowerCase() || 
        u.phone === userData.phone
    );
    if (exists) {
        console.warn('[Auth] User already exists:', userData.email);
        throw new Error('User already exists with that email or phone');
    }

    const newUser = {
        id: 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
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

    await db.saveUser(newUser);
    console.log('[Auth] User saved to DB:', newUser.id);

    // Simulate tokens
    setToken('simulated-token-' + Date.now());
    setRefreshToken('simulated-refresh-' + Date.now());

    app.setUser(newUser);
    console.log('[Auth] Registration successful:', newUser.email);

    return newUser;
}

export function logout() {
    clearToken();
    app.clearUser();
    app.clearSubscription();
    app.clearExamConfig();
    app.clearExamState();
    ui.showToast('Logged out', 'info');
}

export async function updateProfile(updates) {
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');

    Object.assign(user, updates);
    await db.saveUser(user);
    app.setUser(user);
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
    setToken('simulated-token-' + Date.now());
}

export async function getSecurityQuestions(identifier) {
    await new Promise(r => setTimeout(r, 300));
    const user = await findUser(identifier);
    if (!user) throw new Error('User not found');
    return user.securityQuestions.map(q => q.question);
}

export async function verifySecurityAnswers(identifier, answers) {
    await new Promise(r => setTimeout(r, 300));
    const user = await findUser(identifier);
    if (!user) throw new Error('User not found');

    const normalizedAnswers = answers.map(a => a.trim().toLowerCase());
    const allCorrect = user.securityQuestions.every((q, i) => 
        q.answer === normalizedAnswers[i]
    );

    if (!allCorrect) {
        throw new Error('Answers do not match');
    }

    const resetToken = 'reset-' + Date.now();
    sessionStorage.setItem('resetToken', resetToken);
    return resetToken;
}

export async function resetPassword(identifier, newPassword) {
    const resetToken = sessionStorage.getItem('resetToken');
    if (!resetToken) throw new Error('No reset token');

    const user = await findUser(identifier);
    if (!user) throw new Error('User not found');

    user.password = newPassword;
    await db.saveUser(user);
    sessionStorage.removeItem('resetToken');
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

    const data = {
        user,
        exams: await db.getAllExamResults(),
        analytics: await db.getUserStatistics(),
        securityLogs: await db.getSecurityViolations?.() || []
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
    await db.deleteUser();
    logout();
}

// ==================== SESSION MANAGEMENT ====================

let sessionTimeout;
const SESSION_DURATION = 2 * 60 * 60 * 1000;

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
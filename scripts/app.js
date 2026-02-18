// frontend-user/scripts/app.js

/**
 * Application State Manager – SINGLE USER
 * Maintains in‑memory state and syncs with IndexedDB via db.js.
 * Must be initialized on every page with await app.initializeApp().
 */

import * as utils from './utils.js';
import * as db from './db.js';

// ==================== GLOBAL STATE ====================

let currentUser = null;               // in‑memory user object
let subscriptionStatus = null;        // current subscription (if any)
let examState = null;                 // active exam state (for resume)
let appSettings = {                    // user preferences
    theme: 'auto',
    notifications: true,
    sound: true
};
let selectedPlan = null;               // for payment flow
let currentTransaction = null;         // for payment polling
let examConfig = null;                 // exam settings before start

// ==================== INITIALIZATION ====================

/**
 * Load user, subscription and settings from persistent storage.
 * Must be called and awaited on every page that needs user state.
 */
export async function initializeApp() {
    console.log('[App] Initializing...');
    try {
        // Try IndexedDB first, fallback to localStorage
        currentUser = await db.getUser() || utils.getLocalStorage('user', null);
        console.log('[App] Loaded user:', currentUser);

        subscriptionStatus = await db.getSubscription() || utils.getLocalStorage('subscription', null);
        appSettings = utils.getLocalStorage('appSettings', appSettings);
    } catch (e) {
        console.warn('[App] Initialization error, using localStorage fallback', e);
        currentUser = utils.getLocalStorage('user', null);
        subscriptionStatus = utils.getLocalStorage('subscription', null);
    }
}

// ==================== AUTHENTICATION CHECK ====================

/**
 * Check if user is authenticated (token exists and user object is in memory).
 * Token is stored in localStorage as a simple flag.
 */
export function checkAuth() {
    const token = utils.getLocalStorage('accessToken');
    const hasUser = !!currentUser;
    console.log('[App] checkAuth: token exists?', !!token, 'user exists?', hasUser);
    return !!token && hasUser;
}

// ==================== USER MANAGEMENT ====================

/**
 * Set the current user in memory and persist to storage.
 * This overwrites any existing user.
 */
export async function setUser(user) {
    if (!user || !user.id) {
        console.warn('[App] setUser called with invalid user', user);
        return;
    }
    currentUser = user;
    // Save to IndexedDB (async)
    await db.saveUser(user).catch(() => {
        utils.setLocalStorage('user', user);
    });
    console.log('[App] User set and saved:', user.id);
}

/**
 * Get the current user from memory.
 */
export function getUser() {
    return currentUser;
}

/**
 * Clear the current user from memory and delete from storage.
 */
export async function clearUser() {
    currentUser = null;
    // Delete from IndexedDB
    await db.deleteAllUsers().catch(() => {
        utils.removeLocalStorage('user');
    });
    // Remove token flags
    utils.removeLocalStorage('accessToken');
    utils.removeLocalStorage('refreshToken');
    console.log('[App] User cleared');
}

// ==================== SUBSCRIPTION MANAGEMENT ====================

export async function setSubscription(subscription) {
    subscriptionStatus = subscription;
    await db.saveSubscription(subscription).catch(() => {
        utils.setLocalStorage('subscription', subscription);
    });
}

export function getSubscription() {
    return subscriptionStatus;
}

export function hasActiveSubscription() {
    if (!subscriptionStatus) return false;
    if (!subscriptionStatus.isActive) return false;
    const now = Date.now();
    const expiry = new Date(subscriptionStatus.expiryDate).getTime();
    return expiry > now;
}

export async function clearSubscription() {
    subscriptionStatus = null;
    await db.deleteSubscription().catch(() => {
        utils.removeLocalStorage('subscription');
    });
}

// ==================== EXAM STATE (for exam-room) ====================

export function setExamState(state) {
    examState = state;
}

export function getExamState() {
    return examState;
}

export function clearExamState() {
    examState = null;
}

// ==================== EXAM CONFIG (for settings) ====================

export function setExamConfig(config) {
    examConfig = config;
    if (config) {
        sessionStorage.setItem('examConfig', JSON.stringify(config));
    } else {
        sessionStorage.removeItem('examConfig');
    }
}

export function getExamConfig() {
    if (!examConfig) {
        const saved = sessionStorage.getItem('examConfig');
        if (saved) {
            try {
                examConfig = JSON.parse(saved);
            } catch {
                examConfig = null;
            }
        }
    }
    return examConfig;
}

export function clearExamConfig() {
    examConfig = null;
    sessionStorage.removeItem('examConfig');
}

// ==================== APP SETTINGS ====================

export function setAppSetting(key, value) {
    appSettings[key] = value;
    utils.setLocalStorage('appSettings', appSettings);
}

export function getAppSetting(key) {
    return appSettings[key];
}

export function toggleTheme() {
    const newTheme = appSettings.theme === 'dark' ? 'light' : 'dark';
    setAppSetting('theme', newTheme);
    return newTheme;
}

// ==================== PLAN SELECTION (for payment) ====================

export function setSelectedPlan(planId) {
    selectedPlan = planId;
}

export function getSelectedPlan() {
    return selectedPlan;
}

// ==================== TRANSACTION (for payment polling) ====================

export function setCurrentTransaction(transactionId) {
    currentTransaction = transactionId;
}

export function getCurrentTransaction() {
    return currentTransaction;
}

// ==================== EVENT BUS ====================

const eventListeners = {};

export const events = {
    on(event, callback) {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(callback);
    },
    emit(event, data) {
        if (eventListeners[event]) {
            eventListeners[event].forEach(cb => cb(data));
        }
    },
    off(event, callback) {
        if (eventListeners[event]) {
            eventListeners[event] = eventListeners[event].filter(cb => cb !== callback);
        }
    }
};

// ==================== CLEANUP ====================

export function cleanupApp() {
    // Nothing heavy
}

// ==================== EXPOSE GLOBALLY ====================

window.app = {
    initializeApp,
    checkAuth,
    setUser,
    getUser,
    clearUser,
    setSubscription,
    getSubscription,
    hasActiveSubscription,
    clearSubscription,
    setExamState,
    getExamState,
    clearExamState,
    setExamConfig,
    getExamConfig,
    clearExamConfig,
    setAppSetting,
    getAppSetting,
    toggleTheme,
    setSelectedPlan,
    getSelectedPlan,
    setCurrentTransaction,
    getCurrentTransaction,
    events
};
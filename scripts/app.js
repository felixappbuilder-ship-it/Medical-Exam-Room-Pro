// frontend-user/scripts/app.js

/**
 * Application State Manager
 * Maintains global state: user, subscription, exam config, settings.
 * Used on all pages that need state.
 */

import * as utils from './utils.js';
import * as db from './db.js';

// ==================== GLOBAL STATE ====================

let currentUser = null;
let subscriptionStatus = null;
let examState = null;
let appSettings = {
    theme: 'auto',
    notifications: true,
    sound: true
};
let selectedPlan = null;
let currentTransaction = null;
let examConfig = null;

// ==================== INITIALIZATION ====================

/**
 * Initialize app: load user and subscription from storage
 */
export async function initializeApp() {
    // Load user from IndexedDB (or localStorage as fallback)
    currentUser = await db.getUser() || utils.getLocalStorage('user', null);
    subscriptionStatus = await db.getSubscription() || utils.getLocalStorage('subscription', null);
    appSettings = utils.getLocalStorage('appSettings', appSettings);
    
    // If user is present but token expired? We'll handle in auth.js
}

/**
 * Check if user is authenticated (has valid token)
 * @returns {boolean}
 */
export function checkAuth() {
    // Token existence check (actual validation will be done by backend)
    const token = utils.getLocalStorage('accessToken');
    return !!token && !!currentUser;
}

// ==================== USER ====================

export function setUser(user) {
    currentUser = user;
    db.saveUser(user).catch(() => {
        // fallback to localStorage
        utils.setLocalStorage('user', user);
    });
}

export function getUser() {
    return currentUser;
}

export function clearUser() {
    currentUser = null;
    db.deleteUser().catch(() => {});
    utils.removeLocalStorage('user');
}

// ==================== SUBSCRIPTION ====================

export function setSubscription(subscription) {
    subscriptionStatus = subscription;
    db.saveSubscription(subscription).catch(() => {
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

export function clearSubscription() {
    subscriptionStatus = null;
    db.deleteSubscription().catch(() => {});
    utils.removeLocalStorage('subscription');
}

// ==================== EXAM STATE ====================

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
    // Also store in session for resume
    sessionStorage.setItem('examConfig', JSON.stringify(config));
}

export function getExamConfig() {
    if (!examConfig) {
        const saved = sessionStorage.getItem('examConfig');
        if (saved) {
            try {
                examConfig = JSON.parse(saved);
            } catch {}
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
    // Will be handled by ui.js, but we update setting
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

// ==================== EVENT BUS (simple) ====================

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
    // Nothing heavy now
}
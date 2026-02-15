// frontend-user/scripts/security.js

/**
 * Security & Anti-Cheating – Development Version (No Backend Required)
 * Uses localStorage/IndexedDB to track violations and device fingerprint.
 * Implements WhatsApp-style warnings: guide user, block only after repeated violations.
 */

import * as utils from './utils.js';
import * as ui from './ui.js';
import * as app from './app.js';
import * as db from './db.js';

// ==================== CONSTANTS ====================

const MAX_TIME_DRIFT_MS = 5 * 60 * 1000; // 5 minutes tolerance
const WARNING_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes – show warning
const LOCK_THRESHOLD_COUNT = 3; // number of violations before lock
const LOCK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// In dev mode, we don't fetch real server time; we use client time and simulate.
const DEV_MODE = true;

// ==================== DEVICE FINGERPRINT ====================

export function generateDeviceFingerprint() {
    const components = [
        navigator.userAgent,
        navigator.language,
        navigator.platform,
        screen.width + 'x' + screen.height,
        screen.colorDepth,
        new Date().getTimezoneOffset(),
        navigator.hardwareConcurrency || 'unknown',
        navigator.deviceMemory || 'unknown',
    ].join('|');

    // Simple hash
    let hash = 0;
    for (let i = 0; i < components.length; i++) {
        const char = components.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0') + 
           Date.now().toString(36).substring(2, 10);
}

export function getDeviceFingerprint() {
    let fp = utils.getLocalStorage('deviceFingerprint');
    if (!fp) {
        fp = generateDeviceFingerprint();
        utils.setLocalStorage('deviceFingerprint', fp);
    }
    return fp;
}

export function setDeviceFingerprint(fp) {
    utils.setLocalStorage('deviceFingerprint', fp);
}

// ==================== TIME MANIPULATION DETECTION ====================

// In dev mode, we don't have a real server, so we simulate occasional drift
let devTimeDrift = 0; // can be set manually for testing

/**
 * Get server time – in dev, returns client time (or modified for testing)
 */
async function getServerTime() {
    if (DEV_MODE) {
        // For testing, you can set devTimeDrift to simulate drift
        return Date.now() + devTimeDrift;
    }
    // Real implementation would fetch from backend
    return Date.now();
}

/**
 * Detect time manipulation
 * @returns {Promise<Object>} { valid, drift, message, action }
 */
export async function detectTimeManipulation() {
    const serverTime = await getServerTime();
    if (!serverTime) {
        return { valid: true, drift: 0, message: '', action: 'ok' };
    }

    const clientTime = Date.now();
    const drift = Math.abs(clientTime - serverTime);

    if (drift > MAX_TIME_DRIFT_MS) {
        // Severe violation – record it
        await recordViolation('time_manipulation', drift);
        const count = await getViolationCount('time_manipulation');
        
        if (count >= LOCK_THRESHOLD_COUNT) {
            return { 
                valid: false, 
                drift, 
                message: 'Your device time is significantly off. Account locked for security.',
                action: 'lock'
            };
        } else {
            return { 
                valid: false, 
                drift, 
                message: 'Your device time does not match our servers. Please enable automatic time sync to continue.',
                action: 'block'
            };
        }
    } else if (drift > WARNING_THRESHOLD_MS) {
        return { 
            valid: true, 
            drift, 
            message: 'Your device time is slightly off. For accurate exam timing, please enable automatic time sync.',
            action: 'warn'
        };
    }

    return { valid: true, drift: 0, message: '', action: 'ok' };
}

/**
 * Validate client time against server
 */
export async function validateClientTime(clientTime) {
    const serverTime = await getServerTime();
    if (!serverTime) return true;
    const drift = Math.abs(clientTime - serverTime);
    return drift <= MAX_TIME_DRIFT_MS;
}

/**
 * Get safe timestamp (prefer server time)
 */
export async function getSafeTimestamp() {
    const serverTime = await getServerTime();
    if (serverTime) return serverTime;
    ui.showToast('Using device time – could not verify with server', 'warning', 4000);
    return Date.now();
}

/**
 * Check time consistency – call on app start
 */
export async function checkTimeConsistency() {
    const result = await detectTimeManipulation();
    
    if (result.action === 'lock') {
        await lockAccount('time_manipulation', result.drift);
        ui.showToast(result.message, 'error', 0);
        window.location.href = '/pages/locked.html?reason=time_manipulation';
        return false;
    } else if (result.action === 'block') {
        ui.showToast(result.message, 'warning', 0);
        app.setAppSetting('timeBlocked', true);
        return false;
    } else if (result.action === 'warn') {
        ui.showToast(result.message, 'warning', 5000);
        app.setAppSetting('timeBlocked', false);
        return true;
    } else {
        app.setAppSetting('timeBlocked', false);
        return true;
    }
}

// ==================== VIOLATION TRACKING ====================

async function getViolations() {
    const stored = await db.getSecurityViolations() || [];
    return stored;
}

async function recordViolation(type, details) {
    const now = Date.now();
    const violations = await getViolations();
    
    // Keep only recent violations within lock window
    const recent = violations.filter(v => (now - v.timestamp) < LOCK_WINDOW_MS);
    recent.push({ type, timestamp: now, details });
    
    await db.saveSecurityViolations(recent);
}

async function getViolationCount(type) {
    const violations = await getViolations();
    const now = Date.now();
    return violations.filter(v => 
        v.type === type && (now - v.timestamp) < LOCK_WINDOW_MS
    ).length;
}

// ==================== ACCOUNT LOCKING ====================

async function lockAccount(reason, details) {
    await db.saveLockStatus({
        locked: true,
        reason,
        details,
        timestamp: Date.now()
    });
    
    app.clearUser();
    app.clearSubscription();
    clearToken(); // from auth.js – but careful with circular deps
    utils.removeLocalStorage('auth_token');
}

export async function getLockStatus() {
    return await db.getLockStatus() || { locked: false };
}

// ==================== SECURITY EVENT LOGGING ====================

export async function logSecurityEvent(event, details) {
    const logEntry = {
        event,
        timestamp: Date.now(),
        deviceFingerprint: getDeviceFingerprint(),
        details
    };
    
    await db.addSecurityLog(logEntry);
}

// ==================== SESSION VALIDATION ====================

export async function validateSession() {
    const lockStatus = await getLockStatus();
    if (lockStatus.locked) {
        return false;
    }
    
    const timeOk = await checkTimeConsistency();
    if (!timeOk) {
        return false;
    }
    
    const user = app.getUser();
    if (user && user.deviceFingerprint && user.deviceFingerprint !== getDeviceFingerprint()) {
        ui.showToast('New device detected. Please verify your identity.', 'warning', 5000);
    }
    
    return true;
}

// ==================== INITIALIZATION ====================

export async function initSecurity() {
    await checkTimeConsistency();
    
    setInterval(async () => {
        await checkTimeConsistency();
    }, 5 * 60 * 1000);
}

// Helper to clear token (avoids circular import)
function clearToken() {
    utils.removeLocalStorage('auth_token');
    utils.removeLocalStorage('refresh_token');
}

// ==================== EXPOSE GLOBALLY ====================

window.security = {
    generateDeviceFingerprint,
    getDeviceFingerprint,
    setDeviceFingerprint,
    detectTimeManipulation,
    validateClientTime,
    getSafeTimestamp,
    checkTimeConsistency,
    logSecurityEvent,
    validateSession,
    getLockStatus
};
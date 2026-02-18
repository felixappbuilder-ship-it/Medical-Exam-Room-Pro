// frontend-user/scripts/security.js

/**
 * Security & Anti-Cheating Module – OFFLINE FRIENDLY
 * Provides device fingerprinting, time manipulation detection with user-friendly warnings,
 * and account locking only under extreme conditions (repeated violations).
 * Follows WhatsApp-style approach: warn first, block functionality until time is corrected,
 * and only lock after multiple attempts.
 */

import * as utils from './utils.js';
import * as ui from './ui.js';
import * as app from './app.js';
import * as db from './db.js';

// Constants
const MAX_TIME_DRIFT_MS = 10 * 60 * 1000; // 10 minutes tolerance (increased from 5)
const WARNING_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes – show warning
const LOCK_THRESHOLD_COUNT = 3; // number of violations before lock
const LOCK_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const SERVER_TIME_CACHE_TTL = 60 * 1000; // 1 minute

let serverTimeCache = null;
let serverTimeCacheExpiry = 0;
let violationCount = 0;
let lastViolationTime = 0;

// ==================== DEVICE FINGERPRINT ====================

/**
 * Generate a unique device fingerprint based on browser/device characteristics
 * @returns {string} fingerprint (not cryptographic, but unique enough)
 */
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

/**
 * Get stored device fingerprint or generate and store
 * @returns {string}
 */
export function getDeviceFingerprint() {
    let fp = utils.getLocalStorage('deviceFingerprint');
    if (!fp) {
        fp = generateDeviceFingerprint();
        utils.setLocalStorage('deviceFingerprint', fp);
    }
    return fp;
}

/**
 * Set device fingerprint (usually from server after registration)
 * @param {string} fp
 */
export function setDeviceFingerprint(fp) {
    utils.setLocalStorage('deviceFingerprint', fp);
}

// ==================== TIME MANIPULATION DETECTION ====================

/**
 * Get server time – if offline, return null (graceful degradation)
 * @returns {Promise<number|null>} server timestamp in ms
 */
async function getServerTime() {
    if (serverTimeCache && Date.now() < serverTimeCacheExpiry) {
        return serverTimeCache;
    }

    try {
        // Use a lightweight endpoint that returns server time (or just use Date header)
        const response = await fetch('https://medicalexamroom.onrender.com/api/v1/health', {
            method: 'GET',
            signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) throw new Error('Server time unavailable');
        const data = await response.json();
        const serverTime = data.serverTime || new Date(response.headers.get('Date')).getTime();
        if (serverTime) {
            serverTimeCache = serverTime;
            serverTimeCacheExpiry = Date.now() + SERVER_TIME_CACHE_TTL;
            return serverTime;
        }
    } catch (e) {
        console.warn('[Security] Could not fetch server time, assuming offline');
    }
    return null;
}

/**
 * Detect time manipulation by comparing client time with server time.
 * If offline, assumes valid and returns warning action.
 * @returns {Promise<Object>} { valid: boolean, drift: number, message: string, action: 'ok'|'warn'|'block'|'lock' }
 */
export async function detectTimeManipulation() {
    const serverTime = await getServerTime();
    if (!serverTime) {
        // Offline – cannot verify, assume valid but warn user
        return { 
            valid: true, 
            drift: 0, 
            message: 'Offline mode – time not verified. Please ensure your device time is correct.',
            action: 'warn'
        };
    }

    const clientTime = Date.now();
    const drift = Math.abs(clientTime - serverTime);

    if (drift > MAX_TIME_DRIFT_MS) {
        // Severe violation – record and possibly lock
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
        // Warning threshold – allow but show warning
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
 * Validate client time against server (used in requests)
 * @param {number} clientTime - timestamp sent from client
 * @returns {Promise<boolean>} true if within tolerance or offline
 */
export async function validateClientTime(clientTime) {
    const serverTime = await getServerTime();
    if (!serverTime) return true; // offline, can't validate
    const drift = Math.abs(clientTime - serverTime);
    return drift <= MAX_TIME_DRIFT_MS;
}

/**
 * Get a safe timestamp – uses server time if available, else client time with warning
 * @returns {Promise<number>}
 */
export async function getSafeTimestamp() {
    const serverTime = await getServerTime();
    if (serverTime) return serverTime;
    ui.showToast('Using device time – could not verify with server', 'warning', 4000);
    return Date.now();
}

/**
 * Check time consistency on app start and periodically
 * @returns {Promise<boolean>} true if time is acceptable (or offline)
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

async function recordViolation(type, details) {
    const now = Date.now();
    const violations = await getViolations();
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

async function getViolations() {
    const stored = await db.getSecurityViolations() || [];
    return stored;
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
    utils.removeLocalStorage('accessToken');
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
    
    if (navigator.onLine && app.checkAuth()) {
        try {
            await fetch('https://medicalexamroom.onrender.com/api/v1/security/log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${utils.getLocalStorage('accessToken')}`
                },
                body: JSON.stringify(logEntry)
            });
        } catch {
            await db.addToSyncQueue('security_log', logEntry);
        }
    } else {
        await db.addToSyncQueue('security_log', logEntry);
    }
}

// ==================== SESSION VALIDATION ====================

export async function validateSession() {
    const lockStatus = await getLockStatus();
    if (lockStatus.locked) return false;
    
    const timeOk = await checkTimeConsistency();
    if (!timeOk) return false;
    
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
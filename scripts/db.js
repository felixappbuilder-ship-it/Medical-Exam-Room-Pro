// frontend-user/scripts/db.js

/**
 * IndexedDB Database Manager – OFFLINE VERSION
 * Provides offline storage for user data, exam results, questions, sync queue,
 * security logs, lock status, analytics, and settings.
 * Falls back to localStorage when IndexedDB fails.
 */

import * as utils from './utils.js';

const DB_NAME = 'MedExamDB';
const DB_VERSION = 3; // Increment version to ensure schema updates

let db = null;
let dbInitPromise = null;

// ==================== INITIALIZATION ====================

/**
 * Initialize the database connection.
 * @returns {Promise<IDBDatabase>}
 */
export function initDatabase() {
    if (db) return Promise.resolve(db);
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('IndexedDB error:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('IndexedDB opened successfully');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;

            console.log(`Upgrading DB from version ${oldVersion} to ${DB_VERSION}`);

            // Create object stores if they don't exist
            if (!db.objectStoreNames.contains('users')) {
                const userStore = db.createObjectStore('users', { keyPath: 'id' });
                userStore.createIndex('by_email', 'email', { unique: true });
                userStore.createIndex('by_phone', 'phone', { unique: true });
                console.log('Created users store');
            }

            if (!db.objectStoreNames.contains('subscriptions')) {
                const subStore = db.createObjectStore('subscriptions', { keyPath: 'userId' });
                subStore.createIndex('by_expiry', 'expiryDate', { unique: false });
                console.log('Created subscriptions store');
            }

            if (!db.objectStoreNames.contains('exams')) {
                const examStore = db.createObjectStore('exams', { keyPath: 'examId' });
                examStore.createIndex('by_date', 'date', { unique: false });
                examStore.createIndex('by_subject', 'subject', { unique: false });
                console.log('Created exams store');
            }

            if (!db.objectStoreNames.contains('questions')) {
                const qStore = db.createObjectStore('questions', { keyPath: 'id' });
                qStore.createIndex('by_subject', 'subject', { unique: false });
                qStore.createIndex('by_topic', 'topic', { unique: false });
                qStore.createIndex('by_difficulty', 'difficulty', { unique: false });
                console.log('Created questions store');
            }

            if (!db.objectStoreNames.contains('syncQueue')) {
                const queueStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
                queueStore.createIndex('by_user', 'userId', { unique: false });
                queueStore.createIndex('by_type', 'type', { unique: false });
                queueStore.createIndex('by_timestamp', 'timestamp', { unique: false });
                console.log('Created syncQueue store');
            }

            if (!db.objectStoreNames.contains('security')) {
                const secStore = db.createObjectStore('security', { keyPath: 'id' });
                // We'll store violations, logs, lock status as separate records with fixed ids
                console.log('Created security store');
            }

            if (!db.objectStoreNames.contains('analytics')) {
                const analStore = db.createObjectStore('analytics', { keyPath: 'id' });
                analStore.createIndex('by_timestamp', 'timestamp', { unique: false });
                console.log('Created analytics store');
            }

            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
                console.log('Created settings store');
            }
        };
    });

    return dbInitPromise;
}

// ==================== HELPER: GET STORE ====================

/**
 * Get a transaction and object store.
 * @param {string} storeName
 * @param {string} mode - 'readonly' or 'readwrite'
 * @returns {Promise<IDBObjectStore>}
 */
async function getStore(storeName, mode = 'readonly') {
    const database = await initDatabase();
    const tx = database.transaction(storeName, mode);
    return tx.objectStore(storeName);
}

// ==================== USER OPERATIONS ====================

/**
 * Save user data.
 * @param {Object} user
 * @returns {Promise<void>}
 */
export async function saveUser(user) {
    if (!user || !user.id) {
        console.warn('saveUser: invalid user', user);
        return;
    }
    try {
        const store = await getStore('users', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put(user);
            request.onsuccess = () => {
                console.log('User saved:', user.id);
                resolve();
            };
            request.onerror = (err) => {
                console.error('saveUser error:', err);
                reject(err);
            };
        });
    } catch (e) {
        console.warn('IndexedDB saveUser failed, using localStorage fallback', e);
        utils.setLocalStorage('user', user);
    }
}

/**
 * Get the current user (first user in store, assuming single user).
 * @returns {Promise<Object|null>}
 */
export async function getUser() {
    try {
        const store = await getStore('users', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const users = request.result;
                resolve(users.length > 0 ? users[0] : null);
            };
            request.onerror = (err) => {
                console.error('getUser error:', err);
                reject(err);
            };
        });
    } catch (e) {
        console.warn('getUser failed, using localStorage fallback', e);
        return utils.getLocalStorage('user', null);
    }
}

/**
 * Get all users (for login/registration checks).
 * @returns {Promise<Array>}
 */
export async function getAllUsers() {
    try {
        const store = await getStore('users', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                console.log('getAllUsers success, count:', request.result.length);
                resolve(request.result || []);
            };
            request.onerror = (err) => {
                console.error('getAllUsers error:', err);
                reject(err);
            };
        });
    } catch (e) {
        console.warn('getAllUsers failed, using localStorage fallback', e);
        const user = utils.getLocalStorage('user', null);
        return user ? [user] : [];
    }
}

/**
 * Delete user data.
 * @returns {Promise<void>}
 */
export async function deleteUser() {
    try {
        const store = await getStore('users', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => {
                console.log('All users deleted');
                resolve();
            };
            request.onerror = (err) => {
                console.error('deleteUser error:', err);
                reject(err);
            };
        });
    } catch (e) {
        console.warn('deleteUser failed, using localStorage fallback', e);
        utils.removeLocalStorage('user');
    }
}

// ==================== SUBSCRIPTION OPERATIONS ====================

/**
 * Save subscription.
 * @param {Object} subscription
 */
export async function saveSubscription(subscription) {
    if (!subscription || !subscription.userId) return;
    try {
        const store = await getStore('subscriptions', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put(subscription);
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.setLocalStorage('subscription', subscription);
    }
}

/**
 * Get subscription.
 * @returns {Promise<Object|null>}
 */
export async function getSubscription() {
    try {
        const store = await getStore('subscriptions', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const subs = request.result;
                resolve(subs.length > 0 ? subs[0] : null);
            };
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return utils.getLocalStorage('subscription', null);
    }
}

/**
 * Delete subscription.
 */
export async function deleteSubscription() {
    try {
        const store = await getStore('subscriptions', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.removeLocalStorage('subscription');
    }
}

// ==================== EXAM RESULTS ====================

/**
 * Save exam result.
 * @param {Object} result
 */
export async function saveExamResult(result) {
    if (!result || !result.examId) return;
    try {
        const store = await getStore('exams', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put(result);
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.setLocalStorage('lastExam', result);
    }
}

/**
 * Get all exam results.
 * @returns {Promise<Array>}
 */
export async function getAllExamResults() {
    try {
        const store = await getStore('exams', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        const last = utils.getLocalStorage('lastExam', null);
        return last ? [last] : [];
    }
}

/**
 * Get exam result by ID.
 * @param {string} examId
 */
export async function getExamResult(examId) {
    try {
        const store = await getStore('exams', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get(examId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        const last = utils.getLocalStorage('lastExam', null);
        return last && last.examId === examId ? last : null;
    }
}

/**
 * Get last exam (by date).
 */
export async function getLastExam() {
    try {
        const store = await getStore('exams', 'readonly');
        const index = store.index('by_date');
        return new Promise((resolve, reject) => {
            const request = index.openCursor(null, 'prev');
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                resolve(cursor ? cursor.value : null);
            };
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return utils.getLocalStorage('lastExam', null);
    }
}

/**
 * Delete exam result.
 * @param {string} examId
 */
export async function deleteExamResult(examId) {
    try {
        const store = await getStore('exams', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.delete(examId);
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        // ignore
    }
}

/**
 * Clear all exam results.
 */
export async function clearExamResults() {
    try {
        const store = await getStore('exams', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.removeLocalStorage('lastExam');
    }
}

// ==================== SYNC QUEUE ====================

/**
 * Add item to sync queue.
 * @param {string} type - 'exam_results', 'profile_update', 'security_log', etc.
 * @param {Object} data
 */
export async function addToSyncQueue(type, data) {
    const user = await getUser().catch(() => null);
    const item = {
        type,
        data,
        userId: user?.id || 'anonymous',
        timestamp: Date.now(),
        attempts: 0
    };
    try {
        const store = await getStore('syncQueue', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.add(item);
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        console.warn('Failed to add to sync queue', e);
    }
}

/**
 * Get all pending sync items.
 * @returns {Promise<Array>}
 */
export async function getSyncQueue() {
    try {
        const store = await getStore('syncQueue', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return [];
    }
}

/**
 * Remove item from sync queue by id.
 * @param {number} id
 */
export async function removeFromSyncQueue(id) {
    try {
        const store = await getStore('syncQueue', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        // ignore
    }
}

/**
 * Clear sync queue.
 */
export async function clearSyncQueue() {
    try {
        const store = await getStore('syncQueue', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        // ignore
    }
}

// ==================== SECURITY VIOLATIONS ====================

/**
 * Save security violations array.
 * @param {Array} violations
 */
export async function saveSecurityViolations(violations) {
    try {
        const store = await getStore('security', 'readwrite');
        return new Promise((resolve, reject) => {
            // Store under fixed id 'violations'
            const request = store.put({ id: 'violations', data: violations, updatedAt: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.setLocalStorage('securityViolations', violations);
    }
}

/**
 * Get security violations.
 * @returns {Promise<Array>}
 */
export async function getSecurityViolations() {
    try {
        const store = await getStore('security', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get('violations');
            request.onsuccess = () => resolve(request.result?.data || []);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return utils.getLocalStorage('securityViolations', []);
    }
}

/**
 * Add a single security log entry.
 * @param {Object} logEntry
 */
export async function addSecurityLog(logEntry) {
    const entry = {
        ...logEntry,
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now()
    };
    try {
        const store = await getStore('security', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.add(entry);
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        const logs = utils.getLocalStorage('securityLogs', []);
        logs.push(entry);
        utils.setLocalStorage('securityLogs', logs.slice(-50));
    }
}

// ==================== LOCK STATUS ====================

/**
 * Save lock status.
 * @param {Object} lockStatus - { locked, reason, timestamp, details }
 */
export async function saveLockStatus(lockStatus) {
    try {
        const store = await getStore('security', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put({ id: 'lock', ...lockStatus });
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.setLocalStorage('lockStatus', lockStatus);
    }
}

/**
 * Get lock status.
 * @returns {Promise<Object|null>}
 */
export async function getLockStatus() {
    try {
        const store = await getStore('security', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get('lock');
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return utils.getLocalStorage('lockStatus', null);
    }
}

// ==================== ANALYTICS ====================

/**
 * Save user statistics.
 * @param {Object} stats
 */
export async function saveUserStatistics(stats) {
    try {
        const store = await getStore('analytics', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put({ id: 'userStats', ...stats, updatedAt: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.setLocalStorage('userStats', stats);
    }
}

/**
 * Get user statistics.
 * @returns {Promise<Object|null>}
 */
export async function getUserStatistics() {
    try {
        const store = await getStore('analytics', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get('userStats');
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return utils.getLocalStorage('userStats', null);
    }
}

// ==================== SETTINGS ====================

/**
 * Save a setting.
 * @param {string} key
 * @param {*} value
 */
export async function saveSetting(key, value) {
    try {
        const store = await getStore('settings', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.setLocalStorage(`setting_${key}`, value);
    }
}

/**
 * Get a setting.
 * @param {string} key
 * @param {*} defaultValue
 * @returns {Promise<*>}
 */
export async function getSetting(key, defaultValue = null) {
    try {
        const store = await getStore('settings', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result?.value ?? defaultValue);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return utils.getLocalStorage(`setting_${key}`, defaultValue);
    }
}

// ==================== CLEAR DATABASE ====================

/**
 * Clear all data (dangerous!).
 */
export async function clearDatabase() {
    try {
        const database = await initDatabase();
        const stores = database.objectStoreNames;
        const tx = database.transaction(stores, 'readwrite');
        return Promise.all(Array.from(stores).map(storeName => {
            return new Promise((resolve, reject) => {
                const store = tx.objectStore(storeName);
                const req = store.clear();
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        }));
    } catch (e) {
        localStorage.clear();
    }
}

// Initialize on module load (optional, but good practice)
initDatabase().catch(err => console.warn('DB init failed, will use fallbacks', err));
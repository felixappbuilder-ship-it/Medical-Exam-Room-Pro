// frontend-user/scripts/db.js

/**
 * IndexedDB Database Manager – OFFLINE SINGLE-USER VERSION
 * Provides persistent storage for user, exams, subscriptions, sync queue,
 * security logs, lock status, analytics, settings, questions, downloaded exams,
 * shared exams, and seen questions (for repetition prevention).
 * Falls back to localStorage when IndexedDB fails.
 */

import * as utils from './utils.js';

const DB_NAME = 'MedExamDB';
const DB_VERSION = 4;

let db = null;
let dbInitPromise = null;

export function initDatabase() {
    if (db) return Promise.resolve(db);
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('[DB] IndexedDB error:', event.target.error);
            reject(event.target.error);
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('[DB] Opened successfully');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.log('[DB] Upgrading schema to version', DB_VERSION);

            if (!db.objectStoreNames.contains('users')) {
                const userStore = db.createObjectStore('users', { keyPath: 'id' });
                userStore.createIndex('by_email', 'email', { unique: true });
                userStore.createIndex('by_phone', 'phone', { unique: true });
            }
            if (!db.objectStoreNames.contains('subscriptions')) {
                db.createObjectStore('subscriptions', { keyPath: 'userId' });
            }
            if (!db.objectStoreNames.contains('exams')) {
                const examStore = db.createObjectStore('exams', { keyPath: 'examId' });
                examStore.createIndex('by_date', 'date', { unique: false });
            }
            if (!db.objectStoreNames.contains('questions')) {
                const qStore = db.createObjectStore('questions', { keyPath: 'id' });
                qStore.createIndex('by_subject', 'subject', { unique: false });
                qStore.createIndex('by_topic', 'topic', { unique: false });
            }
            if (!db.objectStoreNames.contains('syncQueue')) {
                db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains('security')) {
                db.createObjectStore('security', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('analytics')) {
                db.createObjectStore('analytics', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains('sharedExams')) {
                const shareStore = db.createObjectStore('sharedExams', { keyPath: 'token' });
                shareStore.createIndex('by_expiry', 'expiry', { unique: false });
            }
        };
    });

    return dbInitPromise;
}

async function getStore(storeName, mode = 'readonly') {
    const database = await initDatabase();
    return database.transaction(storeName, mode).objectStore(storeName);
}

// ==================== USER OPERATIONS ====================

export async function saveUser(user) {
    if (!user || !user.id) return;
    try {
        const store = await getStore('users', 'readwrite');
        await new Promise((resolve, reject) => {
            const clearReq = store.clear();
            clearReq.onsuccess = resolve;
            clearReq.onerror = () => reject(clearReq.error);
        });
        return new Promise((resolve, reject) => {
            const request = store.put(user);
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        console.warn('[DB] saveUser failed, using localStorage fallback', e);
        utils.setLocalStorage('user', user);
    }
}

export async function getUser() {
    try {
        const store = await getStore('users', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const users = request.result;
                resolve(users.length > 0 ? users[0] : null);
            };
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        console.warn('[DB] getUser failed, using localStorage fallback', e);
        return utils.getLocalStorage('user', null);
    }
}

export async function getAllUsers() {
    try {
        const store = await getStore('users', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        const user = utils.getLocalStorage('user', null);
        return user ? [user] : [];
    }
}

export async function deleteAllUsers() {
    try {
        const store = await getStore('users', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.removeLocalStorage('user');
    }
}

// ==================== SUBSCRIPTION OPERATIONS ====================

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
        return last?.examId === examId ? last : null;
    }
}

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

// ==================== EXAM PROGRESS ====================

export async function saveExamProgress(progress) {
    if (!progress || !progress.examId) return;
    try {
        const store = await getStore('exams', 'readwrite');
        const key = `progress_${progress.examId}`;
        return new Promise((resolve, reject) => {
            const request = store.put({ ...progress, examId: key });
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        console.warn('saveExamProgress failed', e);
        utils.setLocalStorage(`exam_progress_${progress.examId}`, progress);
    }
}

export async function getExamProgress(examId) {
    try {
        const store = await getStore('exams', 'readonly');
        const key = `progress_${examId}`;
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return utils.getLocalStorage(`exam_progress_${examId}`, null);
    }
}

// ==================== SYNC QUEUE ====================

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
        console.warn('[DB] addToSyncQueue failed', e);
    }
}

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

export async function saveSecurityViolations(violations) {
    try {
        const store = await getStore('security', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put({ id: 'violations', data: violations, updatedAt: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.setLocalStorage('securityViolations', violations);
    }
}

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

// ==================== QUESTIONS ====================

export async function saveQuestions(questions) {
    if (!questions || !questions.length) return;
    try {
        const store = await getStore('questions', 'readwrite');
        const tx = store.transaction;
        return new Promise((resolve, reject) => {
            let completed = 0;
            questions.forEach(q => {
                const request = store.put(q);
                request.onsuccess = () => {
                    completed++;
                    if (completed === questions.length) resolve();
                };
                request.onerror = (err) => reject(err);
            });
        });
    } catch (e) {
        console.warn('[DB] saveQuestions failed', e);
    }
}

export async function getQuestions(query = {}) {
    try {
        const store = await getStore('questions', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                let results = request.result;
                if (query.subject) results = results.filter(q => q.subject === query.subject);
                if (query.topic) results = results.filter(q => q.topic === query.topic);
                if (query.difficulty !== undefined) results = results.filter(q => q.difficulty === query.difficulty);
                if (query.limit) results = results.slice(0, query.limit);
                resolve(results);
            };
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return [];
    }
}

export async function getQuestionById(id) {
    try {
        const store = await getStore('questions', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return null;
    }
}

export async function getAllQuestions() {
    try {
        const store = await getStore('questions', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return [];
    }
}

// ==================== DOWNLOADED EXAMS ====================

export async function getDownloadedExams() {
    try {
        const store = await getStore('analytics', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get('downloadedExams');
            request.onsuccess = () => resolve(request.result?.data || []);
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return utils.getLocalStorage('downloadedExams', []);
    }
}

export async function saveDownloadedExams(exams) {
    try {
        const store = await getStore('analytics', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put({ id: 'downloadedExams', data: exams, updatedAt: Date.now() });
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        utils.setLocalStorage('downloadedExams', exams);
    }
}

// ==================== SHARED EXAMS ====================

export async function saveSharedExam(token, examData, expiryHours = 24) {
    const expiry = Date.now() + expiryHours * 60 * 60 * 1000;
    try {
        const store = await getStore('sharedExams', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put({ token, examData, expiry });
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        console.warn('saveSharedExam failed', e);
    }
}

export async function getSharedExam(token) {
    try {
        const store = await getStore('sharedExams', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get(token);
            request.onsuccess = () => {
                const entry = request.result;
                if (entry && entry.expiry > Date.now()) {
                    resolve(entry.examData);
                } else if (entry) {
                    store.delete(token);
                    resolve(null);
                } else {
                    resolve(null);
                }
            };
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return null;
    }
}

export async function cleanupSharedExams() {
    try {
        const store = await getStore('sharedExams', 'readwrite');
        const now = Date.now();
        const index = store.index('by_expiry');
        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.upperBound(now));
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        // ignore
    }
}

// ==================== SEEN QUESTIONS ====================

export async function getSeenQuestions(subject, topic = null) {
    const key = topic ? `seen_${subject}_${topic}` : `seen_${subject}`;
    try {
        const store = await getStore('analytics', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => {
                const data = request.result;
                resolve(new Set(data?.ids || []));
            };
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        return new Set();
    }
}

export async function addSeenQuestions(subject, questionIds, topic = null) {
    const key = topic ? `seen_${subject}_${topic}` : `seen_${subject}`;
    try {
        const store = await getStore('analytics', 'readwrite');
        return new Promise((resolve, reject) => {
            const getReq = store.get(key);
            getReq.onsuccess = () => {
                const existing = getReq.result?.ids || [];
                const newSet = [...new Set([...existing, ...questionIds])];
                const putReq = store.put({ id: key, ids: newSet, updatedAt: Date.now() });
                putReq.onsuccess = () => resolve();
                putReq.onerror = (err) => reject(err);
            };
            getReq.onerror = (err) => reject(err);
        });
    } catch (e) {
        console.warn('Failed to add seen questions', e);
    }
}

export async function clearSeenQuestions(subject, topic = null) {
    const key = topic ? `seen_${subject}_${topic}` : `seen_${subject}`;
    try {
        const store = await getStore('analytics', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = (err) => reject(err);
        });
    } catch (e) {
        // ignore
    }
}

// ==================== CLEAR DATABASE ====================

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

// Auto‑initialize
initDatabase().catch(err => console.warn('[DB] Init failed, fallback to localStorage', err));
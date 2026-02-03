/**
 * db.js - IndexedDB Operations
 * Purpose: Local data storage, offline capability, exam results caching
 * Features: User profile storage, subscription info, exam results, sync queue
 */

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const DB_NAME = 'MedicalExamRoomProDB';
const DB_VERSION = 3; // Increment when schema changes

// Object Store Names
const STORES = {
    USERS: 'users',
    SUBSCRIPTIONS: 'subscriptions',
    EXAMS: 'exams',
    QUESTIONS: 'questions',
    SYNC_QUEUE: 'syncQueue',
    SETTINGS: 'settings',
    SECURITY: 'security',
    ANALYTICS: 'analytics',
    DEVICE_INFO: 'deviceInfo',
    PAYMENTS: 'payments'
};

// Indexes for faster queries
const INDEXES = {
    EXAMS: {
        BY_TIMESTAMP: 'timestamp',
        BY_SUBJECT: 'subject',
        BY_SCORE: 'score',
        BY_SYNC_STATUS: 'synced'
    },
    SYNC_QUEUE: {
        BY_PRIORITY: 'priority',
        BY_STATUS: 'status',
        BY_CREATED_AT: 'createdAt'
    },
    QUESTIONS: {
        BY_SUBJECT: 'subject',
        BY_TOPIC: 'topic',
        BY_DIFFICULTY: 'difficulty',
        BY_LAST_SEEN: 'lastSeen'
    }
};

// ============================================================================
// DATABASE CLASS
// ============================================================================

class MedicalExamDB {
    constructor() {
        this.db = null;
        this.isConnecting = false;
        this.connectionPromise = null;
        this.eventListeners = {};
        
        // Auto-initialize when loaded
        this.init();
    }
    
    // ============================================================================
    // DATABASE INITIALIZATION & CONNECTION
    // ============================================================================
    
    /**
     * Initialize database connection
     */
    async init() {
        if (this.db) return this.db;
        if (this.isConnecting) return this.connectionPromise;
        
        this.isConnecting = true;
        this.connectionPromise = this.connect();
        
        return this.connectionPromise;
    }
    
    /**
     * Establish connection to IndexedDB
     */
    async connect() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = (event) => {
                console.error('IndexedDB connection failed:', event.target.error);
                this.isConnecting = false;
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.isConnecting = false;
                console.log('IndexedDB connection established');
                
                // Set up database event handlers
                this.setupEventHandlers();
                
                // Check and upgrade if needed
                this.checkHealth().then(health => {
                    if (!health.healthy) {
                        console.warn('Database health check failed:', health.issues);
                    }
                });
                
                // Dispatch connection event
                this.dispatchEvent('connected', { db: this.db });
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                this.createObjectStores(db);
                this.createIndexes(db);
                console.log(`Database upgraded to version ${DB_VERSION}`);
            };
            
            request.onblocked = (event) => {
                console.warn('Database upgrade blocked by other connections');
                // Could notify user to close other tabs
            };
        });
    }
    
    /**
     * Create all object stores
     */
    createObjectStores(db) {
        // Users store
        if (!db.objectStoreNames.contains(STORES.USERS)) {
            const userStore = db.createObjectStore(STORES.USERS, { keyPath: 'id' });
            userStore.createIndex('email', 'email', { unique: true });
            userStore.createIndex('phone', 'phone', { unique: true });
            userStore.createIndex('lastLogin', 'lastLogin');
        }
        
        // Subscriptions store
        if (!db.objectStoreNames.contains(STORES.SUBSCRIPTIONS)) {
            const subStore = db.createObjectStore(STORES.SUBSCRIPTIONS, { keyPath: 'id' });
            subStore.createIndex('userId', 'userId');
            subStore.createIndex('expiryDate', 'expiryDate');
            subStore.createIndex('plan', 'plan');
            subStore.createIndex('isActive', 'isActive');
        }
        
        // Exams store
        if (!db.objectStoreNames.contains(STORES.EXAMS)) {
            const examStore = db.createObjectStore(STORES.EXAMS, { keyPath: 'id' });
            examStore.createIndex('userId', 'userId');
            examStore.createIndex('timestamp', 'timestamp');
            examStore.createIndex('subject', 'subject');
            examStore.createIndex('score', 'score');
            examStore.createIndex('synced', 'synced');
            examStore.createIndex('isCompleted', 'isCompleted');
        }
        
        // Questions store (cached question bank)
        if (!db.objectStoreNames.contains(STORES.QUESTIONS)) {
            const questionStore = db.createObjectStore(STORES.QUESTIONS, { keyPath: 'id' });
            questionStore.createIndex('subject', 'subject');
            questionStore.createIndex('topic', 'topic');
            questionStore.createIndex('difficulty', 'difficulty');
            questionStore.createIndex('lastSeen', 'lastSeen');
        }
        
        // Sync queue store
        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
            const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { 
                keyPath: 'id',
                autoIncrement: true 
            });
            syncStore.createIndex('type', 'type');
            syncStore.createIndex('status', 'status');
            syncStore.createIndex('priority', 'priority');
            syncStore.createIndex('createdAt', 'createdAt');
            syncStore.createIndex('retryCount', 'retryCount');
        }
        
        // Settings store
        if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
            const settingsStore = db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
            settingsStore.createIndex('category', 'category');
        }
        
        // Security store
        if (!db.objectStoreNames.contains(STORES.SECURITY)) {
            const securityStore = db.createObjectStore(STORES.SECURITY, { 
                keyPath: 'id',
                autoIncrement: true 
            });
            securityStore.createIndex('type', 'type');
            securityStore.createIndex('timestamp', 'timestamp');
            securityStore.createIndex('severity', 'severity');
        }
        
        // Analytics store
        if (!db.objectStoreNames.contains(STORES.ANALYTICS)) {
            const analyticsStore = db.createObjectStore(STORES.ANALYTICS, { keyPath: 'id' });
            analyticsStore.createIndex('date', 'date');
            analyticsStore.createIndex('type', 'type');
            analyticsStore.createIndex('userId', 'userId');
        }
        
        // Device info store
        if (!db.objectStoreNames.contains(STORES.DEVICE_INFO)) {
            db.createObjectStore(STORES.DEVICE_INFO, { keyPath: 'deviceId' });
        }
        
        // Payments store
        if (!db.objectStoreNames.contains(STORES.PAYMENTS)) {
            const paymentStore = db.createObjectStore(STORES.PAYMENTS, { keyPath: 'id' });
            paymentStore.createIndex('status', 'status');
            paymentStore.createIndex('timestamp', 'timestamp');
            paymentStore.createIndex('userId', 'userId');
        }
    }
    
    /**
     * Create performance indexes
     */
    createIndexes(db) {
        // Additional indexes can be added here if needed
        // Most indexes are created during object store creation
    }
    
    /**
     * Setup database event handlers
     */
    setupEventHandlers() {
        if (!this.db) return;
        
        this.db.onerror = (event) => {
            console.error('Database error:', event.target.error);
            this.dispatchEvent('error', { error: event.target.error });
        };
        
        this.db.onabort = (event) => {
            console.warn('Database transaction aborted');
            this.dispatchEvent('abort', { event });
        };
        
        this.db.onversionchange = (event) => {
            console.log('Database version change detected');
            this.db.close();
            this.db = null;
            this.dispatchEvent('versionchange', { event });
        };
    }
    
    /**
     * Get active database connection
     */
    async getConnection() {
        if (!this.db) {
            await this.init();
        }
        return this.db;
    }
    
    /**
     * Gracefully disconnect from database
     */
    async disconnect() {
        if (this.db) {
            this.db.close();
            this.db = null;
            console.log('Database disconnected');
            this.dispatchEvent('disconnected');
        }
    }
    
    /**
     * Check database health
     */
    async checkHealth() {
        try {
            const db = await this.getConnection();
            
            const health = {
                healthy: true,
                stores: [],
                issues: []
            };
            
            // Check if all stores exist
            const requiredStores = Object.values(STORES);
            for (const storeName of requiredStores) {
                if (db.objectStoreNames.contains(storeName)) {
                    health.stores.push({ name: storeName, exists: true });
                } else {
                    health.stores.push({ name: storeName, exists: false });
                    health.issues.push(`Missing store: ${storeName}`);
                    health.healthy = false;
                }
            }
            
            // Check if we can perform a simple read operation
            try {
                const transaction = db.transaction([STORES.SETTINGS], 'readonly');
                const store = transaction.objectStore(STORES.SETTINGS);
                const request = store.get('app_version');
                
                await new Promise((resolve, reject) => {
                    request.onsuccess = resolve;
                    request.onerror = reject;
                });
            } catch (error) {
                health.issues.push(`Read test failed: ${error.message}`);
                health.healthy = false;
            }
            
            return health;
        } catch (error) {
            return {
                healthy: false,
                issues: [`Connection failed: ${error.message}`]
            };
        }
    }
    
    // ============================================================================
    // USER OPERATIONS
    // ============================================================================
    
    /**
     * Save user profile
     */
    async saveUser(user) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.USERS], 'readwrite');
            const store = transaction.objectStore(STORES.USERS);
            
            // Add timestamps
            const now = Date.now();
            if (!user.createdAt) user.createdAt = now;
            user.updatedAt = now;
            
            const request = store.put(user);
            
            request.onsuccess = () => {
                console.log('User saved:', user.id);
                this.dispatchEvent('userSaved', { user });
                resolve(user);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get user by ID
     */
    async getUser(userId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.USERS], 'readonly');
            const store = transaction.objectStore(STORES.USERS);
            const request = store.get(userId);
            
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get user by email or phone
     */
    async getUserByEmailOrPhone(email, phone) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.USERS], 'readonly');
            const store = transaction.objectStore(STORES.USERS);
            
            // Try email index
            const emailIndex = store.index('email');
            const emailRequest = emailIndex.get(email);
            
            emailRequest.onsuccess = () => {
                if (emailRequest.result) {
                    resolve(emailRequest.result);
                    return;
                }
                
                // Try phone index if email not found
                const phoneIndex = store.index('phone');
                const phoneRequest = phoneIndex.get(phone);
                
                phoneRequest.onsuccess = () => {
                    resolve(phoneRequest.result || null);
                };
                
                phoneRequest.onerror = (event) => {
                    reject(event.target.error);
                };
            };
            
            emailRequest.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Update user profile
     */
    async updateUser(userId, updates) {
        const user = await this.getUser(userId);
        if (!user) throw new Error('User not found');
        
        // Merge updates
        const updatedUser = {
            ...user,
            ...updates,
            updatedAt: Date.now()
        };
        
        return await this.saveUser(updatedUser);
    }
    
    /**
     * Delete user account
     */
    async deleteUser(userId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.USERS], 'readwrite');
            const store = transaction.objectStore(STORES.USERS);
            const request = store.delete(userId);
            
            request.onsuccess = () => {
                console.log('User deleted:', userId);
                this.dispatchEvent('userDeleted', { userId });
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    // ============================================================================
    // SUBSCRIPTION OPERATIONS
    // ============================================================================
    
    /**
     * Save subscription info
     */
    async saveSubscription(subscription) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SUBSCRIPTIONS], 'readwrite');
            const store = transaction.objectStore(STORES.SUBSCRIPTIONS);
            
            // Ensure required fields
            if (!subscription.id) subscription.id = `sub_${Date.now()}`;
            subscription.updatedAt = Date.now();
            
            const request = store.put(subscription);
            
            request.onsuccess = () => {
                console.log('Subscription saved:', subscription.id);
                this.dispatchEvent('subscriptionSaved', { subscription });
                resolve(subscription);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get subscription by user ID
     */
    async getSubscription(userId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SUBSCRIPTIONS], 'readonly');
            const store = transaction.objectStore(STORES.SUBSCRIPTIONS);
            const index = store.index('userId');
            const request = index.getAll(userId);
            
            request.onsuccess = () => {
                // Return the most recent active subscription
                const subscriptions = request.result || [];
                const activeSub = subscriptions.find(sub => sub.isActive);
                resolve(activeSub || subscriptions[0] || null);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Update subscription
     */
    async updateSubscription(subscriptionId, updates) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SUBSCRIPTIONS], 'readwrite');
            const store = transaction.objectStore(STORES.SUBSCRIPTIONS);
            
            // Get current subscription
            const getRequest = store.get(subscriptionId);
            
            getRequest.onsuccess = () => {
                const current = getRequest.result;
                if (!current) {
                    reject(new Error('Subscription not found'));
                    return;
                }
                
                // Merge updates
                const updated = {
                    ...current,
                    ...updates,
                    updatedAt: Date.now()
                };
                
                // Save updated subscription
                const putRequest = store.put(updated);
                
                putRequest.onsuccess = () => {
                    console.log('Subscription updated:', subscriptionId);
                    this.dispatchEvent('subscriptionUpdated', { subscription: updated });
                    resolve(updated);
                };
                
                putRequest.onerror = (event) => {
                    reject(event.target.error);
                };
            };
            
            getRequest.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Check if user has active subscription
     */
    async hasActiveSubscription(userId) {
        const subscription = await this.getSubscription(userId);
        if (!subscription) return false;
        
        // Check if subscription is active and not expired
        const now = Date.now();
        const expiry = new Date(subscription.expiryDate).getTime();
        
        return subscription.isActive && expiry > now;
    }
    
    /**
     * Get subscription expiry time
     */
    async getSubscriptionExpiry(userId) {
        const subscription = await this.getSubscription(userId);
        if (!subscription) return null;
        
        return {
            expiryDate: subscription.expiryDate,
            timeRemaining: new Date(subscription.expiryDate).getTime() - Date.now(),
            isExpired: new Date(subscription.expiryDate).getTime() <= Date.now()
        };
    }
    
    // ============================================================================
    // EXAM OPERATIONS
    // ============================================================================
    
    /**
     * Save exam result (BLUEPRINT: Called from questions.js after exam)
     */
    async saveExamResult(examData) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.EXAMS], 'readwrite');
            const store = transaction.objectStore(STORES.EXAMS);
            
            // Ensure required fields
            if (!examData.id) examData.id = `exam_${Date.now()}`;
            if (!examData.timestamp) examData.timestamp = Date.now();
            if (!examData.synced) examData.synced = false;
            if (!examData.isCompleted) examData.isCompleted = true;
            
            const request = store.put(examData);
            
            request.onsuccess = () => {
                console.log('Exam result saved:', examData.id);
                this.dispatchEvent('examSaved', { exam: examData });
                
                // Add to sync queue for backend sync
                this.addToSyncQueue({
                    type: 'exam_result',
                    data: examData,
                    priority: 2 // Medium priority
                });
                
                resolve(examData);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get exam by ID
     */
    async getExam(examId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.EXAMS], 'readonly');
            const store = transaction.objectStore(STORES.EXAMS);
            const request = store.get(examId);
            
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get all exams for user
     */
    async getUserExams(userId, options = {}) {
        const db = await this.getConnection();
        const { limit = 50, offset = 0, subject = null, sortBy = 'timestamp', sortOrder = 'desc' } = options;
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.EXAMS], 'readonly');
            const store = transaction.objectStore(STORES.EXAMS);
            
            let request;
            
            if (subject) {
                // Filter by subject
                const index = store.index('subject');
                const keyRange = IDBKeyRange.only(subject);
                request = index.openCursor(keyRange);
            } else {
                // Get all exams
                const index = store.index('userId');
                const keyRange = IDBKeyRange.only(userId);
                request = index.openCursor(keyRange);
            }
            
            const exams = [];
            let count = 0;
            let skipped = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    // Apply offset
                    if (skipped < offset) {
                        skipped++;
                        cursor.continue();
                        return;
                    }
                    
                    // Apply limit
                    if (count < limit) {
                        exams.push(cursor.value);
                        count++;
                        cursor.continue();
                    } else {
                        // Sort results
                        exams.sort((a, b) => {
                            if (sortOrder === 'desc') {
                                return b[sortBy] - a[sortBy];
                            } else {
                                return a[sortBy] - b[sortBy];
                            }
                        });
                        
                        resolve({
                            exams,
                            total: exams.length,
                            hasMore: !!cursor
                        });
                    }
                } else {
                    // No more results
                    exams.sort((a, b) => {
                        if (sortOrder === 'desc') {
                            return b[sortBy] - a[sortBy];
                        } else {
                            return a[sortBy] - b[sortBy];
                        }
                    });
                    
                    resolve({
                        exams,
                        total: exams.length,
                        hasMore: false
                    });
                }
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get unsynced exams
     */
    async getUnsyncedExams(userId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.EXAMS], 'readonly');
            const store = transaction.objectStore(STORES.EXAMS);
            
            // Get exams for user that are not synced
            const index = store.index('userId');
            const keyRange = IDBKeyRange.only(userId);
            const request = index.openCursor(keyRange);
            
            const unsyncedExams = [];
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    if (!cursor.value.synced) {
                        unsyncedExams.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    resolve(unsyncedExams);
                }
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Mark exam as synced
     */
    async markExamAsSynced(examId) {
        return this.updateExam(examId, { synced: true });
    }
    
    /**
     * Update exam data
     */
    async updateExam(examId, updates) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.EXAMS], 'readwrite');
            const store = transaction.objectStore(STORES.EXAMS);
            
            const getRequest = store.get(examId);
            
            getRequest.onsuccess = () => {
                const exam = getRequest.result;
                if (!exam) {
                    reject(new Error('Exam not found'));
                    return;
                }
                
                const updatedExam = {
                    ...exam,
                    ...updates,
                    updatedAt: Date.now()
                };
                
                const putRequest = store.put(updatedExam);
                
                putRequest.onsuccess = () => {
                    console.log('Exam updated:', examId);
                    resolve(updatedExam);
                };
                
                putRequest.onerror = (event) => {
                    reject(event.target.error);
                };
            };
            
            getRequest.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Delete exam
     */
    async deleteExam(examId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.EXAMS], 'readwrite');
            const store = transaction.objectStore(STORES.EXAMS);
            const request = store.delete(examId);
            
            request.onsuccess = () => {
                console.log('Exam deleted:', examId);
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get exam statistics for user
     */
    async getExamStatistics(userId) {
        const exams = await this.getUserExams(userId, { limit: 1000 });
        
        const stats = {
            totalExams: exams.exams.length,
            totalQuestions: 0,
            correctAnswers: 0,
            averageScore: 0,
            totalTimeSpent: 0,
            bySubject: {},
            byDate: {},
            recentScores: []
        };
        
        exams.exams.forEach(exam => {
            // Basic stats
            stats.totalQuestions += exam.totalQuestions || 0;
            stats.correctAnswers += exam.correctAnswers || 0;
            stats.totalTimeSpent += exam.timeSpent || 0;
            
            // Subject stats
            const subject = exam.subject || 'Mixed';
            if (!stats.bySubject[subject]) {
                stats.bySubject[subject] = {
                    count: 0,
                    totalScore: 0,
                    totalQuestions: 0
                };
            }
            stats.bySubject[subject].count++;
            stats.bySubject[subject].totalScore += exam.score || 0;
            stats.bySubject[subject].totalQuestions += exam.totalQuestions || 0;
            
            // Date stats (YYYY-MM-DD format)
            const date = new Date(exam.timestamp).toISOString().split('T')[0];
            if (!stats.byDate[date]) {
                stats.byDate[date] = 0;
            }
            stats.byDate[date]++;
            
            // Recent scores (last 10 exams)
            if (stats.recentScores.length < 10) {
                stats.recentScores.push({
                    date: new Date(exam.timestamp).toLocaleDateString(),
                    score: exam.score || 0,
                    subject: exam.subject || 'Mixed'
                });
            }
        });
        
        // Calculate averages
        if (stats.totalExams > 0) {
            stats.averageScore = stats.correctAnswers / stats.totalQuestions * 100;
            stats.averageTimePerExam = stats.totalTimeSpent / stats.totalExams;
            stats.averageTimePerQuestion = stats.totalTimeSpent / stats.totalQuestions;
            
            // Calculate subject averages
            Object.keys(stats.bySubject).forEach(subject => {
                const subjStats = stats.bySubject[subject];
                subjStats.averageScore = subjStats.totalScore / subjStats.count;
                subjStats.averageQuestions = subjStats.totalQuestions / subjStats.count;
            });
        }
        
        return stats;
    }
    
    // ============================================================================
    // QUESTION CACHE OPERATIONS
    // ============================================================================
    
    /**
     * Cache questions for offline use (BLUEPRINT: Called from questions.js)
     */
    async cacheQuestions(subject, topic, questions) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.QUESTIONS], 'readwrite');
            const store = transaction.objectStore(STORES.QUESTIONS);
            
            // Prepare questions for caching
            const cachePromises = questions.map(question => {
                const cacheEntry = {
                    ...question,
                    cachedAt: Date.now(),
                    lastSeen: question.lastSeen || Date.now()
                };
                
                return new Promise((resolveStore, rejectStore) => {
                    const request = store.put(cacheEntry);
                    
                    request.onsuccess = () => resolveStore();
                    request.onerror = (event) => rejectStore(event.target.error);
                });
            });
            
            Promise.all(cachePromises)
                .then(() => {
                    console.log(`Cached ${questions.length} questions for ${subject}/${topic}`);
                    this.dispatchEvent('questionsCached', { 
                        subject, 
                        topic, 
                        count: questions.length 
                    });
                    resolve(questions.length);
                })
                .catch(reject);
        });
    }
    
    /**
     * Get cached questions by subject and topic
     */
    async getCachedQuestions(subject, topic) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.QUESTIONS], 'readonly');
            const store = transaction.objectStore(STORES.QUESTIONS);
            
            // Use subject and topic indexes
            const subjectIndex = store.index('subject');
            const subjectKeyRange = IDBKeyRange.only(subject);
            const request = subjectIndex.openCursor(subjectKeyRange);
            
            const questions = [];
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    if (cursor.value.topic === topic) {
                        questions.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    resolve(questions);
                }
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get question by ID from cache
     */
    async getCachedQuestion(questionId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.QUESTIONS], 'readonly');
            const store = transaction.objectStore(STORES.QUESTIONS);
            const request = store.get(questionId);
            
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Update question cache entry (e.g., update lastSeen)
     */
    async updateCachedQuestion(questionId, updates) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.QUESTIONS], 'readwrite');
            const store = transaction.objectStore(STORES.QUESTIONS);
            
            const getRequest = store.get(questionId);
            
            getRequest.onsuccess = () => {
                const question = getRequest.result;
                if (!question) {
                    reject(new Error('Question not found in cache'));
                    return;
                }
                
                const updatedQuestion = {
                    ...question,
                    ...updates
                };
                
                const putRequest = store.put(updatedQuestion);
                
                putRequest.onsuccess = () => {
                    resolve(updatedQuestion);
                };
                
                putRequest.onerror = (event) => {
                    reject(event.target.error);
                };
            };
            
            getRequest.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get cached question count by subject
     */
    async getCachedQuestionCount(subject = null) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.QUESTIONS], 'readonly');
            const store = transaction.objectStore(STORES.QUESTIONS);
            
            let request;
            
            if (subject) {
                const index = store.index('subject');
                const keyRange = IDBKeyRange.only(subject);
                request = index.count(keyRange);
            } else {
                request = store.count();
            }
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Clear question cache (for cleanup or updates)
     */
    async clearQuestionCache(subject = null, topic = null) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.QUESTIONS], 'readwrite');
            const store = transaction.objectStore(STORES.QUESTIONS);
            
            let request;
            
            if (subject && topic) {
                // Clear specific subject/topic
                const index = store.index('subject');
                const keyRange = IDBKeyRange.only(subject);
                request = index.openCursor(keyRange);
                
                const deletePromises = [];
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    
                    if (cursor) {
                        if (cursor.value.topic === topic) {
                            deletePromises.push(
                                new Promise((resolveDel, rejectDel) => {
                                    const deleteRequest = cursor.delete();
                                    deleteRequest.onsuccess = resolveDel;
                                    deleteRequest.onerror = rejectDel;
                                })
                            );
                        }
                        cursor.continue();
                    } else {
                        Promise.all(deletePromises)
                            .then(() => resolve(deletePromises.length))
                            .catch(reject);
                    }
                };
            } else if (subject) {
                // Clear all questions for subject
                const index = store.index('subject');
                const keyRange = IDBKeyRange.only(subject);
                request = index.openKeyCursor(keyRange);
                
                const deletePromises = [];
                
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    
                    if (cursor) {
                        deletePromises.push(
                            new Promise((resolveDel, rejectDel) => {
                                const deleteRequest = cursor.delete();
                                deleteRequest.onsuccess = resolveDel;
                                deleteRequest.onerror = rejectDel;
                            })
                        );
                        cursor.continue();
                    } else {
                        Promise.all(deletePromises)
                            .then(() => resolve(deletePromises.length))
                            .catch(reject);
                    }
                };
            } else {
                // Clear all questions
                request = store.clear();
                
                request.onsuccess = () => {
                    console.log('Question cache cleared');
                    resolve(true);
                };
            }
            
            if (request.onerror) {
                request.onerror = (event) => {
                    reject(event.target.error);
                };
            }
        });
    }
    
    // ============================================================================
    // SYNC QUEUE OPERATIONS
    // ============================================================================
    
    /**
     * Add item to sync queue
     */
    async addToSyncQueue(item) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SYNC_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORES.SYNC_QUEUE);
            
            // Ensure required fields
            const syncItem = {
                ...item,
                id: item.id || `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                status: 'pending',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                retryCount: 0,
                lastAttempt: null,
                error: null
            };
            
            const request = store.add(syncItem);
            
            request.onsuccess = () => {
                console.log('Added to sync queue:', syncItem.type);
                this.dispatchEvent('syncItemAdded', { item: syncItem });
                resolve(syncItem);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get pending sync items
     */
    async getPendingSyncItems(limit = 20) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SYNC_QUEUE], 'readonly');
            const store = transaction.objectStore(STORES.SYNC_QUEUE);
            const index = store.index('status');
            const keyRange = IDBKeyRange.only('pending');
            
            const request = index.openCursor(keyRange);
            const items = [];
            let count = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor && count < limit) {
                    items.push(cursor.value);
                    count++;
                    cursor.continue();
                } else {
                    // Sort by priority (higher priority first)
                    items.sort((a, b) => (b.priority || 0) - (a.priority || 0));
                    resolve(items);
                }
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Update sync item status
     */
    async updateSyncItem(itemId, updates) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SYNC_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORES.SYNC_QUEUE);
            
            const getRequest = store.get(itemId);
            
            getRequest.onsuccess = () => {
                const item = getRequest.result;
                if (!item) {
                    reject(new Error('Sync item not found'));
                    return;
                }
                
                const updatedItem = {
                    ...item,
                    ...updates,
                    updatedAt: Date.now()
                };
                
                // Increment retry count if status is still pending and we're updating due to error
                if (updates.status === 'pending' && updates.error) {
                    updatedItem.retryCount = (item.retryCount || 0) + 1;
                    updatedItem.lastAttempt = Date.now();
                }
                
                const putRequest = store.put(updatedItem);
                
                putRequest.onsuccess = () => {
                    console.log('Sync item updated:', itemId, updates.status);
                    resolve(updatedItem);
                };
                
                putRequest.onerror = (event) => {
                    reject(event.target.error);
                };
            };
            
            getRequest.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Delete sync item
     */
    async deleteSyncItem(itemId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SYNC_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORES.SYNC_QUEUE);
            const request = store.delete(itemId);
            
            request.onsuccess = () => {
                console.log('Sync item deleted:', itemId);
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Clear completed sync items (cleanup)
     */
    async clearCompletedSyncItems(olderThan = 7 * 24 * 60 * 60 * 1000) { // 7 days
        const db = await this.getConnection();
        const cutoffTime = Date.now() - olderThan;
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SYNC_QUEUE], 'readwrite');
            const store = transaction.objectStore(STORES.SYNC_QUEUE);
            const index = store.index('status');
            const keyRange = IDBKeyRange.only('completed');
            
            const request = index.openCursor(keyRange);
            const deletePromises = [];
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    // Delete if older than cutoff
                    if (cursor.value.updatedAt < cutoffTime) {
                        deletePromises.push(
                            new Promise((resolveDel, rejectDel) => {
                                const deleteRequest = cursor.delete();
                                deleteRequest.onsuccess = resolveDel;
                                deleteRequest.onerror = rejectDel;
                            })
                        );
                    }
                    cursor.continue();
                } else {
                    Promise.all(deletePromises)
                        .then(() => {
                            console.log(`Cleared ${deletePromises.length} completed sync items`);
                            resolve(deletePromises.length);
                        })
                        .catch(reject);
                }
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    // ============================================================================
    // SETTINGS OPERATIONS
    // ============================================================================
    
    /**
     * Save setting
     */
    async saveSetting(key, value, category = 'general') {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SETTINGS], 'readwrite');
            const store = transaction.objectStore(STORES.SETTINGS);
            
            const setting = {
                key,
                value,
                category,
                updatedAt: Date.now()
            };
            
            const request = store.put(setting);
            
            request.onsuccess = () => {
                resolve(setting);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get setting
     */
    async getSetting(key) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SETTINGS], 'readonly');
            const store = transaction.objectStore(STORES.SETTINGS);
            const request = store.get(key);
            
            request.onsuccess = () => {
                resolve(request.result ? request.result.value : null);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get all settings by category
     */
    async getSettingsByCategory(category) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SETTINGS], 'readonly');
            const store = transaction.objectStore(STORES.SETTINGS);
            const index = store.index('category');
            const keyRange = IDBKeyRange.only(category);
            const request = index.getAll(keyRange);
            
            request.onsuccess = () => {
                const settings = {};
                request.result.forEach(setting => {
                    settings[setting.key] = setting.value;
                });
                resolve(settings);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Delete setting
     */
    async deleteSetting(key) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SETTINGS], 'readwrite');
            const store = transaction.objectStore(STORES.SETTINGS);
            const request = store.delete(key);
            
            request.onsuccess = () => {
                resolve(true);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    // ============================================================================
    // SECURITY OPERATIONS
    // ============================================================================
    
    /**
     * Log security event
     */
    async logSecurityEvent(type, details, severity = 'medium') {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SECURITY], 'readwrite');
            const store = transaction.objectStore(STORES.SECURITY);
            
            const event = {
                type,
                details,
                severity,
                timestamp: Date.now(),
                deviceInfo: await this.getDeviceInfo(),
                resolved: false
            };
            
            const request = store.add(event);
            
            request.onsuccess = () => {
                console.log('Security event logged:', type, severity);
                this.dispatchEvent('securityEvent', { event });
                resolve(event);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get security events
     */
    async getSecurityEvents(limit = 100, severity = null) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.SECURITY], 'readonly');
            const store = transaction.objectStore(STORES.SECURITY);
            
            let request;
            
            if (severity) {
                const index = store.index('severity');
                const keyRange = IDBKeyRange.only(severity);
                request = index.openCursor(keyRange);
            } else {
                const index = store.index('timestamp');
                request = index.openCursor(null, 'prev'); // Newest first
            }
            
            const events = [];
            let count = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor && count < limit) {
                    events.push(cursor.value);
                    count++;
                    cursor.continue();
                } else {
                    resolve(events);
                }
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    // ============================================================================
    // DEVICE INFO OPERATIONS
    // ============================================================================
    
    /**
     * Save device information
     */
    async saveDeviceInfo(deviceInfo) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.DEVICE_INFO], 'readwrite');
            const store = transaction.objectStore(STORES.DEVICE_INFO);
            
            // Add timestamp
            deviceInfo.updatedAt = Date.now();
            
            const request = store.put(deviceInfo);
            
            request.onsuccess = () => {
                console.log('Device info saved:', deviceInfo.deviceId);
                resolve(deviceInfo);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get device information
     */
    async getDeviceInfo(deviceId = null) {
        const db = await this.getConnection();
        
        if (!deviceId) {
            // Generate a device ID based on browser fingerprint
            deviceId = await this.generateDeviceId();
        }
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.DEVICE_INFO], 'readonly');
            const store = transaction.objectStore(STORES.DEVICE_INFO);
            const request = store.get(deviceId);
            
            request.onsuccess = () => {
                resolve(request.result || { deviceId, firstSeen: Date.now() });
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Generate device ID
     */
    async generateDeviceId() {
        // Try to get existing device ID from localStorage
        let deviceId = localStorage.getItem('device_id');
        
        if (!deviceId) {
            // Generate a new device ID based on browser fingerprint
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
                hash = hash & hash; // Convert to 32-bit integer
            }
            
            deviceId = 'device_' + Math.abs(hash).toString(36);
            localStorage.setItem('device_id', deviceId);
        }
        
        return deviceId;
    }
    
    // ============================================================================
    // PAYMENT OPERATIONS
    // ============================================================================
    
    /**
     * Save payment record
     */
    async savePayment(payment) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.PAYMENTS], 'readwrite');
            const store = transaction.objectStore(STORES.PAYMENTS);
            
            // Ensure required fields
            if (!payment.id) payment.id = `pay_${Date.now()}`;
            if (!payment.timestamp) payment.timestamp = Date.now();
            
            const request = store.put(payment);
            
            request.onsuccess = () => {
                console.log('Payment saved:', payment.id);
                
                // Add to sync queue (high priority)
                this.addToSyncQueue({
                    type: 'payment',
                    data: payment,
                    priority: 1 // High priority
                });
                
                resolve(payment);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get payment by ID
     */
    async getPayment(paymentId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.PAYMENTS], 'readonly');
            const store = transaction.objectStore(STORES.PAYMENTS);
            const request = store.get(paymentId);
            
            request.onsuccess = () => {
                resolve(request.result || null);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get payments for user
     */
    async getUserPayments(userId) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.PAYMENTS], 'readonly');
            const store = transaction.objectStore(STORES.PAYMENTS);
            const index = store.index('userId');
            const keyRange = IDBKeyRange.only(userId);
            const request = index.getAll(keyRange);
            
            request.onsuccess = () => {
                resolve(request.result || []);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    // ============================================================================
    // ANALYTICS OPERATIONS
    // ============================================================================
    
    /**
     * Save analytics event
     */
    async saveAnalyticsEvent(type, data) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.ANALYTICS], 'readwrite');
            const store = transaction.objectStore(STORES.ANALYTICS);
            
            const event = {
                id: `analytics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type,
                data,
                date: new Date().toISOString().split('T')[0],
                timestamp: Date.now(),
                userId: await this.getCurrentUserId()
            };
            
            const request = store.put(event);
            
            request.onsuccess = () => {
                // Add to sync queue (low priority)
                this.addToSyncQueue({
                    type: 'analytics',
                    data: event,
                    priority: 4 // Low priority
                });
                
                resolve(event);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Get analytics events by type and date range
     */
    async getAnalyticsEvents(type = null, startDate = null, endDate = null) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.ANALYTICS], 'readonly');
            const store = transaction.objectStore(STORES.ANALYTICS);
            
            let request;
            
            if (type) {
                const index = store.index('type');
                const keyRange = IDBKeyRange.only(type);
                request = index.openCursor(keyRange);
            } else {
                request = store.openCursor();
            }
            
            const events = [];
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    // Filter by date range if provided
                    const eventDate = cursor.value.date;
                    if ((!startDate || eventDate >= startDate) && 
                        (!endDate || eventDate <= endDate)) {
                        events.push(cursor.value);
                    }
                    cursor.continue();
                } else {
                    resolve(events);
                }
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================
    
    /**
     * Get current user ID from localStorage
     */
    async getCurrentUserId() {
        // This would typically come from auth state
        // For now, check localStorage
        const userData = localStorage.getItem('current_user');
        if (userData) {
            try {
                const user = JSON.parse(userData);
                return user.id;
            } catch (e) {
                return null;
            }
        }
        return null;
    }
    
    /**
     * Clear all data (for testing or account deletion)
     */
    async clearAllData() {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([
                STORES.USERS,
                STORES.SUBSCRIPTIONS,
                STORES.EXAMS,
                STORES.QUESTIONS,
                STORES.SYNC_QUEUE,
                STORES.SETTINGS,
                STORES.SECURITY,
                STORES.ANALYTICS,
                STORES.DEVICE_INFO,
                STORES.PAYMENTS
            ], 'readwrite');
            
            const clearPromises = [];
            
            // Clear each store
            Object.values(STORES).forEach(storeName => {
                clearPromises.push(
                    new Promise((resolveStore, rejectStore) => {
                        const store = transaction.objectStore(storeName);
                        const request = store.clear();
                        
                        request.onsuccess = () => resolveStore(storeName);
                        request.onerror = (event) => rejectStore(event.target.error);
                    })
                );
            });
            
            transaction.oncomplete = () => {
                console.log('All data cleared');
                resolve(true);
            };
            
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            
            Promise.all(clearPromises).catch(reject);
        });
    }
    
    /**
     * Export all data (for backup or GDPR compliance)
     */
    async exportAllData() {
        const db = await this.getConnection();
        const exportData = {};
        
        // Export each store
        for (const [storeKey, storeName] of Object.entries(STORES)) {
            exportData[storeKey] = await this.exportStore(storeName);
        }
        
        return exportData;
    }
    
    /**
     * Export a single store
     */
    async exportStore(storeName) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => {
                resolve(request.result || []);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    /**
     * Import data (for restore)
     */
    async importData(importData) {
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(Object.values(STORES), 'readwrite');
            
            const importPromises = [];
            
            for (const [storeKey, data] of Object.entries(importData)) {
                const storeName = STORES[storeKey];
                if (storeName && Array.isArray(data)) {
                    const store = transaction.objectStore(storeName);
                    
                    data.forEach(item => {
                        importPromises.push(
                            new Promise((resolveItem, rejectItem) => {
                                const request = store.put(item);
                                request.onsuccess = () => resolveItem();
                                request.onerror = (event) => rejectItem(event.target.error);
                            })
                        );
                    });
                }
            }
            
            transaction.oncomplete = () => {
                console.log('Data import completed');
                resolve(true);
            };
            
            transaction.onerror = (event) => {
                reject(event.target.error);
            };
            
            Promise.all(importPromises).catch(reject);
        });
    }
    
    /**
     * Get database size estimate
     */
    async getDatabaseSize() {
        if (!navigator.storage || !navigator.storage.estimate) {
            return { estimate: 'Storage API not available' };
        }
        
        try {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                percentage: estimate.usage && estimate.quota ? 
                    (estimate.usage / estimate.quota * 100).toFixed(2) + '%' : 'N/A'
            };
        } catch (error) {
            return { error: error.message };
        }
    }
    
    /**
     * Cleanup old data
     */
    async cleanupOldData(daysToKeep = 90) {
        const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
        let deletedCount = 0;
        
        // Clean old exams
        const db = await this.getConnection();
        
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORES.EXAMS], 'readwrite');
            const store = transaction.objectStore(STORES.EXAMS);
            const index = store.index('timestamp');
            const keyRange = IDBKeyRange.upperBound(cutoffTime);
            
            const request = index.openCursor(keyRange);
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    console.log(`Cleaned up ${deletedCount} old exams`);
                    resolve(deletedCount);
                }
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }
    
    // ============================================================================
    // EVENT HANDLING
    // ============================================================================
    
    /**
     * Add event listener
     */
    addEventListener(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }
    
    /**
     * Remove event listener
     */
    removeEventListener(event, callback) {
        if (!this.eventListeners[event]) return;
        
        const index = this.eventListeners[event].indexOf(callback);
        if (index > -1) {
            this.eventListeners[event].splice(index, 1);
        }
    }
    
    /**
     * Dispatch event to listeners
     */
    dispatchEvent(event, data = {}) {
        if (!this.eventListeners[event]) return;
        
        this.eventListeners[event].forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
            }
        });
    }
}

// ============================================================================
// GLOBAL INSTANCE & EXPORTS
// ============================================================================

// Create global instance
const MedicalExamDBInstance = new MedicalExamDB();

// Make it available globally
window.MedicalExamDB = MedicalExamDBInstance;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MedicalExamDBInstance;
}

// Auto-initialize and expose common functions
document.addEventListener('DOMContentLoaded', async () => {
    console.log('MedicalExamDB module loaded');
    
    // Initialize database
    await MedicalExamDBInstance.init();
    
    // Expose commonly used functions to window for easy access
    window.saveExamResult = (examData) => MedicalExamDBInstance.saveExamResult(examData);
    window.getExamStatistics = (userId) => MedicalExamDBInstance.getExamStatistics(userId);
    window.saveSetting = (key, value) => MedicalExamDBInstance.saveSetting(key, value);
    window.getSetting = (key) => MedicalExamDBInstance.getSetting(key);
    
    // Dispatch ready event
    const event = new CustomEvent('databaseReady', {
        detail: { db: MedicalExamDBInstance }
    });
    document.dispatchEvent(event);
});

console.log('db.js loaded successfully - Medical Exam Room Pro Database Manager');
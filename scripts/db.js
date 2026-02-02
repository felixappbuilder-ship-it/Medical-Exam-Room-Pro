// scripts/db.js

/**
 * Database Manager for Medical Exam Room Pro
 * IndexedDB implementation for offline functionality
 * 
 * Features implemented:
 * - User profile storage
 * - Exam results caching
 * - Question bank storage
 * - Sync queue management
 * - Device fingerprint storage
 * - Security logs
 * - Cleanup of old data
 */

class DatabaseManager {
    constructor() {
        this.dbName = 'MedicalExamRoomPro';
        this.dbVersion = 3;
        this.db = null;
        this.isInitialized = false;
        
        // Database schemas
        this.schemas = {
            users: { keyPath: 'id', autoIncrement: false },
            subscriptions: { keyPath: 'id', autoIncrement: false },
            exams: { keyPath: 'examId', autoIncrement: false },
            questions: { keyPath: 'id', autoIncrement: false },
            syncQueue: { keyPath: 'syncId', autoIncrement: true },
            settings: { keyPath: 'key', autoIncrement: false },
            security: { keyPath: 'id', autoIncrement: true },
            analytics: { keyPath: 'id', autoIncrement: true }
        };
        
        // Initialize database
        this.init();
    }
    
    /**
     * Initialize the database
     */
    async init() {
        return new Promise((resolve, reject) => {
            if (this.isInitialized) {
                resolve(this.db);
                return;
            }
            
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = (event) => {
                console.error('Database initialization failed:', event.target.error);
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.isInitialized = true;
                console.log('Database initialized successfully');
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                this.db = event.target.result;
                this.createStores(event.target.result);
                console.log('Database upgrade completed');
            };
        });
    }
    
    /**
     * Create all object stores
     */
    createStores(db) {
        // Create or upgrade object stores
        Object.entries(this.schemas).forEach(([storeName, options]) => {
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, options);
                console.log(`Created store: ${storeName}`);
            }
        });
        
        // Create indexes for better querying
        this.createIndexes(db);
    }
    
    /**
     * Create indexes for efficient querying
     */
    createIndexes(db) {
        // Exams store indexes
        const examStore = db.transaction(['exams'], 'readwrite').objectStore('exams');
        if (!examStore.indexNames.contains('userId')) {
            examStore.createIndex('userId', 'userId', { unique: false });
        }
        if (!examStore.indexNames.contains('completedAt')) {
            examStore.createIndex('completedAt', 'completedAt', { unique: false });
        }
        if (!examStore.indexNames.contains('subject')) {
            examStore.createIndex('subject', 'subject', { unique: false });
        }
        
        // Questions store indexes
        const questionStore = db.transaction(['questions'], 'readwrite').objectStore('questions');
        if (!questionStore.indexNames.contains('subject')) {
            questionStore.createIndex('subject', 'subject', { unique: false });
        }
        if (!questionStore.indexNames.contains('topic')) {
            questionStore.createIndex('topic', 'topic', { unique: false });
        }
        if (!questionStore.indexNames.contains('difficulty')) {
            questionStore.createIndex('difficulty', 'difficulty', { unique: false });
        }
        
        // Sync queue indexes
        const syncStore = db.transaction(['syncQueue'], 'readwrite').objectStore('syncQueue');
        if (!syncStore.indexNames.contains('status')) {
            syncStore.createIndex('status', 'status', { unique: false });
        }
        if (!syncStore.indexNames.contains('type')) {
            syncStore.createIndex('type', 'type', { unique: false });
        }
        if (!syncStore.indexNames.contains('createdAt')) {
            syncStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
        
        // Users store indexes
        const userStore = db.transaction(['users'], 'readwrite').objectStore('users');
        if (!userStore.indexNames.contains('email')) {
            userStore.createIndex('email', 'email', { unique: true });
        }
        if (!userStore.indexNames.contains('phone')) {
            userStore.createIndex('phone', 'phone', { unique: true });
        }
        
        // Security store indexes
        const securityStore = db.transaction(['security'], 'readwrite').objectStore('security');
        if (!securityStore.indexNames.contains('userId')) {
            securityStore.createIndex('userId', 'userId', { unique: false });
        }
        if (!securityStore.indexNames.contains('eventType')) {
            securityStore.createIndex('eventType', 'eventType', { unique: false });
        }
        if (!securityStore.indexNames.contains('timestamp')) {
            securityStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
    }
    
    /**
     * Generic database operation
     */
    async operation(storeName, mode, operation) {
        await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], mode);
            const store = transaction.objectStore(storeName);
            
            transaction.onerror = (event) => {
                console.error(`Transaction error for ${storeName}:`, event.target.error);
                reject(event.target.error);
            };
            
            const request = operation(store);
            
            request.onsuccess = (event) => {
                resolve(event.target.result);
            };
            
            request.onerror = (event) => {
                console.error(`Operation error for ${storeName}:`, event.target.error);
                reject(event.target.error);
            };
        });
    }
    
    // ==================== USER OPERATIONS ====================
    
    /**
     * Save user profile
     */
    async saveUser(user) {
        if (!user.id) {
            user.id = 'user_' + Date.now();
        }
        
        user.updatedAt = new Date().toISOString();
        if (!user.createdAt) {
            user.createdAt = user.updatedAt;
        }
        
        await this.operation('users', 'readwrite', (store) => {
            return store.put(user);
        });
        
        return user;
    }
    
    /**
     * Get user by ID
     */
    async getUser(userId) {
        return await this.operation('users', 'readonly', (store) => {
            return store.get(userId);
        });
    }
    
    /**
     * Get user by email
     */
    async getUserByEmail(email) {
        return await this.operation('users', 'readonly', (store) => {
            const index = store.index('email');
            return index.get(email);
        });
    }
    
    /**
     * Get user by phone
     */
    async getUserByPhone(phone) {
        return await this.operation('users', 'readonly', (store) => {
            const index = store.index('phone');
            return index.get(phone);
        });
    }
    
    /**
     * Update user profile
     */
    async updateUser(userId, updates) {
        const user = await this.getUser(userId);
        if (!user) {
            throw new Error('User not found');
        }
        
        Object.assign(user, updates, { updatedAt: new Date().toISOString() });
        
        await this.operation('users', 'readwrite', (store) => {
            return store.put(user);
        });
        
        return user;
    }
    
    /**
     * Delete user
     */
    async deleteUser(userId) {
        await this.operation('users', 'readwrite', (store) => {
            return store.delete(userId);
        });
    }
    
    // ==================== SUBSCRIPTION OPERATIONS ====================
    
    /**
     * Save subscription
     */
    async saveSubscription(subscription) {
        if (!subscription.id) {
            subscription.id = 'sub_' + Date.now();
        }
        
        subscription.updatedAt = new Date().toISOString();
        if (!subscription.createdAt) {
            subscription.createdAt = subscription.updatedAt;
        }
        
        await this.operation('subscriptions', 'readwrite', (store) => {
            return store.put(subscription);
        });
        
        return subscription;
    }
    
    /**
     * Get subscription by ID
     */
    async getSubscription(subscriptionId) {
        return await this.operation('subscriptions', 'readonly', (store) => {
            return store.get(subscriptionId);
        });
    }
    
    /**
     * Get user's active subscription
     */
    async getUserSubscription(userId) {
        return await this.operation('subscriptions', 'readonly', (store) => {
            return store.get(userId);
        });
    }
    
    /**
     * Update subscription
     */
    async updateSubscription(subscriptionId, updates) {
        const subscription = await this.getSubscription(subscriptionId);
        if (!subscription) {
            throw new Error('Subscription not found');
        }
        
        Object.assign(subscription, updates, { updatedAt: new Date().toISOString() });
        
        await this.operation('subscriptions', 'readwrite', (store) => {
            return store.put(subscription);
        });
        
        return subscription;
    }
    
    /**
     * Delete subscription
     */
    async deleteSubscription(subscriptionId) {
        await this.operation('subscriptions', 'readwrite', (store) => {
            return store.delete(subscriptionId);
        });
    }
    
    /**
     * Check if user has active subscription
     */
    async hasActiveSubscription(userId) {
        const subscription = await this.getUserSubscription(userId);
        if (!subscription) return false;
        
        const now = new Date();
        const expiry = new Date(subscription.expiryDate);
        
        return subscription.isActive && expiry > now;
    }
    
    // ==================== EXAM OPERATIONS ====================
    
    /**
     * Save exam results
     */
    async saveExamResults(examData) {
        if (!examData.examId) {
            examData.examId = 'exam_' + Date.now();
        }
        
        examData.completedAt = examData.completedAt || new Date().toISOString();
        examData.savedAt = new Date().toISOString();
        examData.isSynced = examData.isSynced || false;
        
        // Calculate score if not provided
        if (typeof examData.score === 'undefined') {
            const correctAnswers = examData.questions?.filter(q => q.isCorrect).length || 0;
            const totalQuestions = examData.questions?.length || examData.totalQuestions || 1;
            examData.score = Math.round((correctAnswers / totalQuestions) * 100);
            examData.correctAnswers = correctAnswers;
            examData.totalQuestions = totalQuestions;
        }
        
        await this.operation('exams', 'readwrite', (store) => {
            return store.put(examData);
        });
        
        // Add to sync queue if not synced
        if (!examData.isSynced) {
            await this.addToSyncQueue({
                type: 'exam_results',
                data: examData,
                examId: examData.examId,
                userId: examData.userId
            });
        }
        
        return examData;
    }
    
    /**
     * Get exam results by ID
     */
    async getExamResults(examId) {
        return await this.operation('exams', 'readonly', (store) => {
            return store.get(examId);
        });
    }
    
    /**
     * Get all exams for a user
     */
    async getUserExams(userId, limit = 50, offset = 0) {
        return await this.operation('exams', 'readonly', (store) => {
            const index = store.index('userId');
            const range = IDBKeyRange.only(userId);
            const request = index.getAll(range);
            
            return request;
        }).then(exams => {
            // Sort by completion date (newest first)
            exams.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
            // Apply pagination
            return exams.slice(offset, offset + limit);
        });
    }
    
    /**
     * Get exams by subject
     */
    async getExamsBySubject(userId, subject, limit = 20) {
        return await this.operation('exams', 'readonly', (store) => {
            const subjectIndex = store.index('subject');
            const subjectRange = IDBKeyRange.only(subject);
            const subjectRequest = subjectIndex.getAll(subjectRange);
            
            return subjectRequest;
        }).then(exams => {
            // Filter by user and sort
            return exams
                .filter(exam => exam.userId === userId)
                .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
                .slice(0, limit);
        });
    }
    
    /**
     * Get recent exams
     */
    async getRecentExams(userId, limit = 10) {
        return await this.getUserExams(userId, limit, 0);
    }
    
    /**
     * Delete exam
     */
    async deleteExam(examId) {
        await this.operation('exams', 'readwrite', (store) => {
            return store.delete(examId);
        });
    }
    
    /**
     * Mark exam as synced
     */
    async markExamAsSynced(examId) {
        const exam = await this.getExamResults(examId);
        if (exam) {
            exam.isSynced = true;
            exam.syncedAt = new Date().toISOString();
            await this.saveExamResults(exam);
        }
    }
    
    // ==================== QUESTION BANK OPERATIONS ====================
    
    /**
     * Save question to local bank
     */
    async saveQuestion(question) {
        if (!question.id) {
            throw new Error('Question must have an id');
        }
        
        question.cachedAt = new Date().toISOString();
        
        await this.operation('questions', 'readwrite', (store) => {
            return store.put(question);
        });
        
        return question;
    }
    
    /**
     * Save multiple questions
     */
    async saveQuestions(questions) {
        const promises = questions.map(question => this.saveQuestion(question));
        return Promise.all(promises);
    }
    
    /**
     * Get question by ID
     */
    async getQuestion(questionId) {
        return await this.operation('questions', 'readonly', (store) => {
            return store.get(questionId);
        });
    }
    
    /**
     * Get questions by subject
     */
    async getQuestionsBySubject(subject, limit = 100) {
        return await this.operation('questions', 'readonly', (store) => {
            const index = store.index('subject');
            const range = IDBKeyRange.only(subject);
            return index.getAll(range, limit);
        });
    }
    
    /**
     * Get questions by topic
     */
    async getQuestionsByTopic(subject, topic, limit = 50) {
        const allQuestions = await this.getQuestionsBySubject(subject, 500);
        return allQuestions
            .filter(q => q.topic === topic)
            .slice(0, limit);
    }
    
    /**
     * Get questions by difficulty
     */
    async getQuestionsByDifficulty(difficulty, limit = 50) {
        return await this.operation('questions', 'readonly', (store) => {
            const index = store.index('difficulty');
            const range = IDBKeyRange.only(difficulty);
            return index.getAll(range, limit);
        });
    }
    
    /**
     * Get random questions
     */
    async getRandomQuestions(count = 10, subject = null, topic = null, difficulty = null) {
        let questions = [];
        
        if (subject) {
            questions = await this.getQuestionsBySubject(subject, 500);
            if (topic) {
                questions = questions.filter(q => q.topic === topic);
            }
            if (difficulty) {
                questions = questions.filter(q => q.difficulty === difficulty);
            }
        } else {
            // Get all questions (limited to prevent memory issues)
            questions = await this.operation('questions', 'readonly', (store) => {
                return store.getAll(null, 1000);
            });
        }
        
        // Shuffle and take requested count
        const shuffled = questions.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, Math.min(count, shuffled.length));
    }
    
    /**
     * Get question count by subject
     */
    async getQuestionCountBySubject(subject) {
        const questions = await this.getQuestionsBySubject(subject);
        return questions.length;
    }
    
    /**
     * Clear question cache
     */
    async clearQuestionCache() {
        await this.operation('questions', 'readwrite', (store) => {
            return store.clear();
        });
    }
    
    /**
     * Check if question bank is cached
     */
    async isQuestionBankCached() {
        const count = await this.operation('questions', 'readonly', (store) => {
            return store.count();
        });
        return count > 1000; // Assuming at least 1000 questions means bank is cached
    }
    
    // ==================== SYNC QUEUE OPERATIONS ====================
    
    /**
     * Add item to sync queue
     */
    async addToSyncQueue(syncItem) {
        if (!syncItem.type) {
            throw new Error('Sync item must have a type');
        }
        
        syncItem.status = 'pending';
        syncItem.createdAt = new Date().toISOString();
        syncItem.attempts = 0;
        syncItem.lastAttempt = null;
        syncItem.error = null;
        
        await this.operation('syncQueue', 'readwrite', (store) => {
            return store.add(syncItem);
        });
        
        return syncItem;
    }
    
    /**
     * Get pending sync items
     */
    async getPendingSyncItems(limit = 20) {
        return await this.operation('syncQueue', 'readonly', (store) => {
            const index = store.index('status');
            const range = IDBKeyRange.only('pending');
            return index.getAll(range, limit);
        });
    }
    
    /**
     * Get sync items by type
     */
    async getSyncItemsByType(type, status = null, limit = 50) {
        return await this.operation('syncQueue', 'readonly', (store) => {
            const index = store.index('type');
            const range = IDBKeyRange.only(type);
            const request = index.getAll(range, limit);
            
            return request;
        }).then(items => {
            if (status) {
                return items.filter(item => item.status === status);
            }
            return items;
        });
    }
    
    /**
     * Update sync item status
     */
    async updateSyncItemStatus(syncId, status, error = null) {
        const syncItem = await this.operation('syncQueue', 'readonly', (store) => {
            return store.get(syncId);
        });
        
        if (!syncItem) {
            throw new Error('Sync item not found');
        }
        
        syncItem.status = status;
        syncItem.lastAttempt = new Date().toISOString();
        syncItem.attempts = (syncItem.attempts || 0) + 1;
        
        if (error) {
            syncItem.error = error.message || String(error);
        }
        
        if (status === 'completed') {
            syncItem.completedAt = new Date().toISOString();
        }
        
        await this.operation('syncQueue', 'readwrite', (store) => {
            return store.put(syncItem);
        });
        
        return syncItem;
    }
    
    /**
     * Remove completed sync items
     */
    async removeCompletedSyncItems(daysOld = 7) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysOld);
        
        const allItems = await this.operation('syncQueue', 'readonly', (store) => {
            return store.getAll();
        });
        
        const itemsToDelete = allItems.filter(item => {
            return item.status === 'completed' && 
                   new Date(item.completedAt) < cutoffDate;
        });
        
        const deletePromises = itemsToDelete.map(item => {
            return this.operation('syncQueue', 'readwrite', (store) => {
                return store.delete(item.syncId);
            });
        });
        
        await Promise.all(deletePromises);
        return itemsToDelete.length;
    }
    
    /**
     * Clear sync queue
     */
    async clearSyncQueue() {
        await this.operation('syncQueue', 'readwrite', (store) => {
            return store.clear();
        });
    }
    
    // ==================== SETTINGS OPERATIONS ====================
    
    /**
     * Save setting
     */
    async saveSetting(key, value) {
        const setting = {
            key: key,
            value: value,
            updatedAt: new Date().toISOString()
        };
        
        await this.operation('settings', 'readwrite', (store) => {
            return store.put(setting);
        });
        
        return setting;
    }
    
    /**
     * Get setting
     */
    async getSetting(key) {
        const setting = await this.operation('settings', 'readonly', (store) => {
            return store.get(key);
        });
        
        return setting ? setting.value : null;
    }
    
    /**
     * Delete setting
     */
    async deleteSetting(key) {
        await this.operation('settings', 'readwrite', (store) => {
            return store.delete(key);
        });
    }
    
    /**
     * Get all settings
     */
    async getAllSettings() {
        const settings = await this.operation('settings', 'readonly', (store) => {
            return store.getAll();
        });
        
        const result = {};
        settings.forEach(setting => {
            result[setting.key] = setting.value;
        });
        
        return result;
    }
    
    // ==================== SECURITY OPERATIONS ====================
    
    /**
     * Log security event
     */
    async logSecurityEvent(event) {
        if (!event.type) {
            throw new Error('Security event must have a type');
        }
        
        event.timestamp = new Date().toISOString();
        event.id = 'sec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Clean up old events if we have too many
        const eventCount = await this.operation('security', 'readonly', (store) => {
            return store.count();
        });
        
        if (eventCount > 1000) {
            await this.cleanupOldSecurityEvents(500);
        }
        
        await this.operation('security', 'readwrite', (store) => {
            return store.add(event);
        });
        
        return event;
    }
    
    /**
     * Get security events
     */
    async getSecurityEvents(limit = 100, offset = 0, userId = null, eventType = null) {
        return await this.operation('security', 'readonly', (store) => {
            return store.getAll();
        }).then(events => {
            // Apply filters
            let filtered = events;
            
            if (userId) {
                filtered = filtered.filter(event => event.userId === userId);
            }
            
            if (eventType) {
                filtered = filtered.filter(event => event.type === eventType);
            }
            
            // Sort by timestamp (newest first)
            filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            // Apply pagination
            return filtered.slice(offset, offset + limit);
        });
    }
    
    /**
     * Clean up old security events
     */
    async cleanupOldSecurityEvents(keepCount = 500) {
        const allEvents = await this.getSecurityEvents(1000);
        
        if (allEvents.length <= keepCount) {
            return 0;
        }
        
        const eventsToDelete = allEvents.slice(keepCount);
        const deletePromises = eventsToDelete.map(event => {
            return this.operation('security', 'readwrite', (store) => {
                return store.delete(event.id);
            });
        });
        
        await Promise.all(deletePromises);
        return eventsToDelete.length;
    }
    
    // ==================== ANALYTICS OPERATIONS ====================
    
    /**
     * Save analytics data
     */
    async saveAnalytics(data) {
        if (!data.type) {
            throw new Error('Analytics data must have a type');
        }
        
        data.timestamp = new Date().toISOString();
        data.id = 'ana_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        await this.operation('analytics', 'readwrite', (store) => {
            return store.add(data);
        });
        
        return data;
    }
    
    /**
     * Get analytics data
     */
    async getAnalytics(type = null, startDate = null, endDate = null, limit = 100) {
        return await this.operation('analytics', 'readonly', (store) => {
            return store.getAll();
        }).then(data => {
            // Apply filters
            let filtered = data;
            
            if (type) {
                filtered = filtered.filter(item => item.type === type);
            }
            
            if (startDate) {
                const start = new Date(startDate);
                filtered = filtered.filter(item => new Date(item.timestamp) >= start);
            }
            
            if (endDate) {
                const end = new Date(endDate);
                filtered = filtered.filter(item => new Date(item.timestamp) <= end);
            }
            
            // Sort by timestamp (newest first)
            filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            // Apply limit
            return filtered.slice(0, limit);
        });
    }
    
    // ==================== UTILITY METHODS ====================
    
    /**
     * Get database statistics
     */
    async getStats() {
        const stats = {};
        
        for (const storeName of Object.keys(this.schemas)) {
            const count = await this.operation(storeName, 'readonly', (store) => {
                return store.count();
            });
            stats[storeName] = count;
        }
        
        return stats;
    }
    
    /**
     * Clear all data (for testing/reset)
     */
    async clearAll() {
        for (const storeName of Object.keys(this.schemas)) {
            await this.operation(storeName, 'readwrite', (store) => {
                return store.clear();
            });
        }
        
        console.log('All database stores cleared');
    }
    
    /**
     * Export all data as JSON
     */
    async exportData() {
        const exportData = {};
        
        for (const storeName of Object.keys(this.schemas)) {
            const data = await this.operation(storeName, 'readonly', (store) => {
                return store.getAll();
            });
            exportData[storeName] = data;
        }
        
        return exportData;
    }
    
    /**
     * Import data from JSON
     */
    async importData(data) {
        for (const [storeName, items] of Object.entries(data)) {
            if (this.schemas[storeName]) {
                for (const item of items) {
                    await this.operation(storeName, 'readwrite', (store) => {
                        return store.put(item);
                    });
                }
            }
        }
        
        console.log('Data imported successfully');
    }
    
    /**
     * Backup database
     */
    async backup() {
        const data = await this.exportData();
        const backup = {
            timestamp: new Date().toISOString(),
            dbName: this.dbName,
            dbVersion: this.dbVersion,
            data: data
        };
        
        return backup;
    }
    
    /**
     * Restore from backup
     */
    async restore(backup) {
        if (backup.dbName !== this.dbName) {
            throw new Error('Backup is for a different database');
        }
        
        await this.clearAll();
        await this.importData(backup.data);
        
        console.log('Database restored from backup');
    }
    
    /**
     * Get storage usage estimate
     */
    async getStorageUsage() {
        if (!navigator.storage || !navigator.storage.estimate) {
            return null;
        }
        
        try {
            const estimate = await navigator.storage.estimate();
            return {
                usage: estimate.usage,
                quota: estimate.quota,
                percentage: estimate.quota ? (estimate.usage / estimate.quota) * 100 : 0
            };
        } catch (error) {
            console.error('Error estimating storage:', error);
            return null;
        }
    }
    
    /**
     * Clean up old data
     */
    async cleanupOldData() {
        const cleanupResults = {
            exams: 0,
            syncQueue: 0,
            security: 0,
            analytics: 0
        };
        
        // Clean up old exams (keep last 100)
        const allExams = await this.operation('exams', 'readonly', (store) => {
            return store.getAll();
        });
        
        if (allExams.length > 100) {
            const examsToDelete = allExams
                .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
                .slice(100);
            
            for (const exam of examsToDelete) {
                await this.deleteExam(exam.examId);
                cleanupResults.exams++;
            }
        }
        
        // Clean up old sync queue items (completed more than 30 days ago)
        cleanupResults.syncQueue = await this.removeCompletedSyncItems(30);
        
        // Clean up old security events (keep 500)
        cleanupResults.security = await this.cleanupOldSecurityEvents(500);
        
        // Clean up old analytics (keep 1000)
        const allAnalytics = await this.getAnalytics(null, null, null, 2000);
        if (allAnalytics.length > 1000) {
            const analyticsToDelete = allAnalytics.slice(1000);
            for (const analytic of analyticsToDelete) {
                await this.operation('analytics', 'readwrite', (store) => {
                    return store.delete(analytic.id);
                });
                cleanupResults.analytics++;
            }
        }
        
        console.log('Cleanup completed:', cleanupResults);
        return cleanupResults;
    }
}

// Create global instance
const db = new DatabaseManager();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = db;
}
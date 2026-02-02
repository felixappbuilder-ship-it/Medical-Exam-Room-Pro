// offline.js - Offline functionality (basic for Phase 1)
class OfflineManager {
    constructor() {
        this.isOnline = navigator.onLine;
        this.offlineQueue = [];
        this.syncInterval = null;
        this.maxQueueSize = 100;
        
        this.init();
    }

    // Initialize offline manager
    init() {
        // Set up network event listeners
        this.setupNetworkListeners();
        
        // Load offline queue
        this.loadOfflineQueue();
        
        // Start sync monitoring
        this.startSyncMonitoring();
        
        console.log('Offline manager initialized');
    }

    // Set up network event listeners
    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.handleOnline();
        });
        
        window.addEventListener('offline', () => {
            this.handleOffline();
        });
        
        // Initial status
        this.isOnline = navigator.onLine;
        
        if (this.isOnline) {
            this.handleOnline();
        } else {
            this.handleOffline();
        }
    }

    // Handle coming online
    handleOnline() {
        this.isOnline = true;
        console.log('Device is online');
        
        // Update UI
        UIManager.showToast('You are back online', 'success');
        
        // Start syncing
        this.syncOfflineData();
        
        // Emit event
        window.dispatchEvent(new CustomEvent('network:online'));
    }

    // Handle going offline
    handleOffline() {
        this.isOnline = false;
        console.log('Device is offline');
        
        // Update UI
        UIManager.showToast('You are offline', 'warning');
        
        // Emit event
        window.dispatchEvent(new CustomEvent('network:offline'));
    }

    // Load offline queue from storage
    loadOfflineQueue() {
        try {
            const savedQueue = localStorage.getItem('offline_queue');
            this.offlineQueue = savedQueue ? JSON.parse(savedQueue) : [];
            
            console.log(`Loaded ${this.offlineQueue.length} items from offline queue`);
        } catch (error) {
            console.error('Failed to load offline queue:', error);
            this.offlineQueue = [];
        }
    }

    // Save offline queue to storage
    saveOfflineQueue() {
        try {
            localStorage.setItem('offline_queue', JSON.stringify(this.offlineQueue));
        } catch (error) {
            console.error('Failed to save offline queue:', error);
        }
    }

    // Add item to offline queue
    addToQueue(item) {
        // Validate item
        if (!item.type || !item.data) {
            console.error('Invalid queue item:', item);
            return false;
        }
        
        // Check queue size limit
        if (this.offlineQueue.length >= this.maxQueueSize) {
            console.warn('Offline queue is full, removing oldest item');
            this.offlineQueue.shift();
        }
        
        // Add timestamp and ID
        const queueItem = {
            id: `queue_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: item.type,
            data: item.data,
            timestamp: new Date().toISOString(),
            attempts: 0,
            status: 'pending'
        };
        
        this.offlineQueue.push(queueItem);
        this.saveOfflineQueue();
        
        console.log(`Added item to offline queue: ${item.type}`);
        
        // Try to sync immediately if online
        if (this.isOnline) {
            this.syncOfflineData();
        }
        
        return queueItem.id;
    }

    // Sync offline data
    async syncOfflineData() {
        if (!this.isOnline || this.offlineQueue.length === 0) {
            return;
        }
        
        try {
            UIManager.showLoader('Syncing offline data...', { overlay: false });
            
            console.log(`Syncing ${this.offlineQueue.length} offline items`);
            
            // Process queue items
            const successfulItems = [];
            const failedItems = [];
            
            for (const item of this.offlineQueue) {
                if (item.status === 'completed') {
                    continue; // Skip already processed items
                }
                
                try {
                    // Process based on type
                    const success = await this.processQueueItem(item);
                    
                    if (success) {
                        item.status = 'completed';
                        item.completedAt = new Date().toISOString();
                        successfulItems.push(item.id);
                    } else {
                        item.attempts++;
                        item.lastAttempt = new Date().toISOString();
                        
                        if (item.attempts >= 3) {
                            item.status = 'failed';
                            item.error = 'Max retries exceeded';
                        }
                        
                        failedItems.push(item.id);
                    }
                } catch (error) {
                    console.error(`Failed to process queue item ${item.id}:`, error);
                    item.attempts++;
                    item.lastAttempt = new Date().toISOString();
                    item.error = error.message;
                    
                    if (item.attempts >= 3) {
                        item.status = 'failed';
                    }
                    
                    failedItems.push(item.id);
                }
                
                // Save progress periodically
                this.saveOfflineQueue();
            }
            
            // Remove completed items
            this.offlineQueue = this.offlineQueue.filter(item => 
                item.status !== 'completed'
            );
            
            this.saveOfflineQueue();
            
            UIManager.hideLoader();
            
            // Show results
            if (successfulItems.length > 0) {
                UIManager.showToast(`Synced ${successfulItems.length} items`, 'success');
            }
            
            if (failedItems.length > 0) {
                UIManager.showToast(`${failedItems.length} items failed to sync`, 'error');
            }
            
            return {
                successful: successfulItems.length,
                failed: failedItems.length,
                remaining: this.offlineQueue.length
            };
        } catch (error) {
            console.error('Sync failed:', error);
            UIManager.hideLoader();
            UIManager.showToast('Sync failed', 'error');
            throw error;
        }
    }

    // Process individual queue item
    async processQueueItem(item) {
        // For Phase 1: simulate processing
        // In production: make actual API calls
        
        switch (item.type) {
            case 'exam_result':
                // Simulate exam result upload
                await this.simulateApiCall(1000);
                console.log('Exam result synced:', item.data.examId);
                return true;
                
            case 'user_profile':
                // Simulate profile update
                await this.simulateApiCall(800);
                console.log('Profile updated:', item.data.userId);
                return true;
                
            case 'payment':
                // Simulate payment sync
                await this.simulateApiCall(1500);
                console.log('Payment synced:', item.data.transactionId);
                return true;
                
            case 'security_event':
                // Simulate security event sync
                await this.simulateApiCall(500);
                console.log('Security event synced:', item.data.type);
                return true;
                
            default:
                console.warn(`Unknown queue item type: ${item.type}`);
                return false;
        }
    }

    // Simulate API call
    simulateApiCall(delay) {
        return new Promise(resolve => {
            setTimeout(() => {
                // 90% success rate for simulation
                const success = Math.random() > 0.1;
                resolve(success);
            }, delay);
        });
    }

    // Start sync monitoring
    startSyncMonitoring() {
        // Check for sync every 5 minutes when online
        this.syncInterval = setInterval(() => {
            if (this.isOnline && this.offlineQueue.length > 0) {
                this.syncOfflineData();
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    // Stop sync monitoring
    stopSyncMonitoring() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    // Check offline capabilities
    checkOfflineCapabilities() {
        const capabilities = {
            exam_taking: true,
            question_browsing: true,
            results_viewing: true,
            profile_editing: true,
            payment_processing: false,
            subscription_activation: false,
            registration: false,
            realtime_sync: false
        };
        
        return {
            isOnline: this.isOnline,
            capabilities: capabilities,
            queueSize: this.offlineQueue.length,
            maxQueueSize: this.maxQueueSize
        };
    }

    // Add exam result to sync queue
    async queueExamResult(examResult) {
        return this.addToQueue({
            type: 'exam_result',
            data: examResult
        });
    }

    // Add profile update to sync queue
    async queueProfileUpdate(profileData) {
        return this.addToQueue({
            type: 'user_profile',
            data: profileData
        });
    }

    // Add payment to sync queue
    async queuePayment(paymentData) {
        return this.addToQueue({
            type: 'payment',
            data: paymentData
        });
    }

    // Add security event to sync queue
    async queueSecurityEvent(eventData) {
        return this.addToQueue({
            type: 'security_event',
            data: eventData
        });
    }

    // Get queue status
    getQueueStatus() {
        const status = {
            total: this.offlineQueue.length,
            pending: this.offlineQueue.filter(item => item.status === 'pending').length,
            completed: this.offlineQueue.filter(item => item.status === 'completed').length,
            failed: this.offlineQueue.filter(item => item.status === 'failed').length,
            types: {}
        };
        
        // Count by type
        this.offlineQueue.forEach(item => {
            if (!status.types[item.type]) {
                status.types[item.type] = 0;
            }
            status.types[item.type]++;
        });
        
        return status;
    }

    // Clear queue
    clearQueue() {
        this.offlineQueue = [];
        this.saveOfflineQueue();
        console.log('Offline queue cleared');
        
        return true;
    }

    // Retry failed items
    async retryFailedItems() {
        const failedItems = this.offlineQueue.filter(item => 
            item.status === 'failed' || item.attempts >= 3
        );
        
        if (failedItems.length === 0) {
            UIManager.showToast('No failed items to retry', 'info');
            return { retried: 0 };
        }
        
        // Reset failed items
        failedItems.forEach(item => {
            item.status = 'pending';
            item.attempts = 0;
            item.error = null;
        });
        
        this.saveOfflineQueue();
        
        console.log(`Retrying ${failedItems.length} failed items`);
        
        // Start sync
        const result = await this.syncOfflineData();
        
        return {
            retried: failedItems.length,
            result
        };
    }

    // Check if feature is available offline
    isFeatureAvailableOffline(feature) {
        const capabilities = this.checkOfflineCapabilities().capabilities;
        return capabilities[feature] || false;
    }

    // Show offline warning
    showOfflineWarning(feature) {
        if (!this.isOnline) {
            UIManager.alert({
                title: 'Offline Mode',
                message: `This feature (${feature}) requires an internet connection. Please connect to the internet and try again.`
            });
            return true;
        }
        return false;
    }

    // Handle offline exam submission
    async handleOfflineExamSubmission(examResult) {
        if (this.isOnline) {
            // If online, save directly
            await DB.saveExamResult(examResult);
            return { success: true, synced: true };
        } else {
            // If offline, add to queue
            const queueId = await this.queueExamResult(examResult);
            return { 
                success: true, 
                synced: false, 
                queueId,
                message: 'Exam saved locally. Will sync when online.'
            };
        }
    }

    // Get offline storage status
    getStorageStatus() {
        // Check IndexedDB status
        const dbStatus = DB.isInitialized ? 'ready' : 'not_initialized';
        
        // Check localStorage usage
        let localStorageUsage = 0;
        try {
            let total = 0;
            for (const key in localStorage) {
                if (localStorage.hasOwnProperty(key)) {
                    total += localStorage[key].length * 2; // Approximate size in bytes
                }
            }
            localStorageUsage = total / (1024 * 1024); // Convert to MB
        } catch (error) {
            console.error('Failed to calculate localStorage usage:', error);
        }
        
        return {
            isOnline: this.isOnline,
            offlineQueue: this.getQueueStatus(),
            database: dbStatus,
            localStorage: {
                used: localStorageUsage.toFixed(2) + ' MB',
                limit: '5-10 MB (browser dependent)'
            },
            capabilities: this.checkOfflineCapabilities().capabilities
        };
    }

    // Initialize offline storage
    async initOfflineStorage() {
        try {
            // Initialize IndexedDB
            await DB.init();
            
            // Cache question bank if not already cached
            const questionCount = await DB.getStoreCount('questions');
            if (questionCount === 0) {
                await this.cacheQuestionBank();
            }
            
            return {
                success: true,
                message: 'Offline storage initialized',
                questionCount
            };
        } catch (error) {
            console.error('Failed to initialize offline storage:', error);
            return {
                success: false,
                message: error.message
            };
        }
    }

    // Cache question bank for offline use
    async cacheQuestionBank() {
        try {
            UIManager.showLoader('Caching question bank for offline use...');
            
            // For Phase 1: cache demo questions
            await QuestionManager.init();
            
            // Get all questions
            const subjects = QuestionManager.getSubjects();
            let totalCached = 0;
            
            for (const subjectKey in subjects) {
                const questions = QuestionManager.getQuestionsBySubject(subjectKey);
                
                if (questions.length > 0) {
                    await DB.saveQuestions(questions);
                    totalCached += questions.length;
                    
                    console.log(`Cached ${questions.length} questions for ${subjectKey}`);
                }
            }
            
            UIManager.hideLoader();
            UIManager.showToast(`Cached ${totalCached} questions for offline use`, 'success');
            
            return {
                success: true,
                cached: totalCached
            };
        } catch (error) {
            console.error('Failed to cache question bank:', error);
            UIManager.hideLoader();
            UIManager.showToast('Failed to cache questions', 'error');
            
            return {
                success: false,
                message: error.message
            };
        }
    }

    // Check cache status
    async getCacheStatus() {
        try {
            const questionCount = await DB.getStoreCount('questions');
            const examCount = await DB.getStoreCount('exams');
            const userCount = await DB.getStoreCount('users');
            
            return {
                questions: questionCount,
                exams: examCount,
                users: userCount,
                total: questionCount + examCount + userCount
            };
        } catch (error) {
            console.error('Failed to get cache status:', error);
            return {
                questions: 0,
                exams: 0,
                users: 0,
                total: 0,
                error: error.message
            };
        }
    }

    // Clear cache
    async clearCache() {
        try {
            UIManager.showLoader('Clearing cache...');
            
            await DB.clearAllData();
            
            // Clear localStorage
            localStorage.clear();
            
            UIManager.hideLoader();
            UIManager.showToast('Cache cleared successfully', 'success');
            
            return { success: true };
        } catch (error) {
            console.error('Failed to clear cache:', error);
            UIManager.hideLoader();
            UIManager.showToast('Failed to clear cache', 'error');
            
            return { success: false, message: error.message };
        }
    }
}

// Create global instance
const Offline = new OfflineManager();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Offline;
}
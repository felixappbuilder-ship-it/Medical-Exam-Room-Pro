// sync.js - Data synchronization (mocked for Phase 1)
class SyncManager {
    constructor() {
        this.isSyncing = false;
        this.lastSync = null;
        this.syncInterval = null;
        this.syncQueue = [];
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 seconds
        
        this.init();
    }

    // Initialize sync manager
    init() {
        // Load sync state
        this.loadSyncState();
        
        // Start sync monitoring
        this.startSyncMonitoring();
        
        console.log('Sync manager initialized');
    }

    // Load sync state from storage
    loadSyncState() {
        try {
            this.lastSync = localStorage.getItem('last_sync');
            
            // Load sync queue from IndexedDB
            this.loadSyncQueue();
        } catch (error) {
            console.error('Failed to load sync state:', error);
            this.lastSync = null;
            this.syncQueue = [];
        }
    }

    // Load sync queue from IndexedDB
    async loadSyncQueue() {
        try {
            const pendingItems = await DB.getPendingSyncItems();
            this.syncQueue = pendingItems;
            
            console.log(`Loaded ${this.syncQueue.length} pending sync items`);
        } catch (error) {
            console.error('Failed to load sync queue:', error);
            this.syncQueue = [];
        }
    }

    // Save sync state to storage
    saveSyncState() {
        try {
            localStorage.setItem('last_sync', this.lastSync);
        } catch (error) {
            console.error('Failed to save sync state:', error);
        }
    }

    // Start sync monitoring
    startSyncMonitoring() {
        // Check for sync every 30 seconds when online
        this.syncInterval = setInterval(() => {
            if (navigator.onLine && this.syncQueue.length > 0 && !this.isSyncing) {
                this.syncData();
            }
        }, 30000); // 30 seconds
    }

    // Stop sync monitoring
    stopSyncMonitoring() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    // Sync data with backend
    async syncData() {
        if (this.isSyncing) {
            console.log('Sync already in progress');
            return;
        }
        
        if (!navigator.onLine) {
            console.log('Cannot sync while offline');
            return;
        }
        
        if (this.syncQueue.length === 0) {
            console.log('No data to sync');
            return;
        }
        
        this.isSyncing = true;
        
        try {
            console.log(`Starting sync of ${this.syncQueue.length} items`);
            
            // Show sync indicator
            this.showSyncIndicator();
            
            // Process sync queue
            const results = await this.processSyncQueue();
            
            // Update last sync time
            this.lastSync = new Date().toISOString();
            this.saveSyncState();
            
            // Hide sync indicator
            this.hideSyncIndicator();
            
            // Show results
            this.showSyncResults(results);
            
            // Emit sync completed event
            window.dispatchEvent(new CustomEvent('sync:completed', {
                detail: results
            }));
            
            console.log('Sync completed:', results);
            
            return results;
        } catch (error) {
            console.error('Sync failed:', error);
            
            // Hide sync indicator
            this.hideSyncIndicator();
            
            // Show error
            UIManager.showToast('Sync failed: ' + error.message, 'error');
            
            throw error;
        } finally {
            this.isSyncing = false;
        }
    }

    // Process sync queue
    async processSyncQueue() {
        const results = {
            total: this.syncQueue.length,
            successful: 0,
            failed: 0,
            skipped: 0,
            items: []
        };
        
        for (const item of this.syncQueue) {
            if (item.status === 'completed') {
                results.skipped++;
                results.items.push({
                    id: item.id,
                    type: item.type,
                    status: 'skipped',
                    reason: 'Already completed'
                });
                continue;
            }
            
            try {
                // Simulate API call for Phase 1
                const success = await this.simulateSyncItem(item);
                
                if (success) {
                    // Mark as completed in IndexedDB
                    await DB.updateSyncItemStatus(item.id, 'completed');
                    
                    // Remove from local queue
                    const index = this.syncQueue.findIndex(i => i.id === item.id);
                    if (index !== -1) {
                        this.syncQueue.splice(index, 1);
                    }
                    
                    results.successful++;
                    results.items.push({
                        id: item.id,
                        type: item.type,
                        status: 'success'
                    });
                } else {
                    // Update retry count
                    item.retryCount = (item.retryCount || 0) + 1;
                    
                    if (item.retryCount >= this.maxRetries) {
                        // Mark as failed
                        await DB.updateSyncItemStatus(item.id, 'failed', 'Max retries exceeded');
                        results.failed++;
                        results.items.push({
                            id: item.id,
                            type: item.type,
                            status: 'failed',
                            reason: 'Max retries exceeded'
                        });
                    } else {
                        // Schedule retry
                        await DB.updateSyncItemStatus(item.id, 'pending', 'Retry scheduled');
                        results.failed++;
                        results.items.push({
                            id: item.id,
                            type: item.type,
                            status: 'retry_scheduled',
                            retryCount: item.retryCount
                        });
                        
                        // Schedule retry
                        this.scheduleRetry(item);
                    }
                }
            } catch (error) {
                console.error(`Failed to sync item ${item.id}:`, error);
                
                // Update with error
                await DB.updateSyncItemStatus(item.id, 'failed', error.message);
                
                results.failed++;
                results.items.push({
                    id: item.id,
                    type: item.type,
                    status: 'failed',
                    reason: error.message
                });
            }
        }
        
        return results;
    }

    // Simulate sync item (Phase 1)
    async simulateSyncItem(item) {
        return new Promise((resolve) => {
            // Simulate network delay
            const delay = Math.random() * 2000 + 1000; // 1-3 seconds
            const successRate = 0.9; // 90% success rate
            
            setTimeout(() => {
                const success = Math.random() < successRate;
                
                if (success) {
                    console.log(`Synced item ${item.id} (${item.type})`);
                } else {
                    console.log(`Failed to sync item ${item.id} (${item.type})`);
                }
                
                resolve(success);
            }, delay);
        });
    }

    // Schedule retry for failed item
    scheduleRetry(item) {
        setTimeout(() => {
            // Add back to queue for retry
            this.syncQueue.push(item);
            
            // Try to sync if online
            if (navigator.onLine && !this.isSyncing) {
                this.syncData();
            }
        }, this.retryDelay);
    }

    // Show sync indicator
    showSyncIndicator() {
        // Create sync indicator if not exists
        let indicator = document.getElementById('sync-indicator');
        
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'sync-indicator';
            indicator.innerHTML = `
                <div class="sync-spinner"></div>
                <span class="sync-text">Syncing...</span>
            `;
            indicator.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(33, 150, 243, 0.9);
                color: white;
                padding: 10px 20px;
                border-radius: 20px;
                display: flex;
                align-items: center;
                gap: 10px;
                z-index: 9999;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
                animation: slideIn 0.3s ease;
            `;
            
            const style = document.createElement('style');
            style.textContent = `
                .sync-spinner {
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255, 255, 255, 0.3);
                    border-top: 2px solid white;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                
                .sync-text {
                    font-size: 14px;
                    font-weight: 500;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                @keyframes slideIn {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);
            document.body.appendChild(indicator);
        }
        
        // Update progress if queue is large
        if (this.syncQueue.length > 10) {
            const processed = this.syncQueue.length - this.syncQueue.filter(i => i.status === 'pending').length;
            const progress = Math.round((processed / this.syncQueue.length) * 100);
            
            const progressText = document.querySelector('.sync-text');
            if (progressText) {
                progressText.textContent = `Syncing... ${progress}%`;
            }
        }
    }

    // Hide sync indicator
    hideSyncIndicator() {
        const indicator = document.getElementById('sync-indicator');
        if (indicator) {
            // Add fade out animation
            indicator.style.animation = 'slideOut 0.3s ease';
            indicator.style.transform = 'translateX(100%)';
            indicator.style.opacity = '0';
            
            // Remove after animation
            setTimeout(() => {
                indicator.remove();
            }, 300);
        }
    }

    // Show sync results
    showSyncResults(results) {
        if (results.successful > 0) {
            UIManager.showToast(`Synced ${results.successful} items successfully`, 'success');
        }
        
        if (results.failed > 0) {
            UIManager.showToast(`${results.failed} items failed to sync`, 'error');
        }
    }

    // Add item to sync queue
    async addToSyncQueue(type, data, priority = 'normal') {
        try {
            const item = {
                type: type,
                data: data,
                priority: priority,
                status: 'pending',
                createdAt: new Date().toISOString(),
                retryCount: 0
            };
            
            // Add to IndexedDB
            const itemId = await DB.addToSyncQueue(item);
            
            // Add to local queue
            this.syncQueue.push({ ...item, id: itemId });
            
            console.log(`Added ${type} to sync queue (priority: ${priority})`);
            
            // Try to sync immediately if online
            if (navigator.onLine && !this.isSyncing) {
                this.syncData();
            }
            
            return itemId;
        } catch (error) {
            console.error('Failed to add to sync queue:', error);
            throw error;
        }
    }

    // Sync exam results
    async syncExamResults(examResults) {
        if (!Array.isArray(examResults)) {
            examResults = [examResults];
        }
        
        const queueIds = [];
        
        for (const result of examResults) {
            try {
                const queueId = await this.addToSyncQueue('exam_result', result, 'high');
                queueIds.push(queueId);
            } catch (error) {
                console.error('Failed to queue exam result:', error);
            }
        }
        
        return queueIds;
    }

    // Sync user profile
    async syncUserProfile(profileData) {
        try {
            const queueId = await this.addToSyncQueue('user_profile', profileData, 'medium');
            return queueId;
        } catch (error) {
            console.error('Failed to queue user profile:', error);
            throw error;
        }
    }

    // Sync security events
    async syncSecurityEvents(events) {
        if (!Array.isArray(events)) {
            events = [events];
        }
        
        const queueIds = [];
        
        for (const event of events) {
            try {
                const queueId = await this.addToSyncQueue('security_event', event, 'low');
                queueIds.push(queueId);
            } catch (error) {
                console.error('Failed to queue security event:', error);
            }
        }
        
        return queueIds;
    }

    // Sync analytics data
    async syncAnalytics(analyticsData) {
        try {
            const queueId = await this.addToSyncQueue('analytics', analyticsData, 'low');
            return queueId;
        } catch (error) {
            console.error('Failed to queue analytics:', error);
            throw error;
        }
    }

    // Force sync (manual trigger)
    async forceSync() {
        if (this.isSyncing) {
            UIManager.showToast('Sync already in progress', 'info');
            return;
        }
        
        if (!navigator.onLine) {
            UIManager.showToast('Cannot sync while offline', 'warning');
            return;
        }
        
        // Reload queue from IndexedDB
        await this.loadSyncQueue();
        
        if (this.syncQueue.length === 0) {
            UIManager.showToast('No data to sync', 'info');
            return;
        }
        
        UIManager.showToast('Starting manual sync...', 'info');
        
        const results = await this.syncData();
        return results;
    }

    // Get sync status
    getSyncStatus() {
        const pending = this.syncQueue.filter(item => item.status === 'pending').length;
        const failed = this.syncQueue.filter(item => item.status === 'failed').length;
        const completed = this.syncQueue.filter(item => item.status === 'completed').length;
        
        return {
            isSyncing: this.isSyncing,
            isOnline: navigator.onLine,
            lastSync: this.lastSync,
            queue: {
                total: this.syncQueue.length,
                pending: pending,
                failed: failed,
                completed: completed
            },
            byType: this.getSyncStatsByType(),
            nextSync: this.getNextSyncTime()
        };
    }

    // Get sync stats by type
    getSyncStatsByType() {
        const stats = {};
        
        this.syncQueue.forEach(item => {
            if (!stats[item.type]) {
                stats[item.type] = {
                    total: 0,
                    pending: 0,
                    failed: 0,
                    completed: 0
                };
            }
            
            stats[item.type].total++;
            
            if (item.status === 'pending') stats[item.type].pending++;
            else if (item.status === 'failed') stats[item.type].failed++;
            else if (item.status === 'completed') stats[item.type].completed++;
        });
        
        return stats;
    }

    // Get next sync time
    getNextSyncTime() {
        if (!navigator.onLine) {
            return 'When online';
        }
        
        if (this.isSyncing) {
            return 'In progress';
        }
        
        if (this.syncQueue.length === 0) {
            return 'No pending sync';
        }
        
        // Check if any items need retry
        const needsRetry = this.syncQueue.some(item => 
            item.retryCount > 0 && item.status === 'pending'
        );
        
        if (needsRetry) {
            return 'Retry scheduled';
        }
        
        return 'Next automatic sync in 30 seconds';
    }

    // Clear sync queue
    async clearSyncQueue() {
        try {
            // Clear from IndexedDB
            await DB.clear('syncQueue');
            
            // Clear local queue
            this.syncQueue = [];
            
            console.log('Sync queue cleared');
            
            return { success: true };
        } catch (error) {
            console.error('Failed to clear sync queue:', error);
            return { success: false, error: error.message };
        }
    }

    // Retry failed syncs
    async retryFailedSyncs() {
        const failedItems = this.syncQueue.filter(item => item.status === 'failed');
        
        if (failedItems.length === 0) {
            UIManager.showToast('No failed syncs to retry', 'info');
            return { retried: 0 };
        }
        
        // Reset failed items
        for (const item of failedItems) {
            item.status = 'pending';
            item.retryCount = 0;
            item.lastError = null;
            
            // Update in IndexedDB
            await DB.updateSyncItemStatus(item.id, 'pending');
        }
        
        UIManager.showToast(`Retrying ${failedItems.length} failed syncs`, 'info');
        
        // Start sync
        const results = await this.syncData();
        
        return {
            retried: failedItems.length,
            results: results
        };
    }

    // Download updates from server (Phase 1 simulation)
    async downloadUpdates() {
        return new Promise((resolve) => {
            setTimeout(() => {
                // For Phase 1: return mock updates
                const updates = {
                    subscription: {
                        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year from now
                        isActive: true,
                        plan: 'yearly'
                    },
                    announcements: [
                        {
                            id: 'announcement_1',
                            title: 'Welcome to Phase 1!',
                            message: 'This is a test version of Medical Exam Room Pro.',
                            type: 'info',
                            date: new Date().toISOString()
                        }
                    ],
                    questionUpdates: {
                        count: 0,
                        lastUpdated: null
                    }
                };
                
                resolve(updates);
            }, 1000);
        });
    }

    // Apply downloaded updates
    async applyUpdates(updates) {
        try {
            // Apply subscription updates
            if (updates.subscription) {
                const user = Auth.getCurrentUser();
                if (user) {
                    await DB.updateSubscriptionExpiry(user.id, updates.subscription.expiryDate);
                }
            }
            
            // Store announcements
            if (updates.announcements && updates.announcements.length > 0) {
                localStorage.setItem('announcements', JSON.stringify(updates.announcements));
            }
            
            console.log('Updates applied successfully');
            return { success: true };
        } catch (error) {
            console.error('Failed to apply updates:', error);
            return { success: false, error: error.message };
        }
    }

    // Check for updates
    async checkForUpdates() {
        if (!navigator.onLine) {
            return { hasUpdates: false, reason: 'Offline' };
        }
        
        try {
            const updates = await this.downloadUpdates();
            const hasUpdates = Object.keys(updates).some(key => 
                updates[key] && (Array.isArray(updates[key]) ? updates[key].length > 0 : true)
            );
            
            if (hasUpdates) {
                await this.applyUpdates(updates);
                return { 
                    hasUpdates: true, 
                    updates: updates,
                    applied: true 
                };
            }
            
            return { hasUpdates: false };
        } catch (error) {
            console.error('Failed to check for updates:', error);
            return { hasUpdates: false, error: error.message };
        }
    }

    // Get sync configuration
    getConfig() {
        return {
            autoSync: true,
            syncInterval: 30000, // 30 seconds
            maxRetries: this.maxRetries,
            retryDelay: this.retryDelay,
            priorities: {
                high: ['exam_result', 'payment'],
                medium: ['user_profile', 'subscription'],
                low: ['analytics', 'security_event']
            }
        };
    }

    // Update sync configuration
    updateConfig(config) {
        if (config.syncInterval && config.syncInterval !== this.getConfig().syncInterval) {
            this.stopSyncMonitoring();
            this.syncInterval = null;
            
            setTimeout(() => {
                this.startSyncMonitoring();
            }, 100);
        }
        
        if (config.maxRetries) {
            this.maxRetries = config.maxRetries;
        }
        
        if (config.retryDelay) {
            this.retryDelay = config.retryDelay;
        }
        
        console.log('Sync configuration updated');
    }

    // Export sync data for debugging
    async exportSyncData() {
        const syncData = {
            status: this.getSyncStatus(),
            queue: this.syncQueue,
            config: this.getConfig(),
            lastSync: this.lastSync,
            exportedAt: new Date().toISOString()
        };
        
        return JSON.stringify(syncData, null, 2);
    }

    // Import sync data (for testing)
    async importSyncData(data) {
        try {
            const syncData = JSON.parse(data);
            
            // Import queue items
            if (syncData.queue && Array.isArray(syncData.queue)) {
                for (const item of syncData.queue) {
                    await DB.addToSyncQueue(item);
                }
                
                // Reload queue
                await this.loadSyncQueue();
            }
            
            console.log('Sync data imported successfully');
            return { success: true };
        } catch (error) {
            console.error('Failed to import sync data:', error);
            return { success: false, error: error.message };
        }
    }

    // Reset sync manager (for testing)
    async reset() {
        this.stopSyncMonitoring();
        
        await this.clearSyncQueue();
        
        this.lastSync = null;
        this.saveSyncState();
        
        this.isSyncing = false;
        this.syncQueue = [];
        
        console.log('Sync manager reset');
        
        // Restart monitoring
        this.startSyncMonitoring();
        
        return { success: true };
    }
}

// Create global instance
const Sync = new SyncManager();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Sync;
}
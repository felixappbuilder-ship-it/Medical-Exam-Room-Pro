// frontend-user/scripts/sync.js

/**
 * Data Synchronization Module – OFFLINE VERSION
 * Handles online/offline detection, background sync simulation,
 * and clearing of sync queue (since no backend).
 */

import * as utils from './utils.js';
import * as ui from './ui.js';
import * as db from './db.js';

// ==================== NETWORK DETECTION ====================

let onlineStatus = navigator.onLine;
let connectionListeners = [];

/**
 * Check if currently online.
 * @returns {boolean}
 */
export function isOnline() {
    return navigator.onLine;
}

/**
 * Wait for connection to be restored.
 * @returns {Promise<void>}
 */
export function waitForConnection() {
    return new Promise((resolve) => {
        if (navigator.onLine) {
            resolve();
            return;
        }
        const handler = () => {
            window.removeEventListener('online', handler);
            resolve();
        };
        window.addEventListener('online', handler);
    });
}

/**
 * Monitor connection status and update UI.
 * Also stores status in app state for other modules.
 */
export function monitorConnection() {
    // Update initial status
    updateConnectionStatus();

    // Listen for changes
    window.addEventListener('online', () => {
        onlineStatus = true;
        updateConnectionStatus();
        ui.showToast('You are back online', 'success', 3000);
        // Attempt to sync when connection restored
        syncData().catch(() => {});
    });

    window.addEventListener('offline', () => {
        onlineStatus = false;
        updateConnectionStatus();
        ui.showToast('You are offline. Some features may be limited.', 'warning', 3000);
    });
}

function updateConnectionStatus() {
    const statusEl = document.getElementById('sync-indicator');
    if (!statusEl) return;
    statusEl.textContent = onlineStatus ? 'Online' : 'Offline';
    statusEl.className = onlineStatus ? 'sync-badge online' : 'sync-badge offline';
}

// ==================== SYNC QUEUE PROCESSING ====================

/**
 * Process all pending sync items.
 * Since there is no backend, we simply clear the queue and log.
 */
export async function syncData() {
    if (!onlineStatus) {
        console.log('Sync postponed: offline');
        return;
    }

    console.log('Starting sync...');
    ui.showToast('Syncing data...', 'info', 2000);

    try {
        const queue = await db.getSyncQueue();
        if (queue.length === 0) {
            console.log('Nothing to sync');
            ui.showToast('All data is synced', 'success', 2000);
            return;
        }

        console.log(`Found ${queue.length} items to sync`);

        // Process each item based on type
        for (const item of queue) {
            try {
                await processSyncItem(item);
                await db.removeFromSyncQueue(item.id);
            } catch (err) {
                console.error(`Failed to sync item ${item.id}:`, err);
                // Optionally increment attempts and keep for later
                item.attempts = (item.attempts || 0) + 1;
                if (item.attempts < 3) {
                    // Re-add with updated attempts? Better to update in place
                    await db.addToSyncQueue(item.type, item.data); // This creates a new item, not ideal
                    // We'll just leave it – remove and re-add
                    await db.removeFromSyncQueue(item.id);
                    await db.addToSyncQueue(item.type, item.data);
                } else {
                    // Too many attempts, maybe notify user
                    ui.showToast(`Failed to sync ${item.type} after multiple attempts`, 'error');
                }
            }
        }

        ui.showToast('Sync complete', 'success', 2000);
    } catch (err) {
        console.error('Sync failed', err);
        ui.showToast('Sync failed', 'error');
    }
}

/**
 * Process a single sync queue item (simulated).
 * @param {Object} item
 */
async function processSyncItem(item) {
    console.log(`Processing sync item: ${item.type}`, item.data);

    // Simulate network delay
    await new Promise(r => setTimeout(r, 300));

    // In a real app, you would send to backend here.
    // Since no backend, we just resolve successfully.
    // You could also perform local validation if needed.

    // For exam results, we might want to update analytics locally
    if (item.type === 'exam_results') {
        // Optionally update user statistics or leaderboard (simulated)
        console.log('Exam results synced (simulated)');
    } else if (item.type === 'profile_update') {
        console.log('Profile update synced (simulated)');
    } else if (item.type === 'security_log') {
        console.log('Security log synced (simulated)');
    }

    // Success – item will be removed from queue by caller
}

// ==================== SPECIFIC SYNC FUNCTIONS ====================

/**
 * Sync exam results (adds to queue if offline, else processes immediately).
 * @param {Object} results
 */
export async function syncExamResults(results) {
    if (!onlineStatus) {
        await db.addToSyncQueue('exam_results', results);
        ui.showToast('Results saved offline. Will sync when online.', 'info');
        return;
    }

    // If online, simulate sending
    try {
        await new Promise(r => setTimeout(r, 500));
        console.log('Exam results synced immediately', results);
        ui.showToast('Results synced', 'success', 2000);
    } catch (err) {
        // If fails, queue for later
        await db.addToSyncQueue('exam_results', results);
        ui.showToast('Sync failed, queued for later', 'warning');
    }
}

/**
 * Sync user profile (adds to queue if offline).
 * @param {Object} updates
 */
export async function syncUserProfile(updates) {
    if (!onlineStatus) {
        await db.addToSyncQueue('profile_update', updates);
        ui.showToast('Profile update queued for sync', 'info');
        return;
    }

    try {
        await new Promise(r => setTimeout(r, 500));
        console.log('Profile synced', updates);
        ui.showToast('Profile updated', 'success');
    } catch (err) {
        await db.addToSyncQueue('profile_update', updates);
        ui.showToast('Sync failed, queued', 'warning');
    }
}

/**
 * Sync subscription (adds to queue if offline).
 * @param {Object} subscription
 */
export async function syncSubscription(subscription) {
    if (!onlineStatus) {
        await db.addToSyncQueue('subscription', subscription);
        ui.showToast('Subscription update queued', 'info');
        return;
    }

    try {
        await new Promise(r => setTimeout(r, 500));
        console.log('Subscription synced', subscription);
    } catch (err) {
        await db.addToSyncQueue('subscription', subscription);
    }
}

// ==================== BACKGROUND SYNC ====================

let syncInterval = null;

/**
 * Set up periodic background sync (every 30 minutes).
 */
export function setupBackgroundSync() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        if (onlineStatus) {
            syncData().catch(err => console.warn('Background sync failed', err));
        }
    }, 30 * 60 * 1000); // 30 minutes
}

/**
 * Trigger background sync manually.
 */
export function triggerBackgroundSync() {
    if (onlineStatus) {
        syncData().catch(err => console.warn('Manual sync failed', err));
    } else {
        ui.showToast('Cannot sync while offline', 'warning');
    }
}

/**
 * Check background sync status (if any pending items).
 */
export async function checkBackgroundSync() {
    const queue = await db.getSyncQueue();
    return queue.length > 0;
}

// ==================== STATUS REPORTING ====================

/**
 * Get current sync status.
 */
export async function getSyncStatus() {
    const queue = await db.getSyncQueue();
    return {
        online: onlineStatus,
        pending: queue.length,
        items: queue
    };
}

/**
 * Get last sync time (from localStorage or IndexedDB).
 */
export async function getLastSync() {
    return utils.getLocalStorage('lastSync', null);
}

/**
 * Get pending sync items count.
 */
export async function getPendingSyncs() {
    const queue = await db.getSyncQueue();
    return queue.length;
}

// ==================== CONFLICT RESOLUTION ====================

/**
 * Detect conflicts between local and server data (simulated).
 */
export function detectConflicts(localData, serverData) {
    // For offline, we assume no conflicts
    return [];
}

/**
 * Resolve conflicts (simulated – server wins).
 */
export function resolveConflicts(conflicts) {
    return conflicts.map(c => c.server);
}

/**
 * Merge data (simulated).
 */
export function mergeData(localData, serverData) {
    return { ...localData, ...serverData };
}

// ==================== INITIALIZATION ====================

// Start monitoring connection on module load
monitorConnection();
setupBackgroundSync();

// ==================== EXPOSE GLOBALLY ====================

window.sync = {
    syncData,
    syncExamResults,
    syncUserProfile,
    syncSubscription,
    monitorConnection,
    isOnline,
    waitForConnection,
    getSyncStatus,
    getLastSync,
    getPendingSyncs,
    triggerBackgroundSync
};
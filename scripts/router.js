// frontend-user/scripts/router.js

/**
 * Full-featured Client-Side Router – GitHub Pages compatible
 * Handles navigation from all buttons in every HTML page.
 * Automatically detects the base path (e.g., /repository-name) and uses it for all navigation.
 */

import * as app from './app.js';
import * as ui from './ui.js';
import * as utils from './utils.js';

// ==================== DETECT BASE PATH ====================
const BASE_PATH = (() => {
    const path = window.location.pathname;
    // Look for the last occurrence of '/pages/' to determine the base
    const pagesIndex = path.lastIndexOf('/pages/');
    if (pagesIndex !== -1) {
        return path.substring(0, pagesIndex);
    }
    // If not in a pages subfolder, try to strip the filename
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash > 0 && !path.endsWith('/')) {
        // e.g., /repository/index.html -> /repository
        return path.substring(0, lastSlash);
    }
    // Default to empty (site at root)
    return '';
})();

console.log('[Router] Base path detected:', BASE_PATH);

// ==================== ROUTE PERMISSIONS ====================
const ROUTES = {
    public: [
        'index.html',
        'welcome.html',
        'login.html',
        'signup.html',
        'forgot-password.html',
        'locked.html',
        'shared-exam.html'
    ],
    protected: [
        'subjects.html',
        'subject-specific.html',
        'subscription.html',
        'free-trial.html',
        'payment.html',
        'exam-settings.html',
        'exam-room.html',      // also requires subscription
        'results.html',
        'performance.html',
        'profile.html'
    ],
    subscriptionRequired: ['exam-room.html']
};

// ==================== ALLOWED NAVIGATION FLOWS ====================
const FLOW = {
    'index.html': ['welcome.html'],
    'welcome.html': ['login.html', 'signup.html', 'subjects.html'],
    'login.html': ['subjects.html', 'forgot-password.html'],
    'signup.html': ['free-trial.html', 'subjects.html'],
    'subjects.html': [
        'subject-specific.html',
        'exam-settings.html',
        'performance.html',
        'profile.html',
        'subscription.html'
    ],
    'subject-specific.html': ['exam-settings.html', 'subjects.html'],
    'exam-settings.html': ['exam-room.html', 'subject-specific.html', 'subjects.html'],
    'exam-room.html': ['results.html', 'subjects.html'],
    'results.html': ['exam-settings.html', 'subjects.html', 'performance.html'],
    'performance.html': ['subjects.html', 'profile.html', 'subject-specific.html'],
    'profile.html': ['subjects.html'],
    'subscription.html': ['payment.html', 'free-trial.html', 'subjects.html'],
    'payment.html': ['subscription.html', 'subjects.html'],
    'free-trial.html': ['subscription.html', 'subjects.html'],
    'forgot-password.html': ['login.html']
};

// ==================== PERMISSION CHECK ====================
function isAllowed(targetPage, currentPage) {
    // Public pages always allowed
    if (ROUTES.public.includes(targetPage)) return true;

    // Authentication check
    const isLoggedIn = app.checkAuth();
    if (!isLoggedIn && ROUTES.protected.includes(targetPage)) {
        ui.showToast('Please log in first', 'warning');
        return false;
    }

    // Subscription check (only exam-room)
    if (targetPage === 'exam-room.html') {
        const hasAccess = app.hasActiveSubscription();
        if (!hasAccess) {
            ui.showToast('Subscription required to take exams', 'warning');
            return false;
        }
    }

    // Flow check – if explicitly disallowed, warn but allow (except we can block if desired)
    if (FLOW[currentPage] && !FLOW[currentPage].includes(targetPage)) {
        // Allow going back to home/welcome always
        if (targetPage === 'index.html' || targetPage === 'welcome.html') {
            return true;
        }
        console.warn(`Navigation from ${currentPage} to ${targetPage} is not in standard flow.`);
    }

    return true;
}

// ==================== URL BUILDING (with base path) ====================
function buildUrl(target) {
    // Split target into path and hash (preserve hash)
    const [pathAndQuery, hash] = target.split('#');
    const hashPart = hash ? `#${hash}` : '';

    // Split path into base and query
    const [base, query] = pathAndQuery.split('?');
    const queryPart = query ? `?${query}` : '';

    // Trim any leading/trailing slashes from base
    const cleanBase = base.replace(/^\/+|\/+$/g, '');

    // If it's already an absolute path (starts with /), prepend BASE_PATH
    if (base.startsWith('/')) {
        return BASE_PATH + base + queryPart + hashPart;
    }

    // Map to correct location
    if (cleanBase === 'index.html') {
        return BASE_PATH + '/index.html' + queryPart + hashPart;
    } else {
        return BASE_PATH + `/pages/${cleanBase}` + queryPart + hashPart;
    }
}

// ==================== PUBLIC API ====================

/**
 * Navigate to a page.
 * @param {string} page - as used in onclick handlers (may include query/hash)
 * @param {Object} data - optional data to pass via sessionStorage
 */
export function navigateTo(page, data = {}) {
    console.log(`[Router] Navigating to: ${page}`);

    // Extract base filename for permission checks (strip query/hash)
    const base = page.split('?')[0].split('#')[0];
    const current = getCurrentPage();

    if (!isAllowed(base, current)) {
        return;
    }

    if (Object.keys(data).length > 0) {
        sessionStorage.setItem('navData', JSON.stringify(data));
    }

    const targetUrl = buildUrl(page);

    // Show transition overlay if available
    const overlay = document.querySelector('.page-transition-overlay') || (() => {
        const el = document.createElement('div');
        el.className = 'page-transition-overlay';
        document.body.appendChild(el);
        return el;
    })();
    overlay.style.display = 'block';
    overlay.style.opacity = '1';

    setTimeout(() => {
        window.location.href = targetUrl;
    }, 50);
}

/**
 * Get current page filename from URL.
 * @returns {string} e.g., 'subjects.html'
 */
export function getCurrentPage() {
    const path = window.location.pathname;
    // Remove base path to get relative path
    let relativePath = path;
    if (BASE_PATH && path.startsWith(BASE_PATH)) {
        relativePath = path.substring(BASE_PATH.length);
    }
    if (relativePath === '/' || relativePath === '/index.html') return 'index.html';
    const parts = relativePath.split('/');
    const filename = parts[parts.length - 1];
    return filename || 'index.html';
}

/**
 * Retrieve navigation data passed from previous page.
 * @returns {Object}
 */
export function getNavData() {
    const data = sessionStorage.getItem('navData');
    sessionStorage.removeItem('navData');
    return data ? JSON.parse(data) : {};
}

/**
 * Go back in history.
 */
export function goBack() {
    window.history.back();
}

// Expose navigateTo globally exactly as the HTML expects
window.router = { navigateTo };
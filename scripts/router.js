// frontend-user/scripts/router.js

/**
 * Full-featured Client-Side Router
 * Handles navigation from all buttons in every HTML page.
 * Supports:
 *   - Simple page names: 'welcome.html'
 *   - Query parameters: 'subject-specific.html?subject=anatomy'
 *   - Hash fragments: 'performance.html#weak'
 *   - Already absolute paths (ignores them, but unlikely to be used)
 * Enforces authentication and subscription checks (exam-room only).
 * Provides global window.router.navigateTo for onclick handlers.
 */

import * as app from './app.js';
import * as ui from './ui.js';
import * as utils from './utils.js';

// Route permission definitions
const ROUTES = {
    public: [
        'index.html',
        'welcome.html',
        'login.html',
        'signup.html',
        'forgot-password.html',
        'locked.html'
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

// Allowed navigation flows (source → [targets])
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

/**
 * Normalise and build absolute URL from a navigation target.
 * @param {string} target - e.g., 'welcome.html', 'subject-specific.html?subject=anatomy', 'performance.html#weak'
 * @returns {string} absolute path (e.g., '/pages/welcome.html', '/pages/subject-specific.html?subject=anatomy')
 */
function buildUrl(target) {
    // Split target into path and hash (preserve hash for later)
    const [pathAndQuery, hash] = target.split('#');
    let hashPart = hash ? `#${hash}` : '';

    // Split path into base and query
    const [base, query] = pathAndQuery.split('?');
    let queryPart = query ? `?${query}` : '';

    // Trim any leading/trailing slashes from base
    const cleanBase = base.replace(/^\/+|\/+$/g, '');

    // If it's already an absolute path (starts with /), assume it's correct
    if (base.startsWith('/')) {
        return base + queryPart + hashPart;
    }

    // Otherwise, map to correct location
    if (cleanBase === 'index.html') {
        return '/index.html' + queryPart + hashPart;
    } else {
        return `/pages/${cleanBase}` + queryPart + hashPart;
    }
}

/**
 * Check if navigation is allowed.
 * @param {string} targetPage - base filename (without query/hash)
 * @param {string} currentPage - current filename
 * @returns {boolean}
 */
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

    // Small delay to allow overlay to show
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
    if (path === '/' || path === '/index.html') return 'index.html';
    const parts = path.split('/');
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
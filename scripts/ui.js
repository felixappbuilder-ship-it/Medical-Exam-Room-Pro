// frontend-user/scripts/ui.js

/**
 * UI Controller
 * Handles loading overlays, toasts, modals, theme switching, form utilities,
 * password visibility, auto-save indicators, PWA install prompt, and page-specific renderers.
 * Used on all pages.
 */

import * as utils from './utils.js';

// ==================== LOADING OVERLAY ====================

let loadingOverlay = null;
let loadingTimeout = null;

/**
 * Show loading overlay with optional message
 * @param {string} message - optional message (not implemented but can be extended)
 */
export function showLoading(message = 'Loading...') {
    if (!loadingOverlay) {
        loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        loadingOverlay.innerHTML = '<div class="spinner"></div>';
        document.body.appendChild(loadingOverlay);
    }
    loadingOverlay.classList.remove('hidden');
    
    // Safety auto-hide after 10 seconds
    if (loadingTimeout) clearTimeout(loadingTimeout);
    loadingTimeout = setTimeout(() => {
        hideLoading();
        showToast('Loading took too long. Please try again.', 'error');
    }, 10000);
}

/**
 * Hide loading overlay
 */
export function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
    }
    if (loadingTimeout) {
        clearTimeout(loadingTimeout);
        loadingTimeout = null;
    }
}

// ==================== TOAST NOTIFICATIONS ====================

let toastContainer = null;

function ensureToastContainer() {
    if (!toastContainer) {
        toastContainer = document.querySelector('.toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container';
            document.body.appendChild(toastContainer);
        }
    }
}

/**
 * Show a toast notification
 * @param {string} message
 * @param {string} type - 'info', 'success', 'error', 'warning'
 * @param {number} duration - ms
 */
export function showToast(message, type = 'info', duration = 3000) {
    ensureToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    toastContainer.appendChild(toast);
    
    // Auto remove after duration
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 300);
    }, duration);
}

// ==================== MODAL DIALOGS ====================

let modalOverlay = null;

function ensureModalOverlay() {
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.style.display = 'none';
        document.body.appendChild(modalOverlay);
    }
}

/**
 * Show a confirmation dialog (modal)
 * @param {string} title
 * @param {string} message
 * @param {string} type - 'info', 'warning', 'critical'
 * @returns {Promise<boolean>} resolves true if confirmed, false if cancelled
 */
export function showConfirmationDialog(title, message, type = 'info') {
    return new Promise((resolve) => {
        ensureModalOverlay();
        
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <p>${message}</p>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" id="modal-cancel">Cancel</button>
                <button class="btn-${type === 'critical' ? 'danger' : 'primary'}" id="modal-confirm">OK</button>
            </div>
        `;
        
        modalOverlay.innerHTML = '';
        modalOverlay.appendChild(modal);
        modalOverlay.style.display = 'flex';
        
        const closeModal = (result) => {
            modalOverlay.style.display = 'none';
            modalOverlay.innerHTML = '';
            resolve(result);
        };
        
        modal.querySelector('.modal-close').addEventListener('click', () => closeModal(false));
        modal.querySelector('#modal-cancel').addEventListener('click', () => closeModal(false));
        modal.querySelector('#modal-confirm').addEventListener('click', () => closeModal(true));
        
        // Click outside to cancel
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) closeModal(false);
        });
    });
}

/**
 * Hide modal programmatically
 */
export function hideModal() {
    if (modalOverlay) {
        modalOverlay.style.display = 'none';
        modalOverlay.innerHTML = '';
    }
}

// ==================== THEME MANAGEMENT ====================

/**
 * Set theme ('light', 'dark', 'auto')
 * @param {string} theme
 */
export function setTheme(theme) {
    if (theme === 'auto') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.classList.toggle('dark-theme', prefersDark);
    } else {
        document.body.classList.toggle('dark-theme', theme === 'dark');
    }
    utils.setLocalStorage('theme', theme);
}

/**
 * Get current theme from localStorage or default 'auto'
 * @returns {string}
 */
export function getTheme() {
    return utils.getLocalStorage('theme', 'auto');
}

/**
 * Apply theme based on stored preference
 */
export function applyTheme() {
    const theme = getTheme();
    setTheme(theme);
}

/**
 * Toggle between light/dark
 */
export function toggleTheme() {
    const current = getTheme();
    let next;
    if (current === 'auto') {
        // from auto: go to dark if currently dark? simpler: toggle to dark
        const isDark = document.body.classList.contains('dark-theme');
        next = isDark ? 'light' : 'dark';
    } else if (current === 'dark') {
        next = 'light';
    } else {
        next = 'dark';
    }
    setTheme(next);
    showToast(`Switched to ${next} mode`, 'info', 1500);
}

// ==================== FORM HANDLING ====================

/**
 * Disable all inputs in a form
 * @param {string|HTMLElement} formId or form element
 */
export function disableForm(form) {
    const formEl = typeof form === 'string' ? document.getElementById(form) : form;
    if (!formEl) return;
    formEl.querySelectorAll('input, select, textarea, button').forEach(el => el.disabled = true);
}

/**
 * Enable all inputs in a form
 * @param {string|HTMLElement} form
 */
export function enableForm(form) {
    const formEl = typeof form === 'string' ? document.getElementById(form) : form;
    if (!formEl) return;
    formEl.querySelectorAll('input, select, textarea, button').forEach(el => el.disabled = false);
}

/**
 * Reset form to initial values
 * @param {string|HTMLElement} form
 */
export function resetForm(form) {
    const formEl = typeof form === 'string' ? document.getElementById(form) : form;
    if (formEl) formEl.reset();
}

/**
 * Show error message for a specific field
 * @param {string} fieldId - ID of the input field
 * @param {string} message - error message
 */
export function showFormError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    
    // Find error container
    let errorEl = document.querySelector(`.error-message[data-for="${fieldId}"]`);
    if (!errorEl) {
        errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.setAttribute('data-for', fieldId);
        field.parentNode.appendChild(errorEl);
    }
    errorEl.textContent = message;
    field.classList.add('error');
}

/**
 * Clear error message for a field
 * @param {string} fieldId
 */
export function clearFormError(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return;
    const errorEl = document.querySelector(`.error-message[data-for="${fieldId}"]`);
    if (errorEl) errorEl.textContent = '';
    field.classList.remove('error');
}

// ==================== PASSWORD VISIBILITY TOGGLE ====================

/**
 * Toggle password field visibility
 * @param {string} inputId
 */
export function togglePasswordVisibility(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const type = input.type === 'password' ? 'text' : 'password';
    input.type = type;
}

// ==================== VALIDATION SUMMARY ====================

/**
 * Show a summary of validation errors (e.g., from validation module)
 * @param {Array<string>} errors
 */
export function showValidationSummary(errors) {
    if (!errors || errors.length === 0) return;
    const message = errors.join('\n');
    showToast(message, 'error', 5000);
}

// ==================== PASSWORD STRENGTH INDICATOR ====================

/**
 * Update password strength meter
 * @param {Object} strength - from validation.checkPasswordStrength
 */
export function updatePasswordStrength(strength) {
    const meter = document.getElementById('password-strength');
    if (!meter) return;
    
    // Clear existing classes and content
    meter.className = 'strength-meter';
    meter.innerHTML = '';
    
    const fill = document.createElement('div');
    fill.className = 'fill';
    meter.appendChild(fill);
    
    if (strength.score === 0) {
        fill.style.width = '0%';
        meter.classList.add('strength-weak');
    } else if (strength.score <= 1) {
        fill.style.width = '33%';
        meter.classList.add('strength-weak');
    } else if (strength.score === 2) {
        fill.style.width = '66%';
        meter.classList.add('strength-medium');
    } else {
        fill.style.width = '100%';
        meter.classList.add('strength-strong');
    }
}

// ==================== AUTO-SAVE INDICATOR ====================

let autoSaveTimer;
export function showAutoSaveIndicator() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        showToast('Progress auto-saved', 'info', 1500);
    }, 500);
}

// ==================== INSTALL PROMPT ====================

let deferredPrompt;
/**
 * Setup install prompt for PWA (call from pages that have install button)
 * @param {string} buttonId - ID of install button
 */
export function setupInstallPrompt(buttonId) {
    const installBtn = document.getElementById(buttonId);
    if (!installBtn) return;
    
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        installBtn.style.display = 'inline-block';
    });
    
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            showToast('Thank you for installing!', 'success');
        }
        deferredPrompt = null;
        installBtn.style.display = 'none';
    });
}

// ==================== FEATURE GRID RENDERING ====================

/**
 * Render feature grid on landing page
 * @param {string} containerId
 * @param {Array} features
 */
export function renderFeatureGrid(containerId, features) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = features.map(f => `
        <div class="feature-card">
            <div class="feature-icon">${f.icon}</div>
            <h3>${f.title}</h3>
            <p>${f.desc}</p>
        </div>
    `).join('');
}

// ==================== TESTIMONIALS RENDERING ====================

/**
 * Render testimonials on landing page
 * @param {string} containerId
 * @param {Array} testimonials
 */
export function renderTestimonials(containerId, testimonials) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = testimonials.map(t => `
        <div class="testimonial">
            <p>"${t.text}"</p>
            <cite>— ${t.name}</cite>
        </div>
    `).join('');
}

// ==================== FAQ RENDERING ====================

/**
 * Render FAQ accordion
 * @param {string} containerId
 * @param {Array} faqs
 */
export function renderFaq(containerId, faqs) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = faqs.map((f, i) => `
        <div class="faq-item" id="faq-${i}">
            <div class="faq-question" onclick="document.getElementById('faq-${i}').classList.toggle('active')">
                <span>${f.q}</span>
                <span class="faq-icon">▼</span>
            </div>
            <div class="faq-answer">${f.a}</div>
        </div>
    `).join('');
}

// ==================== TAB SWITCHING ====================

/**
 * Switch active tab (used in profile.html)
 * @param {string} tabId - ID of tab content to show
 */
export function switchTab(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    // Deactivate all tab buttons
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    
    // Show selected tab
    const tab = document.getElementById(tabId);
    if (tab) tab.classList.add('active');
    
    // Find and activate corresponding button (button text contains tab name)
    const buttons = document.querySelectorAll('.tab-button');
    buttons.forEach(b => {
        if (b.textContent.toLowerCase().includes(tabId.replace('-tab', ''))) {
            b.classList.add('active');
        }
    });
}

// ==================== EXAM ROOM UI HELPERS ====================

/**
 * Update timer display with color
 * @param {HTMLElement} timerElement
 * @param {number} remainingMs
 * @param {number} totalMs
 */
export function updateTimerDisplay(timerElement, remainingMs, totalMs) {
    if (!timerElement) return;
    
    const percentage = remainingMs / totalMs;
    const seconds = Math.floor(remainingMs / 1000);
    timerElement.textContent = utils.formatTime(seconds);
    
    // Update color class
    timerElement.classList.remove('green', 'yellow', 'red', 'flash');
    if (percentage > 0.7) {
        timerElement.classList.add('green');
    } else if (percentage > 0.3) {
        timerElement.classList.add('yellow');
    } else if (percentage > 0.05) {
        timerElement.classList.add('red');
    } else {
        timerElement.classList.add('red', 'flash');
    }
}

// ==================== PROGRESS BAR UPDATE ====================

/**
 * Update progress bar width
 * @param {string} elementId
 * @param {number} percentage
 */
export function updateProgressBar(elementId, percentage) {
    const bar = document.getElementById(elementId);
    if (bar) {
        bar.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    }
}

// ==================== EXPOSE GLOBALLY FOR INLINE SCRIPTS ====================

// Attach all public functions to window.ui for use in onclick handlers
window.ui = {
    showToast,
    showLoading,
    hideLoading,
    showConfirmationDialog,
    hideModal,
    toggleTheme,
    applyTheme,
    getTheme,
    setTheme,
    disableForm,
    enableForm,
    resetForm,
    showFormError,
    clearFormError,
    togglePasswordVisibility,
    showValidationSummary,
    updatePasswordStrength,
    showAutoSaveIndicator,
    setupInstallPrompt,
    renderFeatureGrid,
    renderTestimonials,
    renderFaq,
    switchTab,
    updateTimerDisplay,
    updateProgressBar
};
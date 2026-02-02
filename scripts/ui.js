/**
 * Medical Exam Room Pro - UI Utility Functions (ui.js)
 * 
 * Purpose: DOM manipulation, animations, responsive design, theme switching
 * 
 * Features implemented according to blueprint:
 * - Responsive layout adjustments
 * - Theme switching (light/dark)
 * - Loading spinners & states
 * - Toast notifications
 * - Modal dialogs
 * - Form validation UI
 * - Progress bars
 * - Accessibility features
 */

// ==================== GLOBAL UI STATE ====================
const uiState = {
    currentTheme: 'light',
    notifications: [],
    modals: [],
    loadingStates: {}
};

// ==================== THEME MANAGEMENT ====================

/**
 * Initialize theme on app load
 */
function initTheme() {
    // Check saved theme or default to light
    const savedTheme = localStorage.getItem('theme') || 'light';
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    // Use saved theme, or system preference if no saved theme
    const theme = savedTheme !== 'light' && savedTheme !== 'dark' 
        ? (prefersDark ? 'dark' : 'light')
        : savedTheme;
    
    setTheme(theme);
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            setTheme(e.matches ? 'dark' : 'light');
        }
    });
}

/**
 * Set theme (light/dark)
 * @param {string} theme - 'light' or 'dark'
 */
function setTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
    } else {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
    }
    
    uiState.currentTheme = theme;
    localStorage.setItem('theme', theme);
    
    // Update theme toggle buttons if they exist
    updateThemeToggleButtons(theme);
    
    // Dispatch theme change event
    document.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
}

/**
 * Toggle between light and dark themes
 */
function toggleTheme() {
    const newTheme = uiState.currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}

/**
 * Update all theme toggle buttons on the page
 * @param {string} theme - Current theme
 */
function updateThemeToggleButtons(theme) {
    document.querySelectorAll('.theme-toggle').forEach(button => {
        const icon = button.querySelector('.theme-icon');
        const text = button.querySelector('.theme-text');
        
        if (icon) {
            icon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
        if (text) {
            text.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
        }
    });
}

// ==================== LOADING STATES ====================

/**
 * Show loading spinner
 * @param {string} elementId - Optional element ID to show spinner inside
 * @param {string} message - Optional loading message
 * @returns {string} loaderId - ID of the created loader
 */
function showLoader(elementId = null, message = 'Loading...') {
    const loaderId = 'loader_' + Date.now();
    
    const loaderHTML = `
        <div class="loader-overlay" id="${loaderId}">
            <div class="loader-content">
                <div class="loader-spinner"></div>
                ${message ? `<div class="loader-message">${message}</div>` : ''}
            </div>
        </div>
    `;
    
    const loaderElement = document.createElement('div');
    loaderElement.innerHTML = loaderHTML;
    const loader = loaderElement.firstElementChild;
    
    if (elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            element.appendChild(loader);
            element.style.position = 'relative';
        } else {
            document.body.appendChild(loader);
        }
    } else {
        document.body.appendChild(loader);
    }
    
    // Store reference
    uiState.loadingStates[loaderId] = loader;
    
    // Add CSS if not already added
    if (!document.querySelector('#loader-styles')) {
        addLoaderStyles();
    }
    
    return loaderId;
}

/**
 * Add loader CSS styles
 */
function addLoaderStyles() {
    const styles = `
        .loader-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255, 255, 255, 0.9);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            backdrop-filter: blur(2px);
        }
        
        .dark-theme .loader-overlay {
            background: rgba(0, 0, 0, 0.9);
        }
        
        .loader-content {
            text-align: center;
            padding: 2rem;
            background: white;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
        }
        
        .dark-theme .loader-content {
            background: #2d2d2d;
            color: white;
        }
        
        .loader-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #2196F3;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }
        
        .dark-theme .loader-spinner {
            border-color: #444;
            border-top-color: #2196F3;
        }
        
        .loader-message {
            font-size: 0.9rem;
            color: #666;
        }
        
        .dark-theme .loader-message {
            color: #ccc;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        /* Inline loader */
        .inline-loader {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid #f3f3f3;
            border-top: 2px solid #2196F3;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            vertical-align: middle;
            margin-right: 8px;
        }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.id = 'loader-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

/**
 * Hide loading spinner
 * @param {string} loaderId - ID of loader to hide
 */
function hideLoader(loaderId) {
    const loader = uiState.loadingStates[loaderId];
    if (loader && loader.parentNode) {
        loader.style.opacity = '0';
        loader.style.transition = 'opacity 0.3s';
        
        setTimeout(() => {
            if (loader.parentNode) {
                loader.parentNode.removeChild(loader);
            }
            delete uiState.loadingStates[loaderId];
        }, 300);
    }
}

/**
 * Show inline loading state on a button
 * @param {HTMLElement} button - Button element
 * @param {string} loadingText - Text to show while loading
 */
function showButtonLoading(button, loadingText = 'Loading...') {
    // Save original content
    button.dataset.originalContent = button.innerHTML;
    button.dataset.originalDisabled = button.disabled;
    
    // Set loading state
    button.innerHTML = `
        <span class="inline-loader"></span>
        ${loadingText}
    `;
    button.disabled = true;
}

/**
 * Hide inline loading state from a button
 * @param {HTMLElement} button - Button element
 */
function hideButtonLoading(button) {
    if (button.dataset.originalContent) {
        button.innerHTML = button.dataset.originalContent;
        button.disabled = button.dataset.originalDisabled === 'true';
        delete button.dataset.originalContent;
        delete button.dataset.originalDisabled;
    }
}

// ==================== TOAST NOTIFICATIONS ====================

/**
 * Show toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in milliseconds (0 = persistent)
 * @returns {string} toastId - ID of created toast
 */
function showToast(message, type = 'info', duration = 5000) {
    const toastId = 'toast_' + Date.now();
    
    // Create toast element
    const toast = document.createElement('div');
    toast.id = toastId;
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    
    // Set icon based on type
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-message">${message}</div>
        <button class="toast-close" aria-label="Close notification">×</button>
    `;
    
    // Add to document
    document.body.appendChild(toast);
    
    // Add CSS if not already added
    if (!document.querySelector('#toast-styles')) {
        addToastStyles();
    }
    
    // Animate in
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Store reference
    uiState.notifications.push(toastId);
    
    // Auto-remove after duration
    if (duration > 0) {
        setTimeout(() => {
            hideToast(toastId);
        }, duration);
    }
    
    // Close button handler
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => hideToast(toastId));
    
    return toastId;
}

/**
 * Add toast CSS styles
 */
function addToastStyles() {
    const styles = `
        .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            color: #333;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            display: flex;
            align-items: center;
            gap: 1rem;
            z-index: 10000;
            max-width: 400px;
            transform: translateX(150%);
            transition: transform 0.3s ease;
            border-left: 4px solid #2196F3;
        }
        
        .toast.show {
            transform: translateX(0);
        }
        
        .dark-theme .toast {
            background: #2d2d2d;
            color: white;
        }
        
        .toast-success {
            border-left-color: #4CAF50;
        }
        
        .toast-error {
            border-left-color: #F44336;
        }
        
        .toast-warning {
            border-left-color: #FF9800;
        }
        
        .toast-info {
            border-left-color: #2196F3;
        }
        
        .toast-icon {
            font-size: 1.2rem;
        }
        
        .toast-message {
            flex: 1;
            font-size: 0.95rem;
            line-height: 1.4;
        }
        
        .toast-close {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background 0.2s;
        }
        
        .dark-theme .toast-close {
            color: #aaa;
        }
        
        .toast-close:hover {
            background: rgba(0, 0, 0, 0.1);
        }
        
        .dark-theme .toast-close:hover {
            background: rgba(255, 255, 255, 0.1);
        }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.id = 'toast-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

/**
 * Hide toast notification
 * @param {string} toastId - ID of toast to hide
 */
function hideToast(toastId) {
    const toast = document.getElementById(toastId);
    if (toast) {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            // Remove from state
            const index = uiState.notifications.indexOf(toastId);
            if (index > -1) {
                uiState.notifications.splice(index, 1);
            }
        }, 300);
    }
}

/**
 * Hide all toast notifications
 */
function hideAllToasts() {
    uiState.notifications.forEach(toastId => {
        hideToast(toastId);
    });
    uiState.notifications = [];
}

// ==================== MODAL DIALOGS ====================

/**
 * Show modal dialog
 * @param {string|HTMLElement} content - HTML string or element
 * @param {object} options - Modal options
 * @returns {string} modalId - ID of created modal
 */
function showModal(content, options = {}) {
    const modalId = 'modal_' + Date.now();
    const modalOptions = {
        title: options.title || '',
        size: options.size || 'medium',
        closable: options.closable !== false,
        ...options
    };
    
    // Create modal element
    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', `${modalId}_title`);
    
    modal.innerHTML = `
        <div class="modal-dialog modal-${modalOptions.size}">
            <div class="modal-header">
                <h3 id="${modalId}_title">${modalOptions.title}</h3>
                ${modalOptions.closable ? 
                    `<button class="modal-close" aria-label="Close dialog">×</button>` : 
                    ''
                }
            </div>
            <div class="modal-body" id="${modalId}_body">
                ${typeof content === 'string' ? content : ''}
            </div>
            ${modalOptions.footer ? `
                <div class="modal-footer">
                    ${modalOptions.footer}
                </div>
            ` : ''}
        </div>
    `;
    
    // Add to document
    document.body.appendChild(modal);
    
    // If content is an element, move it to modal
    if (content instanceof HTMLElement) {
        const modalBody = document.getElementById(`${modalId}_body`);
        if (modalBody) {
            modalBody.appendChild(content);
        }
    }
    
    // Add CSS if not already added
    if (!document.querySelector('#modal-styles')) {
        addModalStyles();
    }
    
    // Store reference
    uiState.modals.push(modalId);
    
    // Show modal
    setTimeout(() => {
        modal.classList.add('show');
    }, 10);
    
    // Close button handler
    if (modalOptions.closable) {
        const closeBtn = modal.querySelector('.modal-close');
        closeBtn.addEventListener('click', () => hideModal(modalId));
        
        // Close on overlay click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideModal(modalId);
            }
        });
    }
    
    // Close on Escape key
    const escapeHandler = (e) => {
        if (e.key === 'Escape' && modalOptions.closable) {
            hideModal(modalId);
        }
    };
    
    modal._escapeHandler = escapeHandler;
    document.addEventListener('keydown', escapeHandler);
    
    // Focus trap
    setFocusTrap(modal);
    
    return modalId;
}

/**
 * Add modal CSS styles
 */
function addModalStyles() {
    const styles = `
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9998;
            opacity: 0;
            visibility: hidden;
            transition: opacity 0.3s, visibility 0.3s;
        }
        
        .modal-overlay.show {
            opacity: 1;
            visibility: visible;
        }
        
        .modal-dialog {
            background: white;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            max-width: 90%;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            transform: translateY(-20px);
            transition: transform 0.3s;
        }
        
        .modal-overlay.show .modal-dialog {
            transform: translateY(0);
        }
        
        .dark-theme .modal-dialog {
            background: #2d2d2d;
            color: white;
        }
        
        .modal-small {
            width: 400px;
        }
        
        .modal-medium {
            width: 600px;
        }
        
        .modal-large {
            width: 800px;
        }
        
        .modal-full {
            width: 95%;
            height: 95vh;
        }
        
        .modal-header {
            padding: 1.5rem 1.5rem 1rem;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .dark-theme .modal-header {
            border-bottom-color: #444;
        }
        
        .modal-header h3 {
            margin: 0;
            font-size: 1.2rem;
        }
        
        .modal-close {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #666;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background 0.2s;
        }
        
        .dark-theme .modal-close {
            color: #aaa;
        }
        
        .modal-close:hover {
            background: rgba(0, 0, 0, 0.1);
        }
        
        .dark-theme .modal-close:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .modal-body {
            padding: 1.5rem;
            overflow-y: auto;
            flex: 1;
        }
        
        .modal-footer {
            padding: 1rem 1.5rem 1.5rem;
            border-top: 1px solid #eee;
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
        }
        
        .dark-theme .modal-footer {
            border-top-color: #444;
        }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.id = 'modal-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

/**
 * Hide modal dialog
 * @param {string} modalId - ID of modal to hide
 */
function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
        
        // Remove escape handler
        if (modal._escapeHandler) {
            document.removeEventListener('keydown', modal._escapeHandler);
        }
        
        setTimeout(() => {
            if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
            }
            // Remove from state
            const index = uiState.modals.indexOf(modalId);
            if (index > -1) {
                uiState.modals.splice(index, 1);
            }
        }, 300);
    }
}

/**
 * Hide all modal dialogs
 */
function hideAllModals() {
    uiState.modals.forEach(modalId => {
        hideModal(modalId);
    });
    uiState.modals = [];
}

// ==================== FORM VALIDATION UI ====================

/**
 * Show form validation error
 * @param {HTMLElement} input - Input element
 * @param {string} message - Error message
 */
function showValidationError(input, message) {
    // Remove existing error
    hideValidationError(input);
    
    // Create error element
    const errorId = `error_${input.name || input.id}_${Date.now()}`;
    const errorElement = document.createElement('div');
    errorElement.id = errorId;
    errorElement.className = 'validation-error';
    errorElement.textContent = message;
    errorElement.setAttribute('role', 'alert');
    
    // Add error class to input
    input.classList.add('has-error');
    
    // Insert error after input
    const parent = input.parentNode;
    if (parent) {
        parent.insertBefore(errorElement, input.nextSibling);
    }
    
    // Store error ID on input
    input.dataset.errorId = errorId;
    
    // Focus input
    input.focus();
    
    // Add CSS if not already added
    if (!document.querySelector('#validation-styles')) {
        addValidationStyles();
    }
}

/**
 * Add validation CSS styles
 */
function addValidationStyles() {
    const styles = `
        .validation-error {
            color: #F44336;
            font-size: 0.85rem;
            margin-top: 0.25rem;
            animation: fadeIn 0.3s;
        }
        
        .has-error {
            border-color: #F44336 !important;
        }
        
        .has-error:focus {
            outline-color: #F44336 !important;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-5px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.id = 'validation-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

/**
 * Hide form validation error
 * @param {HTMLElement} input - Input element
 */
function hideValidationError(input) {
    // Remove error class
    input.classList.remove('has-error');
    
    // Remove error element
    const errorId = input.dataset.errorId;
    if (errorId) {
        const errorElement = document.getElementById(errorId);
        if (errorElement && errorElement.parentNode) {
            errorElement.parentNode.removeChild(errorElement);
        }
        delete input.dataset.errorId;
    }
}

/**
 * Validate form and show errors
 * @param {HTMLFormElement} form - Form to validate
 * @param {object} rules - Validation rules
 * @returns {boolean} isValid
 */
function validateForm(form, rules = {}) {
    let isValid = true;
    const inputs = form.querySelectorAll('input, select, textarea');
    
    // Clear all errors first
    inputs.forEach(input => hideValidationError(input));
    
    // Validate each input
    inputs.forEach(input => {
        const value = input.value.trim();
        const name = input.name || input.id;
        const fieldRules = rules[name] || {};
        
        // Required validation
        if (fieldRules.required && !value) {
            showValidationError(input, fieldRules.requiredMessage || 'This field is required');
            isValid = false;
        }
        
        // Email validation
        if (fieldRules.email && value) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                showValidationError(input, fieldRules.emailMessage || 'Please enter a valid email');
                isValid = false;
            }
        }
        
        // Phone validation (Kenyan)
        if (fieldRules.phone && value) {
            const phoneDigits = value.replace(/\D/g, '');
            const isValidPhone = (phoneDigits.length === 12 && phoneDigits.startsWith('254')) ||
                               (phoneDigits.length === 9 && phoneDigits.startsWith('7')) ||
                               (phoneDigits.length === 10 && phoneDigits.startsWith('07'));
            
            if (!isValidPhone) {
                showValidationError(input, fieldRules.phoneMessage || 'Please enter a valid Kenyan phone number');
                isValid = false;
            }
        }
        
        // Password strength
        if (fieldRules.password && value) {
            const hasUpperCase = /[A-Z]/.test(value);
            const hasLowerCase = /[a-z]/.test(value);
            const hasNumbers = /\d/.test(value);
            const hasMinLength = value.length >= 8;
            
            if (!hasMinLength || !hasUpperCase || !hasLowerCase || !hasNumbers) {
                showValidationError(input, fieldRules.passwordMessage || 
                    'Password must be at least 8 characters with uppercase, lowercase, and numbers');
                isValid = false;
            }
        }
        
        // Min length
        if (fieldRules.minLength && value.length < fieldRules.minLength) {
            showValidationError(input, 
                fieldRules.minLengthMessage || `Minimum ${fieldRules.minLength} characters required`);
            isValid = false;
        }
        
        // Max length
        if (fieldRules.maxLength && value.length > fieldRules.maxLength) {
            showValidationError(input, 
                fieldRules.maxLengthMessage || `Maximum ${fieldRules.maxLength} characters allowed`);
            isValid = false;
        }
        
        // Pattern validation
        if (fieldRules.pattern && value) {
            const pattern = new RegExp(fieldRules.pattern);
            if (!pattern.test(value)) {
                showValidationError(input, fieldRules.patternMessage || 'Invalid format');
                isValid = false;
            }
        }
        
        // Confirm password
        if (fieldRules.confirm && value) {
            const originalField = form.querySelector(`[name="${fieldRules.confirm}"]`);
            if (originalField && originalField.value !== value) {
                showValidationError(input, 'Passwords do not match');
                isValid = false;
            }
        }
    });
    
    return isValid;
}

// ==================== PROGRESS BARS ====================

/**
 * Update progress bar
 * @param {HTMLElement|string} element - Progress bar element or selector
 * @param {number} percentage - Percentage (0-100)
 * @param {string} text - Optional text to display
 */
function updateProgress(element, percentage, text = '') {
    const progressBar = typeof element === 'string' ? 
        document.querySelector(element) : element;
    
    if (!progressBar) return;
    
    // Ensure it has the right structure
    if (!progressBar.classList.contains('progress-bar')) {
        progressBar.classList.add('progress-bar');
    }
    
    // Find or create progress fill
    let progressFill = progressBar.querySelector('.progress-fill');
    let progressText = progressBar.querySelector('.progress-text');
    
    if (!progressFill) {
        progressFill = document.createElement('div');
        progressFill.className = 'progress-fill';
        progressBar.appendChild(progressFill);
    }
    
    if (text && !progressText) {
        progressText = document.createElement('div');
        progressText.className = 'progress-text';
        progressBar.appendChild(progressText);
    }
    
    // Update progress
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    progressFill.style.width = `${clampedPercentage}%`;
    
    // Update color based on percentage
    if (clampedPercentage < 30) {
        progressFill.style.backgroundColor = '#F44336';
    } else if (clampedPercentage < 70) {
        progressFill.style.backgroundColor = '#FF9800';
    } else {
        progressFill.style.backgroundColor = '#4CAF50';
    }
    
    // Update text
    if (progressText) {
        progressText.textContent = text || `${Math.round(clampedPercentage)}%`;
    }
    
    // Add CSS if not already added
    if (!document.querySelector('#progress-styles')) {
        addProgressStyles();
    }
}

/**
 * Add progress bar CSS styles
 */
function addProgressStyles() {
    const styles = `
        .progress-bar {
            width: 100%;
            height: 8px;
            background-color: #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
            position: relative;
        }
        
        .dark-theme .progress-bar {
            background-color: #444;
        }
        
        .progress-fill {
            height: 100%;
            border-radius: 4px;
            transition: width 0.3s ease, background-color 0.3s ease;
        }
        
        .progress-text {
            margin-top: 0.5rem;
            font-size: 0.9rem;
            color: #666;
            text-align: center;
        }
        
        .dark-theme .progress-text {
            color: #ccc;
        }
    `;
    
    const styleSheet = document.createElement('style');
    styleSheet.id = 'progress-styles';
    styleSheet.textContent = styles;
    document.head.appendChild(styleSheet);
}

// ==================== ACCESSIBILITY FEATURES ====================

/**
 * Set focus trap for modal or dialog
 * @param {HTMLElement} container - Container element
 */
function setFocusTrap(container) {
    const focusableElements = container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    if (focusableElements.length === 0) return;
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    // Trap focus within container
    container.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
            if (e.shiftKey) {
                // Shift + Tab
                if (document.activeElement === firstElement) {
                    e.preventDefault();
                    lastElement.focus();
                }
            } else {
                // Tab
                if (document.activeElement === lastElement) {
                    e.preventDefault();
                    firstElement.focus();
                }
            }
        }
    });
    
    // Focus first element
    setTimeout(() => firstElement.focus(), 100);
}

/**
 * Announce text to screen readers
 * @param {string} text - Text to announce
 * @param {string} politeness - 'polite' or 'assertive'
 */
function announceToScreenReader(text, politeness = 'polite') {
    // Remove existing announcement
    const existing = document.getElementById('sr-announcement');
    if (existing) {
        existing.parentNode.removeChild(existing);
    }
    
    // Create announcement element
    const announcement = document.createElement('div');
    announcement.id = 'sr-announcement';
    announcement.setAttribute('aria-live', politeness);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    
    // Add to document
    document.body.appendChild(announcement);
    
    // Update text (triggers announcement)
    setTimeout(() => {
        announcement.textContent = text;
    }, 100);
    
    // Remove after announcement
    setTimeout(() => {
        if (announcement.parentNode) {
            announcement.parentNode.removeChild(announcement);
        }
    }, 1000);
}

/**
 * Add ARIA labels to interactive elements
 */
function enhanceAccessibility() {
    // Add ARIA labels to buttons without text
    document.querySelectorAll('button:not([aria-label])').forEach(button => {
        if (!button.textContent.trim() && !button.querySelector('img')) {
            const icon = button.querySelector('.icon, [class*="icon"], i');
            if (icon) {
                const label = icon.className.match(/fa-([a-z-]+)/) || 
                            icon.className.match(/icon-([a-z-]+)/);
                if (label) {
                    button.setAttribute('aria-label', label[1].replace('-', ' '));
                }
            }
        }
    });
    
    // Ensure all images have alt text
    document.querySelectorAll('img:not([alt])').forEach(img => {
        img.setAttribute('alt', '');
    });
    
    // Add skip to content link
    if (!document.getElementById('skip-to-content')) {
        const skipLink = document.createElement('a');
        skipLink.id = 'skip-to-content';
        skipLink.href = '#main-content';
        skipLink.className = 'sr-only';
        skipLink.textContent = 'Skip to main content';
        document.body.insertBefore(skipLink, document.body.firstChild);
    }
}

// ==================== RESPONSIVE DESIGN ====================

/**
 * Check if device is mobile
 * @returns {boolean}
 */
function isMobile() {
    return window.innerWidth <= 768;
}

/**
 * Check if device is tablet
 * @returns {boolean}
 */
function isTablet() {
    return window.innerWidth > 768 && window.innerWidth <= 1024;
}

/**
 * Check if device is desktop
 * @returns {boolean}
 */
function isDesktop() {
    return window.innerWidth > 1024;
}

/**
 * Add responsive class to body
 */
function addResponsiveClasses() {
    const body = document.body;
    
    // Remove existing classes
    body.classList.remove('is-mobile', 'is-tablet', 'is-desktop');
    
    // Add appropriate class
    if (isMobile()) {
        body.classList.add('is-mobile');
    } else if (isTablet()) {
        body.classList.add('is-tablet');
    } else {
        body.classList.add('is-desktop');
    }
}

/**
 * Initialize responsive design
 */
function initResponsive() {
    // Add initial classes
    addResponsiveClasses();
    
    // Update on resize (with debounce)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            addResponsiveClasses();
            document.dispatchEvent(new CustomEvent('viewportChanged'));
        }, 250);
    });
}

// ==================== ANIMATIONS ====================

/**
 * Animate element with CSS transition
 * @param {HTMLElement} element - Element to animate
 * @param {string} animation - Animation name
 * @param {number} duration - Duration in ms
 */
function animateTransition(element, animation, duration = 300) {
    // Add animation class
    element.classList.add(`animate-${animation}`);
    element.style.animationDuration = `${duration}ms`;
    
    // Remove animation class after completion
    setTimeout(() => {
        element.classList.remove(`animate-${animation}`);
        element.style.animationDuration = '';
    }, duration);
}

/**
 * Create fade in animation
 * @param {HTMLElement} element - Element to fade in
 * @param {number} duration - Duration in ms
 */
function fadeIn(element, duration = 300) {
    element.style.opacity = '0';
    element.style.display = 'block';
    element.style.transition = `opacity ${duration}ms ease`;
    
    // Trigger reflow
    element.offsetHeight;
    
    element.style.opacity = '1';
    
    setTimeout(() => {
        element.style.transition = '';
    }, duration);
}

/**
 * Create fade out animation
 * @param {HTMLElement} element - Element to fade out
 * @param {number} duration - Duration in ms
 * @param {boolean} hideAfter - Hide element after fade
 */
function fadeOut(element, duration = 300, hideAfter = true) {
    element.style.opacity = '1';
    element.style.transition = `opacity ${duration}ms ease`;
    
    // Trigger reflow
    element.offsetHeight;
    
    element.style.opacity = '0';
    
    setTimeout(() => {
        element.style.transition = '';
        if (hideAfter) {
            element.style.display = 'none';
        }
    }, duration);
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Debounce function for performance
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function for performance
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in ms
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Format number with commas
 * @param {number} number - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format date to readable string
 * @param {Date|string|number} date - Date to format
 * @param {string} format - Format string
 * @returns {string} Formatted date
 */
function formatDate(date, format = 'medium') {
    const d = new Date(date);
    const formats = {
        short: `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`,
        medium: d.toLocaleDateString('en-US', { 
            weekday: 'short', 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        }),
        long: d.toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        }),
        time: d.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
        })
    };
    return formats[format] || d.toLocaleDateString();
}

// ==================== INITIALIZATION ====================

/**
 * Initialize all UI components
 */
function initUI() {
    // Initialize theme
    initTheme();
    
    // Initialize responsive design
    initResponsive();
    
    // Enhance accessibility
    enhanceAccessibility();
    
    // Add CSS for screen reader only class
    if (!document.querySelector('#sr-styles')) {
        const srStyles = document.createElement('style');
        srStyles.id = 'sr-styles';
        srStyles.textContent = `
            .sr-only {
                position: absolute;
                width: 1px;
                height: 1px;
                padding: 0;
                margin: -1px;
                overflow: hidden;
                clip: rect(0, 0, 0, 0);
                white-space: nowrap;
                border: 0;
            }
        `;
        document.head.appendChild(srStyles);
    }
    
    console.log('UI components initialized');
}

// ==================== EXPORT UI OBJECT ====================
// Create a global UI object with all functions
window.ui = {
    // Theme
    initTheme,
    setTheme,
    toggleTheme,
    
    // Loading states
    showLoader,
    hideLoader,
    showButtonLoading,
    hideButtonLoading,
    
    // Notifications
    showToast,
    hideToast,
    hideAllToasts,
    
    // Modals
    showModal,
    hideModal,
    hideAllModals,
    
    // Forms
    showValidationError,
    hideValidationError,
    validateForm,
    
    // Progress
    updateProgress,
    
    // Accessibility
    setFocusTrap,
    announceToScreenReader,
    enhanceAccessibility,
    
    // Responsive
    isMobile,
    isTablet,
    isDesktop,
    initResponsive,
    
    // Animations
    animateTransition,
    fadeIn,
    fadeOut,
    
    // Utilities
    debounce,
    throttle,
    formatNumber,
    formatDate,
    
    // Initialization
    initUI,
    
    // State
    state: uiState
};

// Auto-initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.ui.initUI();
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.ui;
}
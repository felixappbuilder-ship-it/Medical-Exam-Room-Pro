// frontend-user/scripts/validation.js

/**
 * Form Validation Module
 * Handles all input validation, sanitization, and real-time validation.
 * Supports Kenyan phone numbers, email, password strength, and custom rules.
 */

import * as utils from './utils.js';
import * as ui from './ui.js';

// ==================== EMAIL VALIDATION ====================

/**
 * Validate email format
 * @param {string} email
 * @returns {boolean}
 */
export function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    // RFC 5322 compliant regex (simplified)
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(email.trim().toLowerCase());
}

// ==================== KENYAN PHONE VALIDATION ====================

/**
 * Validate Kenyan phone number
 * Accepts: 0712345678, 0112345678, 254712345678, 254112345678, +254712345678
 * @param {string} phone
 * @returns {boolean}
 */
export function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    
    // Remove all non-digits
    const digits = phone.replace(/\D/g, '');
    
    // Check valid Kenyan formats
    // Safaricom, Airtel, Telkom prefixes: 07, 01, 2547, 2541
    return (
        (digits.length === 9 && digits.startsWith('7')) ||      // 712345678
        (digits.length === 10 && digits.startsWith('07')) ||    // 0712345678
        (digits.length === 10 && digits.startsWith('01')) ||    // 0112345678
        (digits.length === 12 && digits.startsWith('2547')) ||  // 254712345678
        (digits.length === 12 && digits.startsWith('2541'))     // 254112345678
    );
}

/**
 * Format Kenyan phone number to 254XXXXXXXXX
 * @param {string} phone
 * @returns {string|null} formatted number or null if invalid
 */
export function formatKenyanPhone(phone) {
    if (!phone) return null;
    
    const digits = phone.replace(/\D/g, '');
    
    // 0712345678 -> 254712345678
    if (digits.length === 10 && digits.startsWith('07')) {
        return '254' + digits.substring(1);
    }
    // 0112345678 -> 254112345678
    if (digits.length === 10 && digits.startsWith('01')) {
        return '254' + digits.substring(1);
    }
    // 712345678 -> 254712345678
    if (digits.length === 9 && digits.startsWith('7')) {
        return '254' + digits;
    }
    // 112345678 -> 254112345678
    if (digits.length === 9 && digits.startsWith('1')) {
        return '254' + digits;
    }
    // Already 2547... or 2541...
    if (digits.length === 12 && (digits.startsWith('2547') || digits.startsWith('2541'))) {
        return digits;
    }
    
    return null;
}

/**
 * Validate phone specifically for M-Pesa (must be 2547 or 2541, 12 digits)
 * @param {string} phone
 * @returns {boolean}
 */
export function validateMPesaNumber(phone) {
    const formatted = formatKenyanPhone(phone);
    return formatted !== null && (formatted.startsWith('2547') || formatted.startsWith('2541'));
}

// ==================== PASSWORD VALIDATION ====================

/**
 * Check password strength
 * @param {string} password
 * @returns {Object} { isValid: boolean, score: number (0-4), errors: string[] }
 */
export function validatePassword(password) {
    const errors = [];
    
    if (!password || password.length < 8) {
        errors.push('Password must be at least 8 characters');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Must contain at least one number');
    }
    
    // Optional: special characters
    // if (!/[!@#$%^&*]/.test(password)) {
    //     errors.push('Must contain at least one special character');
    // }
    
    return {
        isValid: errors.length === 0,
        score: 4 - errors.length, // 0-4 scale
        errors
    };
}

/**
 * Calculate password strength score and return UI-friendly object
 * @param {string} password
 * @returns {Object} { score: number, feedback: string }
 */
export function checkPasswordStrength(password) {
    const result = validatePassword(password);
    let feedback = '';
    
    if (result.score === 0) feedback = 'Very weak';
    else if (result.score === 1) feedback = 'Weak';
    else if (result.score === 2) feedback = 'Medium';
    else if (result.score === 3) feedback = 'Strong';
    else if (result.score === 4) feedback = 'Very strong';
    
    return {
        score: result.score,
        feedback,
        errors: result.errors
    };
}

// ==================== NAME VALIDATION ====================

/**
 * Validate person's name
 * @param {string} name
 * @param {number} minLength
 * @returns {boolean}
 */
export function validateName(name, minLength = 2) {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    return trimmed.length >= minLength && /^[A-Za-z\s\-']+$/.test(trimmed);
}

// ==================== AMOUNT VALIDATION ====================

/**
 * Validate currency amount (KES)
 * @param {number|string} amount
 * @param {number} min - minimum allowed
 * @returns {boolean}
 */
export function validateAmount(amount, min = 0) {
    const num = parseFloat(amount);
    return !isNaN(num) && num >= min && num <= 150000; // M-Pesa max is 150,000
}

/**
 * Validate KES amount (for payments)
 * @param {number|string} amount
 * @returns {boolean}
 */
export function validateKESAmount(amount) {
    return validateAmount(amount, 10); // Minimum KES 10
}

// ==================== FORM VALIDATION ====================

/**
 * Validate an entire form against a ruleset
 * @param {Object} formData - { fieldName: value }
 * @param {Object} rules - { fieldName: { required, email, phone, min, max, pattern, equalTo } }
 * @returns {Object} { valid: boolean, errors: { fieldName: string[] } }
 */
export function validateForm(formData, rules) {
    const errors = {};
    let isValid = true;
    
    for (const [field, value] of Object.entries(formData)) {
        const fieldRules = rules[field];
        if (!fieldRules) continue;
        
        const fieldErrors = [];
        
        // Required check
        if (fieldRules.required && (!value || value.toString().trim() === '')) {
            fieldErrors.push(`${field} is required`);
        }
        
        // Skip other validations if empty and not required
        if ((!value || value.toString().trim() === '') && !fieldRules.required) {
            continue;
        }
        
        const stringValue = value ? value.toString().trim() : '';
        
        // Email validation
        if (fieldRules.email && !validateEmail(stringValue)) {
            fieldErrors.push('Invalid email format');
        }
        
        // Phone validation
        if (fieldRules.phone && !validatePhone(stringValue)) {
            fieldErrors.push('Invalid Kenyan phone number');
        }
        
        // Min length
        if (fieldRules.min && stringValue.length < fieldRules.min) {
            fieldErrors.push(`Minimum length is ${fieldRules.min} characters`);
        }
        
        // Max length
        if (fieldRules.max && stringValue.length > fieldRules.max) {
            fieldErrors.push(`Maximum length is ${fieldRules.max} characters`);
        }
        
        // Pattern
        if (fieldRules.pattern && !new RegExp(fieldRules.pattern).test(stringValue)) {
            fieldErrors.push('Invalid format');
        }
        
        // Equal to (confirmation fields)
        if (fieldRules.equalTo && formData[fieldRules.equalTo] !== value) {
            fieldErrors.push('Fields do not match');
        }
        
        // Custom validator
        if (fieldRules.validator && typeof fieldRules.validator === 'function') {
            const customResult = fieldRules.validator(value, formData);
            if (customResult !== true) {
                fieldErrors.push(customResult);
            }
        }
        
        if (fieldErrors.length > 0) {
            errors[field] = fieldErrors;
            isValid = false;
        }
    }
    
    return { valid: isValid, errors };
}

/**
 * Validate a single field
 * @param {string} field
 * @param {*} value
 * @param {Object} rules
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateField(field, value, rules) {
    const formData = { [field]: value };
    const fieldRules = { [field]: rules };
    const result = validateForm(formData, fieldRules);
    return {
        valid: !result.errors[field],
        errors: result.errors[field] || []
    };
}

// ==================== REAL-TIME VALIDATION ====================

/**
 * Set up live validation on a form
 * @param {string} formId
 * @param {Object} rules
 */
export function setupLiveValidation(formId, rules) {
    const form = document.getElementById(formId);
    if (!form) return;
    
    const inputs = form.querySelectorAll('input, select, textarea');
    
    inputs.forEach(input => {
        const fieldName = input.name || input.id;
        if (!fieldName || !rules[fieldName]) return;
        
        input.addEventListener('input', debounce(function() {
            const value = input.type === 'checkbox' ? input.checked : input.value;
            const result = validateField(fieldName, value, rules[fieldName]);
            
            // Clear previous errors
            ui.clearFormError(input.id || fieldName);
            
            // Show new errors
            if (!result.valid && result.errors.length > 0) {
                ui.showFormError(input.id || fieldName, result.errors[0]);
            }
        }, 300));
        
        input.addEventListener('blur', function() {
            const value = input.type === 'checkbox' ? input.checked : input.value;
            const result = validateField(fieldName, value, rules[fieldName]);
            
            ui.clearFormError(input.id || fieldName);
            if (!result.valid && result.errors.length > 0) {
                ui.showFormError(input.id || fieldName, result.errors[0]);
            }
        });
    });
}

// Simple debounce for live validation
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
 * Clear all validation errors on a form
 * @param {string} formId
 */
export function clearValidationErrors(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    
    const inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
        ui.clearFormError(input.id || input.name);
    });
}

/**
 * Show validation summary (usually at top of form)
 * @param {Object} errors - from validateForm
 */
export function showValidationSummary(errors) {
    const allErrors = Object.values(errors).flat();
    if (allErrors.length > 0) {
        ui.showValidationSummary(allErrors);
    }
}

// ==================== CUSTOM KENYAN VALIDATORS ====================

/**
 * Validate Kenyan ID number (simplified)
 * @param {string} id
 * @returns {boolean}
 */
export function validateKenyanID(id) {
    const digits = id.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 8;
}

/**
 * Validate KRA PIN (simplified)
 * @param {string} pin
 * @returns {boolean}
 */
export function validateKRAPin(pin) {
    if (!pin || typeof pin !== 'string') return false;
    return /^[A-Za-z0-9]{11}$/.test(pin.trim().toUpperCase());
}

/**
 * Validate M-Pesa transaction code
 * @param {string} code
 * @returns {boolean}
 */
export function validateMPesaCode(code) {
    if (!code || typeof code !== 'string') return false;
    return /^[A-Za-z0-9]{10,12}$/.test(code.trim().toUpperCase());
}
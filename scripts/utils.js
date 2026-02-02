// utils.js - General Utility Functions
// Purpose: Common functions, formatting, calculations

// ==================== DATE/TIME FORMATTING ====================

/**
 * Format time in seconds to MM:SS or HH:MM:SS format
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) {
        return "0:00";
    }
    
    const secs = Math.max(0, Math.floor(seconds));
    
    if (secs >= 3600) {
        const hours = Math.floor(secs / 3600);
        const minutes = Math.floor((secs % 3600) / 60);
        const remainingSeconds = secs % 60;
        
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
        const minutes = Math.floor(secs / 60);
        const remainingSeconds = secs % 60;
        
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

/**
 * Format date to readable string
 * @param {Date|string} date - Date to format
 * @param {boolean} includeTime - Whether to include time
 * @returns {string} Formatted date string
 */
function formatDate(date, includeTime = false) {
    if (!date) return "N/A";
    
    const dateObj = date instanceof Date ? date : new Date(date);
    if (isNaN(dateObj.getTime())) return "Invalid Date";
    
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    };
    
    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }
    
    return dateObj.toLocaleDateString('en-KE', options);
}

/**
 * Calculate time remaining until a future date
 * @param {Date|string} futureDate - Future date
 * @returns {Object} Time remaining object
 */
function calculateRemainingTime(futureDate) {
    const future = new Date(futureDate);
    const now = new Date();
    
    if (future <= now) {
        return {
            total: 0,
            days: 0,
            hours: 0,
            minutes: 0,
            seconds: 0,
            expired: true
        };
    }
    
    const totalSeconds = Math.floor((future - now) / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return {
        total: totalSeconds,
        days,
        hours,
        minutes,
        seconds,
        expired: false
    };
}

/**
 * Format time remaining in human-readable format
 * @param {number} seconds - Time in seconds
 * @returns {string} Human-readable time string
 */
function formatRemainingTime(seconds) {
    if (!seconds || seconds <= 0) return "Expired";
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
        return `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else if (minutes > 0) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
        return "Less than a minute";
    }
}

// ==================== CURRENCY FORMATTING ====================

/**
 * Format currency (KES)
 * @param {number} amount - Amount to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) {
        return "KES 0.00";
    }
    
    const formatted = parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `KES ${formatted}`;
}

// ==================== NUMBER & PERCENTAGE FORMATTING ====================

/**
 * Format number with commas as thousand separators
 * @param {number} number - Number to format
 * @returns {string} Formatted number string
 */
function formatNumber(number) {
    if (number === null || number === undefined || isNaN(number)) {
        return "0";
    }
    
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Calculate percentage
 * @param {number} part - Part value
 * @param {number} total - Total value
 * @param {number} decimals - Number of decimal places
 * @returns {number} Percentage
 */
function getPercentage(part, total, decimals = 1) {
    if (!total || total === 0 || isNaN(part) || isNaN(total)) {
        return 0;
    }
    
    const percentage = (part / total) * 100;
    return parseFloat(percentage.toFixed(decimals));
}

/**
 * Format percentage
 * @param {number} value - Percentage value
 * @param {number} decimals - Decimal places
 * @returns {string} Formatted percentage string
 */
function formatPercentage(value, decimals = 1) {
    if (value === null || value === undefined || isNaN(value)) {
        return "0%";
    }
    
    const formatted = parseFloat(value).toFixed(decimals);
    return `${formatted}%`;
}

// ==================== STRING MANIPULATION ====================

/**
 * Generate random string
 * @param {number} length - Length of random string
 * @returns {string} Random string
 */
function generateRandomCode(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
}

/**
 * Truncate text with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength = 50) {
    if (!text || typeof text !== 'string') return '';
    if (text.length <= maxLength) return text;
    
    return text.substring(0, maxLength).trim() + '...';
}

/**
 * Capitalize first letter of each word
 * @param {string} text - Text to capitalize
 * @returns {string} Capitalized text
 */
function capitalizeWords(text) {
    if (!text || typeof text !== 'string') return '';
    
    return text
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// ==================== ARRAY/OBJECT UTILITIES ====================

/**
 * Deep clone an object
 * @param {Object} obj - Object to clone
 * @returns {Object} Cloned object
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    
    if (obj instanceof Array) {
        return obj.reduce((arr, item, i) => {
            arr[i] = deepClone(item);
            return arr;
        }, []);
    }
    
    if (typeof obj === 'object') {
        return Object.keys(obj).reduce((newObj, key) => {
            newObj[key] = deepClone(obj[key]);
            return newObj;
        }, {});
    }
    
    return obj;
}

/**
 * Debounce function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait = 300) {
    let timeout;
    
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
function throttle(func, limit = 300) {
    let inThrottle;
    
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ==================== ERROR HANDLING ====================

/**
 * Format error message for display
 * @param {Error|string} error - Error object or message
 * @returns {string} Formatted error message
 */
function formatErrorMessage(error) {
    if (!error) return "An unknown error occurred";
    
    if (typeof error === 'string') return error;
    
    if (error.message) {
        // Clean up common error messages
        let message = error.message;
        
        // Remove technical details for user display
        message = message.replace(/^Error:\s*/i, '');
        message = message.replace(/at.*$/m, ''); // Remove stack trace lines
        message = message.trim();
        
        return message || "An error occurred";
    }
    
    return "An error occurred";
}

/**
 * Safely parse JSON with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {any} defaultValue - Default value if parsing fails
 * @returns {any} Parsed JSON or default value
 */
function parseJSONSafe(jsonString, defaultValue = null) {
    if (!jsonString || typeof jsonString !== 'string') {
        return defaultValue;
    }
    
    try {
        return JSON.parse(jsonString);
    } catch (error) {
        console.error('JSON parse error:', error);
        return defaultValue;
    }
}

// ==================== LOCAL STORAGE HELPERS ====================

/**
 * Get item from localStorage with safe parsing
 * @param {string} key - Storage key
 * @param {any} defaultValue - Default value if not found
 * @returns {any} Parsed value or default
 */
function getLocalStorage(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch (error) {
        console.error('Error reading from localStorage:', error);
        return defaultValue;
    }
}

/**
 * Set item in localStorage with safe stringification
 * @param {string} key - Storage key
 * @param {any} value - Value to store
 * @returns {boolean} Success status
 */
function setLocalStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch (error) {
        console.error('Error writing to localStorage:', error);
        return false;
    }
}

/**
 * Remove item from localStorage
 * @param {string} key - Storage key
 * @returns {boolean} Success status
 */
function removeLocalStorage(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (error) {
        console.error('Error removing from localStorage:', error);
        return false;
    }
}

/**
 * Clear all app-related localStorage items
 */
function clearAppStorage() {
    const keysToKeep = ['theme', 'deviceId', 'deviceFingerprint'];
    
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !keysToKeep.includes(key)) {
            localStorage.removeItem(key);
        }
    }
}

// ==================== URL PARAMETER PARSING ====================

/**
 * Get URL parameter value
 * @param {string} name - Parameter name
 * @returns {string|null} Parameter value or null
 */
function getURLParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

/**
 * Get all URL parameters as object
 * @returns {Object} URL parameters object
 */
function getAllURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const params = {};
    
    for (const [key, value] of urlParams.entries()) {
        params[key] = value;
    }
    
    return params;
}

/**
 * Update URL parameter without reloading
 * @param {string} param - Parameter name
 * @param {string} value - Parameter value
 */
function updateURLParam(param, value) {
    const url = new URL(window.location);
    
    if (value === null || value === undefined || value === '') {
        url.searchParams.delete(param);
    } else {
        url.searchParams.set(param, value);
    }
    
    window.history.replaceState({}, '', url);
}

// ==================== DEVICE & PLATFORM UTILITIES ====================

/**
 * Generate unique ID
 * @returns {string} Unique ID
 */
function generateID() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Check if running on mobile device
 * @returns {boolean} True if mobile device
 */
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Check if running on iOS
 * @returns {boolean} True if iOS device
 */
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

/**
 * Check if running on Android
 * @returns {boolean} True if Android device
 */
function isAndroid() {
    return /Android/.test(navigator.userAgent);
}

/**
 * Get device platform info
 * @returns {Object} Device platform information
 */
function getDevicePlatform() {
    const ua = navigator.userAgent;
    
    return {
        isMobile: isMobileDevice(),
        isIOS: isIOS(),
        isAndroid: isAndroid(),
        isDesktop: !isMobileDevice(),
        userAgent: ua,
        platform: navigator.platform,
        language: navigator.language,
        screenSize: `${screen.width}x${screen.height}`
    };
}

// ==================== EXAM-SPECIFIC UTILITIES ====================

/**
 * Calculate exam score percentage
 * @param {number} correct - Number of correct answers
 * @param {number} total - Total number of questions
 * @returns {Object} Score information
 */
function calculateExamScore(correct, total) {
    if (!total || total === 0) {
        return {
            percentage: 0,
            grade: 'N/A',
            passed: false
        };
    }
    
    const percentage = getPercentage(correct, total);
    
    let grade = 'F';
    let passed = false;
    
    if (percentage >= 80) {
        grade = 'A';
        passed = true;
    } else if (percentage >= 70) {
        grade = 'B';
        passed = true;
    } else if (percentage >= 60) {
        grade = 'C';
        passed = true;
    } else if (percentage >= 50) {
        grade = 'D';
        passed = true;
    }
    
    return {
        percentage,
        grade,
        passed,
        correct,
        total,
        incorrect: total - correct
    };
}

/**
 * Calculate average time per question
 * @param {number} totalTime - Total time in seconds
 * @param {number} questionCount - Number of questions
 * @returns {number} Average time per question in seconds
 */
function calculateAverageTime(totalTime, questionCount) {
    if (!questionCount || questionCount === 0) return 0;
    return totalTime / questionCount;
}

/**
 * Format exam duration for display
 * @param {number} seconds - Exam duration in seconds
 * @returns {string} Formatted duration
 */
function formatExamDuration(seconds) {
    if (!seconds || seconds === 0) return "0s";
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

/**
 * Calculate time per question based on difficulty
 * @param {number} difficulty - Difficulty level (1-5)
 * @returns {number} Time in seconds
 */
function getTimeForDifficulty(difficulty) {
    const timeMap = {
        1: 21, // Easy
        2: 27, // Medium-Easy
        3: 36, // Medium
        4: 45, // Hard
        5: 54  // Expert
    };
    
    return timeMap[difficulty] || 30; // Default 30 seconds
}

/**
 * Get timer color based on time remaining
 * @param {number} timeRemaining - Time remaining in seconds
 * @param {number} totalTime - Total time in seconds
 * @returns {string} CSS color class
 */
function getTimerColor(timeRemaining, totalTime) {
    if (!totalTime || totalTime === 0) return "green";
    
    const percentage = (timeRemaining / totalTime) * 100;
    
    if (percentage > 70) return "green";
    if (percentage > 30) return "yellow";
    if (percentage > 10) return "red";
    return "flashing-red";
}

// ==================== SUBJECT & TOPIC UTILITIES ====================

/**
 * Get subject display name
 * @param {string} subjectId - Subject ID
 * @returns {string} Display name
 */
function getSubjectDisplayName(subjectId) {
    const subjectMap = {
        'anatomy': 'Anatomy',
        'physiology': 'Physiology',
        'biochemistry': 'Biochemistry',
        'histology': 'Histology',
        'embryology': 'Embryology',
        'pathology': 'Pathology',
        'pharmacology': 'Pharmacology',
        'microbiology': 'Microbiology'
    };
    
    return subjectMap[subjectId] || capitalizeWords(subjectId);
}

/**
 * Get subject color
 * @param {string} subjectId - Subject ID
 * @returns {string} CSS color value
 */
function getSubjectColor(subjectId) {
    const colorMap = {
        'anatomy': '#2196F3',
        'physiology': '#F44336',
        'biochemistry': '#4CAF50',
        'histology': '#FF9800',
        'embryology': '#9C27B0',
        'pathology': '#3F51B5',
        'pharmacology': '#009688',
        'microbiology': '#FF5722'
    };
    
    return colorMap[subjectId] || '#607D8B';
}

/**
 * Get subject icon
 * @param {string} subjectId - Subject ID
 * @returns {string} Icon emoji
 */
function getSubjectIcon(subjectId) {
    const iconMap = {
        'anatomy': '🦴',
        'physiology': '❤️',
        'biochemistry': '🧪',
        'histology': '🔬',
        'embryology': '👶',
        'pathology': '🩺',
        'pharmacology': '💊',
        'microbiology': '🦠'
    };
    
    return iconMap[subjectId] || '📚';
}

/**
 * Get question count for subject
 * @param {string} subjectId - Subject ID
 * @returns {number} Question count
 */
function getSubjectQuestionCount(subjectId) {
    const countMap = {
        'anatomy': 720,
        'physiology': 1150,
        'biochemistry': 810,
        'histology': 450,
        'embryology': 390,
        'pathology': 540,
        'pharmacology': 460,
        'microbiology': 430
    };
    
    return countMap[subjectId] || 0;
}

// ==================== SUBSCRIPTION UTILITIES ====================

/**
 * Format subscription expiry date
 * @param {string} expiryDate - Expiry date string
 * @returns {string} Formatted expiry info
 */
function formatSubscriptionExpiry(expiryDate) {
    if (!expiryDate) return "No active subscription";
    
    const expiry = new Date(expiryDate);
    const now = new Date();
    
    if (expiry <= now) {
        return "Expired";
    }
    
    const timeRemaining = calculateRemainingTime(expiry);
    
    if (timeRemaining.days > 0) {
        return `Expires in ${timeRemaining.days} day${timeRemaining.days !== 1 ? 's' : ''}`;
    } else if (timeRemaining.hours > 0) {
        return `Expires in ${timeRemaining.hours} hour${timeRemaining.hours !== 1 ? 's' : ''}`;
    } else {
        return `Expires in ${timeRemaining.minutes} minute${timeRemaining.minutes !== 1 ? 's' : ''}`;
    }
}

/**
 * Get subscription plan name
 * @param {string} planId - Plan ID
 * @returns {string} Plan display name
 */
function getPlanDisplayName(planId) {
    const planMap = {
        'trial': 'Free Trial',
        'monthly': 'Monthly Plan',
        'quarterly': 'Quarterly Plan',
        'yearly': 'Yearly Plan'
    };
    
    return planMap[planId] || capitalizeWords(planId);
}

/**
 * Get subscription plan price
 * @param {string} planId - Plan ID
 * @returns {number} Plan price in KES
 */
function getPlanPrice(planId) {
    const priceMap = {
        'trial': 0,
        'monthly': 350,
        'quarterly': 850,
        'yearly': 2100
    };
    
    return priceMap[planId] || 0;
}

// ==================== VALIDATION UTILITIES ====================

/**
 * Compare two values for deep equality
 * @param {any} a - First value
 * @param {any} b - Second value
 * @returns {boolean} True if equal
 */
function deepEqual(a, b) {
    if (a === b) return true;
    
    if (a == null || b == null) return false;
    
    if (typeof a !== typeof b) return false;
    
    if (typeof a !== 'object') return a === b;
    
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }
    
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        
        return true;
    }
    
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    
    if (aKeys.length !== bKeys.length) return false;
    
    for (const key of aKeys) {
        if (!bKeys.includes(key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
    }
    
    return true;
}

/**
 * Validate phone number (Kenyan format)
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid
 */
function validatePhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    
    const digits = phone.replace(/\D/g, '');
    
    return (digits.length === 9 && digits.startsWith('7')) ||
           (digits.length === 10 && digits.startsWith('07')) ||
           (digits.length === 12 && digits.startsWith('254'));
}

/**
 * Format phone number to 254 format
 * @param {string} phone - Phone number
 * @returns {string} Formatted phone number
 */
function formatPhoneTo254(phone) {
    if (!phone || typeof phone !== 'string') return '';
    
    const digits = phone.replace(/\D/g, '');
    
    if (digits.length === 9 && digits.startsWith('7')) {
        return '254' + digits;
    } else if (digits.length === 10 && digits.startsWith('07')) {
        return '254' + digits.substring(1);
    } else if (digits.length === 12 && digits.startsWith('254')) {
        return digits;
    }
    
    return '';
}

// ==================== EXPORT ALL UTILITIES ====================

const MedicalExamUtils = {
    // Date/Time
    formatTime,
    formatDate,
    calculateRemainingTime,
    formatRemainingTime,
    
    // Currency/Number
    formatCurrency,
    formatNumber,
    getPercentage,
    formatPercentage,
    
    // String
    generateRandomCode,
    truncateText,
    capitalizeWords,
    
    // Array/Object
    deepClone,
    debounce,
    throttle,
    
    // Error Handling
    formatErrorMessage,
    parseJSONSafe,
    
    // Local Storage
    getLocalStorage,
    setLocalStorage,
    removeLocalStorage,
    clearAppStorage,
    
    // URL
    getURLParam,
    getAllURLParams,
    updateURLParam,
    
    // Device
    generateID,
    isMobileDevice,
    isIOS,
    isAndroid,
    getDevicePlatform,
    
    // Exam Specific
    calculateExamScore,
    calculateAverageTime,
    formatExamDuration,
    getTimeForDifficulty,
    getTimerColor,
    
    // Subject/Topic
    getSubjectDisplayName,
    getSubjectColor,
    getSubjectIcon,
    getSubjectQuestionCount,
    
    // Subscription
    formatSubscriptionExpiry,
    getPlanDisplayName,
    getPlanPrice,
    
    // Validation
    deepEqual,
    validatePhone,
    formatPhoneTo254
};

// Make available globally for HTML files
if (typeof window !== 'undefined') {
    window.MedicalExamUtils = MedicalExamUtils;
}

export default MedicalExamUtils;
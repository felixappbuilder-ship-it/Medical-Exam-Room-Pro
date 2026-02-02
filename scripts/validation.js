// validation.js - Form validation
class ValidationManager {
    constructor() {
        this.rules = {};
        this.messages = {};
        
        this.init();
    }

    // Initialize validation manager
    init() {
        this.setupDefaultRules();
        this.setupDefaultMessages();
        
        console.log('Validation manager initialized');
    }

    // Set up default validation rules
    setupDefaultRules() {
        this.rules = {
            // Email validation
            email: (value) => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return emailRegex.test(value);
            },
            
            // Kenyan phone number validation
            phone: (value) => {
                const digits = value.replace(/\D/g, '');
                return (
                    (digits.length === 9 && digits.startsWith('7')) ||
                    (digits.length === 10 && digits.startsWith('07')) ||
                    (digits.length === 12 && digits.startsWith('254'))
                );
            },
            
            // Password validation
            password: (value) => {
                return value.length >= 8 &&
                       /[A-Z]/.test(value) && // At least one uppercase
                       /[a-z]/.test(value) && // At least one lowercase
                       /\d/.test(value);      // At least one number
            },
            
            // Name validation
            name: (value) => {
                return value.length >= 2 &&
                       /^[a-zA-Z\s]+$/.test(value); // Letters and spaces only
            },
            
            // Required field
            required: (value) => {
                return value !== null && value !== undefined && value.toString().trim().length > 0;
            },
            
            // Minimum length
            minLength: (value, min) => {
                return value.length >= min;
            },
            
            // Maximum length
            maxLength: (value, max) => {
                return value.length <= max;
            },
            
            // Numeric validation
            numeric: (value) => {
                return !isNaN(parseFloat(value)) && isFinite(value);
            },
            
            // Integer validation
            integer: (value) => {
                return Number.isInteger(Number(value));
            },
            
            // Positive number
            positive: (value) => {
                const num = Number(value);
                return !isNaN(num) && num > 0;
            },
            
            // Date validation
            date: (value) => {
                const date = new Date(value);
                return date instanceof Date && !isNaN(date);
            },
            
            // Future date
            futureDate: (value) => {
                const date = new Date(value);
                const now = new Date();
                return date > now;
            },
            
            // Past date
            pastDate: (value) => {
                const date = new Date(value);
                const now = new Date();
                return date < now;
            },
            
            // URL validation
            url: (value) => {
                try {
                    new URL(value);
                    return true;
                } catch {
                    return false;
                }
            },
            
            // Kenyan ID number validation (simplified)
            idNumber: (value) => {
                const digits = value.replace(/\D/g, '');
                return digits.length === 8;
            },
            
            // Amount validation (KES)
            amount: (value) => {
                const amount = Number(value);
                return !isNaN(amount) && amount >= 50 && amount <= 150000;
            },
            
            // Confirm password
            confirmPassword: (value, confirmValue) => {
                return value === confirmValue;
            },
            
            // Custom regex pattern
            pattern: (value, pattern) => {
                const regex = new RegExp(pattern);
                return regex.test(value);
            },
            
            // In array validation
            inArray: (value, array) => {
                return array.includes(value);
            },
            
            // Between numbers
            between: (value, min, max) => {
                const num = Number(value);
                return !isNaN(num) && num >= min && num <= max;
            },
            
            // Kenyan postal code
            postalCode: (value) => {
                const digits = value.replace(/\D/g, '');
                return digits.length === 5;
            }
        };
    }

    // Set up default error messages
    setupDefaultMessages() {
        this.messages = {
            email: 'Please enter a valid email address',
            phone: 'Please enter a valid Kenyan phone number (0712345678)',
            password: 'Password must be at least 8 characters with uppercase, lowercase, and numbers',
            name: 'Name must be at least 2 letters (no numbers or special characters)',
            required: 'This field is required',
            minLength: (min) => `Must be at least ${min} characters`,
            maxLength: (max) => `Cannot exceed ${max} characters`,
            numeric: 'Please enter a valid number',
            integer: 'Please enter a whole number',
            positive: 'Please enter a positive number',
            date: 'Please enter a valid date',
            futureDate: 'Date must be in the future',
            pastDate: 'Date must be in the past',
            url: 'Please enter a valid URL',
            idNumber: 'Kenyan ID must be 8 digits',
            amount: 'Amount must be between KES 50 and 150,000',
            confirmPassword: 'Passwords do not match',
            pattern: 'Invalid format',
            inArray: 'Invalid selection',
            between: (min, max) => `Must be between ${min} and ${max}`,
            postalCode: 'Postal code must be 5 digits'
        };
    }

    // Validate a single field
    validateField(fieldName, value, rules) {
        const errors = [];
        
        if (!rules || rules.length === 0) {
            return { isValid: true, errors: [] };
        }
        
        for (const rule of rules) {
            const ruleName = typeof rule === 'string' ? rule : rule.name;
            const ruleParams = typeof rule === 'object' ? rule.params : [];
            
            if (!this.rules[ruleName]) {
                console.warn(`Unknown validation rule: ${ruleName}`);
                continue;
            }
            
            // Apply rule
            const isValid = this.rules[ruleName](value, ...ruleParams);
            
            if (!isValid) {
                // Get error message
                let message = this.messages[ruleName];
                
                // Handle parameterized messages
                if (typeof message === 'function') {
                    message = message(...ruleParams);
                }
                
                // Use custom message if provided
                if (typeof rule === 'object' && rule.message) {
                    message = rule.message;
                }
                
                errors.push({
                    field: fieldName,
                    rule: ruleName,
                    message: message,
                    value: value
                });
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    // Validate form
    validateForm(formData, validationSchema) {
        const results = {
            isValid: true,
            errors: [],
            fields: {}
        };
        
        for (const [fieldName, rules] of Object.entries(validationSchema)) {
            const value = formData[fieldName];
            const fieldResult = this.validateField(fieldName, value, rules);
            
            results.fields[fieldName] = fieldResult;
            
            if (!fieldResult.isValid) {
                results.isValid = false;
                results.errors.push(...fieldResult.errors);
            }
        }
        
        return results;
    }

    // Validate registration form
    validateRegistration(formData) {
        const schema = {
            name: ['required', 'name'],
            email: ['required', 'email'],
            phone: ['required', 'phone'],
            password: ['required', 'password'],
            confirmPassword: [
                'required',
                { 
                    name: 'confirmPassword',
                    params: [formData.password],
                    message: 'Passwords do not match'
                }
            ],
            institution: ['required', 'minLength:2'],
            course: ['required', 'minLength:2'],
            yearOfStudy: ['required', 'integer', { name: 'between', params: [1, 6] }],
            agreeTerms: ['required']
        };
        
        return this.validateForm(formData, schema);
    }

    // Validate login form
    validateLogin(formData) {
        const schema = {
            email: ['required', 'email'],
            password: ['required']
        };
        
        return this.validateForm(formData, schema);
    }

    // Validate payment form
    validatePayment(formData) {
        const schema = {
            phoneNumber: ['required', 'phone'],
            amount: ['required', 'amount'],
            plan: ['required'],
            agreeTerms: ['required']
        };
        
        return this.validateForm(formData, schema);
    }

    // Validate profile update form
    validateProfile(formData) {
        const schema = {
            name: ['required', 'name'],
            email: ['required', 'email'],
            phone: ['required', 'phone'],
            institution: ['required', 'minLength:2'],
            course: ['required', 'minLength:2'],
            yearOfStudy: ['required', 'integer', { name: 'between', params: [1, 6] }]
        };
        
        return this.validateForm(formData, schema);
    }

    // Validate exam settings form
    validateExamSettings(formData) {
        const schema = {
            subjects: ['required'],
            questionCount: ['required', 'integer', { name: 'between', params: [1, 200] }],
            examType: ['required'],
            difficulty: ['required']
        };
        
        return this.validateForm(formData, schema);
    }

    // Validate subscription change form
    validateSubscriptionChange(formData) {
        const schema = {
            newPlan: ['required'],
            confirmChange: ['required']
        };
        
        return this.validateForm(formData, schema);
    }

    // Validate password change form
    validatePasswordChange(formData) {
        const schema = {
            currentPassword: ['required'],
            newPassword: ['required', 'password'],
            confirmPassword: [
                'required',
                { 
                    name: 'confirmPassword',
                    params: [formData.newPassword],
                    message: 'Passwords do not match'
                }
            ]
        };
        
        return this.validateForm(formData, schema);
    }

    // Validate contact form
    validateContact(formData) {
        const schema = {
            name: ['required', 'name'],
            email: ['required', 'email'],
            subject: ['required', 'minLength:3'],
            message: ['required', 'minLength:10', 'maxLength:1000']
        };
        
        return this.validateForm(formData, schema);
    }

    // Validate feedback form
    validateFeedback(formData) {
        const schema = {
            rating: ['required', 'integer', { name: 'between', params: [1, 5] }],
            comments: ['maxLength:500'],
            category: ['required']
        };
        
        return this.validateForm(formData, schema);
    }

    // Sanitize input
    sanitize(input, type = 'text') {
        if (input === null || input === undefined) {
            return '';
        }
        
        let sanitized = input.toString().trim();
        
        switch (type) {
            case 'email':
                sanitized = sanitized.toLowerCase();
                break;
                
            case 'phone':
                sanitized = sanitized.replace(/\D/g, '');
                break;
                
            case 'number':
                sanitized = sanitized.replace(/[^\d.-]/g, '');
                break;
                
            case 'text':
                // Basic XSS prevention
                sanitized = sanitized
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#x27;')
                    .replace(/\//g, '&#x2F;');
                break;
                
            case 'html':
                // Allow safe HTML (very basic for Phase 1)
                sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
                break;
        }
        
        return sanitized;
    }

    // Sanitize form data
    sanitizeForm(formData, schema = null) {
        const sanitized = {};
        
        for (const [key, value] of Object.entries(formData)) {
            let type = 'text';
            
            // Determine type from schema or field name
            if (schema && schema[key]) {
                const rules = schema[key];
                if (rules.includes('email')) type = 'email';
                else if (rules.includes('phone')) type = 'phone';
                else if (rules.includes('numeric') || rules.includes('integer') || rules.includes('amount')) type = 'number';
            } else if (key.includes('email')) type = 'email';
            else if (key.includes('phone')) type = 'phone';
            else if (key.includes('amount') || key.includes('price') || key.includes('number')) type = 'number';
            
            sanitized[key] = this.sanitize(value, type);
        }
        
        return sanitized;
    }

    // Format phone number for display
    formatPhoneForDisplay(phone) {
        const digits = phone.replace(/\D/g, '');
        
        if (digits.length === 9 && digits.startsWith('7')) {
            return `0${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
        } else if (digits.length === 10 && digits.startsWith('07')) {
            return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
        } else if (digits.length === 12 && digits.startsWith('254')) {
            const last9 = digits.slice(-9);
            return `0${last9.slice(0, 2)} ${last9.slice(2, 5)} ${last9.slice(5)}`;
        }
        
        return phone;
    }

    // Format phone number for storage
    formatPhoneForStorage(phone) {
        const digits = phone.replace(/\D/g, '');
        
        if (digits.length === 9 && digits.startsWith('7')) {
            return `254${digits}`;
        } else if (digits.length === 10 && digits.startsWith('07')) {
            return `254${digits.slice(1)}`;
        } else if (digits.length === 12 && digits.startsWith('254')) {
            return digits;
        }
        
        return null;
    }

    // Validate Kenyan ID number (basic check)
    validateKenyanId(id) {
        const digits = id.replace(/\D/g, '');
        
        if (digits.length !== 8) {
            return false;
        }
        
        // Simple checksum validation (simplified)
        const idNumber = parseInt(digits, 10);
        return !isNaN(idNumber) && idNumber > 0;
    }

    // Validate date of birth (must be at least 18 years old)
    validateDateOfBirth(dob) {
        const birthDate = new Date(dob);
        const today = new Date();
        
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        
        return age >= 18;
    }

    // Validate credit card number (basic Luhn check)
    validateCreditCard(cardNumber) {
        const digits = cardNumber.replace(/\D/g, '');
        
        if (digits.length < 13 || digits.length > 19) {
            return false;
        }
        
        // Luhn algorithm
        let sum = 0;
        let isEven = false;
        
        for (let i = digits.length - 1; i >= 0; i--) {
            let digit = parseInt(digits.charAt(i), 10);
            
            if (isEven) {
                digit *= 2;
                if (digit > 9) {
                    digit -= 9;
                }
            }
            
            sum += digit;
            isEven = !isEven;
        }
        
        return sum % 10 === 0;
    }

    // Validate expiry date (MM/YY format)
    validateExpiryDate(expiry) {
        const match = expiry.match(/^(\d{2})\/(\d{2})$/);
        
        if (!match) {
            return false;
        }
        
        const month = parseInt(match[1], 10);
        const year = parseInt(match[2], 10);
        const now = new Date();
        const currentYear = now.getFullYear() % 100;
        const currentMonth = now.getMonth() + 1;
        
        if (month < 1 || month > 12) {
            return false;
        }
        
        if (year < currentYear) {
            return false;
        }
        
        if (year === currentYear && month < currentMonth) {
            return false;
        }
        
        return true;
    }

    // Validate CVV
    validateCVV(cvv) {
        const digits = cvv.replace(/\D/g, '');
        return digits.length === 3 || digits.length === 4;
    }

    // Show validation errors in UI
    showValidationErrors(formElement, validationResult) {
        // Clear previous errors
        this.clearValidationErrors(formElement);
        
        if (validationResult.isValid) {
            return;
        }
        
        // Group errors by field
        const errorsByField = {};
        validationResult.errors.forEach(error => {
            if (!errorsByField[error.field]) {
                errorsByField[error.field] = [];
            }
            errorsByField[error.field].push(error.message);
        });
        
        // Display errors
        for (const [fieldName, messages] of Object.entries(errorsByField)) {
            const field = formElement.querySelector(`[name="${fieldName}"]`);
            if (field) {
                // Add error class
                field.classList.add('error');
                
                // Create error container
                const errorContainer = document.createElement('div');
                errorContainer.className = 'validation-errors';
                
                // Add error messages
                messages.forEach(message => {
                    const errorElement = document.createElement('div');
                    errorElement.className = 'validation-error';
                    errorElement.textContent = message;
                    errorContainer.appendChild(errorElement);
                });
                
                // Insert after field
                field.parentNode.appendChild(errorContainer);
                
                // Focus first error field
                if (field === Object.keys(errorsByField)[0]) {
                    field.focus();
                }
            }
        }
        
        // Scroll to first error
        const firstErrorField = formElement.querySelector('.error');
        if (firstErrorField) {
            firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    // Clear validation errors from UI
    clearValidationErrors(formElement) {
        // Remove error classes
        formElement.querySelectorAll('.error').forEach(field => {
            field.classList.remove('error');
        });
        
        // Remove error messages
        formElement.querySelectorAll('.validation-errors').forEach(container => {
            container.remove();
        });
    }

    // Real-time validation on input
    setupRealTimeValidation(formElement, schema) {
        const fields = formElement.querySelectorAll('input, select, textarea');
        
        fields.forEach(field => {
            const fieldName = field.name;
            const fieldRules = schema[fieldName];
            
            if (!fieldRules) return;
            
            // Validate on blur
            field.addEventListener('blur', () => {
                const value = field.value;
                const result = this.validateField(fieldName, value, fieldRules);
                
                this.updateFieldValidationUI(field, result);
            });
            
            // Clear error on focus
            field.addEventListener('focus', () => {
                this.clearFieldValidationUI(field);
            });
            
            // Live validation for some fields
            if (field.type === 'email' || field.type === 'tel') {
                field.addEventListener('input', () => {
                    const value = field.value;
                    const result = this.validateField(fieldName, value, fieldRules);
                    
                    this.updateFieldValidationUI(field, result);
                });
            }
        });
    }

    // Update field validation UI
    updateFieldValidationUI(field, validationResult) {
        this.clearFieldValidationUI(field);
        
        if (validationResult.isValid) {
            field.classList.add('valid');
            
            // Add checkmark for visual feedback
            if (!field.parentNode.querySelector('.valid-icon')) {
                const validIcon = document.createElement('span');
                validIcon.className = 'valid-icon';
                validIcon.textContent = '✓';
                validIcon.style.cssText = `
                    position: absolute;
                    right: 10px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: #4CAF50;
                    font-weight: bold;
                `;
                field.parentNode.style.position = 'relative';
                field.parentNode.appendChild(validIcon);
            }
        } else {
            field.classList.add('error');
            
            // Add error message
            validationResult.errors.forEach(error => {
                const errorElement = document.createElement('div');
                errorElement.className = 'validation-error';
                errorElement.textContent = error.message;
                errorElement.style.cssText = `
                    color: #F44336;
                    font-size: 12px;
                    margin-top: 4px;
                `;
                field.parentNode.appendChild(errorElement);
            });
        }
    }

    // Clear field validation UI
    clearFieldValidationUI(field) {
        field.classList.remove('error', 'valid');
        
        // Remove valid icon
        const validIcon = field.parentNode.querySelector('.valid-icon');
        if (validIcon) {
            validIcon.remove();
        }
        
        // Remove error messages
        const errorMessages = field.parentNode.querySelectorAll('.validation-error');
        errorMessages.forEach(msg => msg.remove());
    }

    // Validate file upload
    validateFile(file, options = {}) {
        const errors = [];
        const defaultOptions = {
            maxSize: 5 * 1024 * 1024, // 5MB
            allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
            allowedExtensions: ['.jpg', '.jpeg', '.png', '.gif', '.pdf']
        };
        
        const config = { ...defaultOptions, ...options };
        
        // Check file size
        if (file.size > config.maxSize) {
            const maxSizeMB = config.maxSize / (1024 * 1024);
            errors.push(`File size must be less than ${maxSizeMB}MB`);
        }
        
        // Check file type
        if (config.allowedTypes.length > 0 && !config.allowedTypes.includes(file.type)) {
            errors.push(`File type not allowed. Allowed types: ${config.allowedTypes.join(', ')}`);
        }
        
        // Check file extension
        if (config.allowedExtensions.length > 0) {
            const extension = '.' + file.name.split('.').pop().toLowerCase();
            if (!config.allowedExtensions.includes(extension)) {
                errors.push(`File extension not allowed. Allowed extensions: ${config.allowedExtensions.join(', ')}`);
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors,
            file: file
        };
    }

    // Get validation summary
    getValidationSummary(validationResult) {
        if (validationResult.isValid) {
            return {
                status: 'valid',
                message: 'All fields are valid',
                errorCount: 0
            };
        }
        
        const errorCount = validationResult.errors.length;
        const fieldCount = Object.keys(validationResult.fields).length;
        const errorFields = Object.entries(validationResult.fields)
            .filter(([_, fieldResult]) => !fieldResult.isValid)
            .map(([fieldName]) => fieldName);
        
        return {
            status: 'invalid',
            message: `${errorCount} error${errorCount !== 1 ? 's' : ''} in ${errorFields.length} field${errorFields.length !== 1 ? 's' : ''}`,
            errorCount: errorCount,
            fieldCount: fieldCount,
            errorFields: errorFields,
            firstError: validationResult.errors[0]
        };
    }

    // Add custom validation rule
    addRule(ruleName, validator, message) {
        this.rules[ruleName] = validator;
        if (message) {
            this.messages[ruleName] = message;
        }
    }

    // Remove validation rule
    removeRule(ruleName) {
        delete this.rules[ruleName];
        delete this.messages[ruleName];
    }
}

// Create global instance
const Validation = new ValidationManager();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Validation;
}
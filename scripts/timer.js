// timer.js - Adaptive Timer System for Medical Exam Room Pro
// Blueprint Reference: Frontend User App Implementation - File #6

/**
 * Adaptive Timer System
 * Manages exam timing with variable timing per question difficulty
 * Visual feedback with color progression and warnings
 */

class AdaptiveTimer {
    constructor(options = {}) {
        // Default configuration
        this.config = {
            // Timing based on difficulty (in seconds)
            easyTime: 21,
            mediumTime: 30,
            hardTime: 42,
            expertTime: 54,
            
            // Color progression thresholds (percentage of time remaining)
            greenThreshold: 0.7,    // >70% remaining
            yellowThreshold: 0.3,   // 30-70% remaining
            redThreshold: 0.1,      // 10-30% remaining
            flashingThreshold: 5,   // Last 5 seconds in seconds
            
            // Warning settings
            warningAtSeconds: 10,   // Warning at 10 seconds remaining
            autoSubmit: true,       // Auto-submit on time expiry
            showMilliseconds: false,
            
            // Callbacks
            onTimeUpdate: null,
            onColorChange: null,
            onWarning: null,
            onExpire: null,
            onAutoSubmit: null,
            
            // UI elements (if provided)
            displayElement: null,
            progressElement: null,
            ...options
        };
        
        // Timer state
        this.state = {
            isRunning: false,
            isPaused: false,
            startTime: null,
            elapsed: 0,
            remaining: 0,
            totalTime: 0,
            currentColor: 'green',
            isFlashing: false,
            questionDifficulty: 'medium',
            questionId: null,
            lastSaveTime: null
        };
        
        // DOM Elements
        this.displayElement = this.config.displayElement;
        this.progressElement = this.config.progressElement;
        
        // Initialize
        this.init();
    }
    
    /**
     * Initialize the timer
     */
    init() {
        this.createTimerDisplay();
        this.setupEventListeners();
        this.updateDisplay();
    }
    
    /**
     * Create timer display if not provided
     */
    createTimerDisplay() {
        if (!this.displayElement) {
            this.displayElement = document.createElement('div');
            this.displayElement.className = 'adaptive-timer';
            this.displayElement.innerHTML = `
                <div class="timer-display">
                    <span class="timer-text">0:00</span>
                    <span class="timer-color-indicator"></span>
                </div>
                <div class="timer-progress" style="display: none;">
                    <div class="progress-bar">
                        <div class="progress-fill"></div>
                    </div>
                </div>
                <div class="timer-warning" style="display: none;">
                    ⚠️ Time is running out!
                </div>
            `;
            
            // Add to document if in browser context
            if (typeof document !== 'undefined') {
                document.body.appendChild(this.displayElement);
            }
        }
        
        if (!this.progressElement && this.displayElement) {
            this.progressElement = this.displayElement.querySelector('.progress-fill');
        }
    }
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for visibility change to detect tab switching
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && this.state.isRunning && !this.state.isPaused) {
                    this.handleTabSwitch();
                }
            });
            
            // Listen for blur event (user leaves the window)
            window.addEventListener('blur', () => {
                if (this.state.isRunning && !this.state.isPaused) {
                    this.handleWindowBlur();
                }
            });
        }
    }
    
    /**
     * Start timer for a question
     * @param {string} difficulty - Question difficulty (easy, medium, hard, expert)
     * @param {string} questionId - Unique question identifier
     */
    start(difficulty = 'medium', questionId = null) {
        if (this.state.isRunning) {
            this.stop();
        }
        
        // Set difficulty and calculate total time
        this.state.questionDifficulty = difficulty;
        this.state.questionId = questionId;
        this.state.totalTime = this.getTimeForDifficulty(difficulty);
        this.state.remaining = this.state.totalTime;
        
        // Reset state
        this.state.isRunning = true;
        this.state.isPaused = false;
        this.state.startTime = Date.now();
        this.state.elapsed = 0;
        this.state.currentColor = 'green';
        this.state.isFlashing = false;
        this.state.lastSaveTime = Date.now();
        
        // Update display
        this.updateDisplay();
        
        // Start the timer loop
        this.timerInterval = setInterval(() => this.update(), 100);
        
        // Log start
        this.logTimerEvent('start', {
            difficulty,
            questionId,
            totalTime: this.state.totalTime
        });
    }
    
    /**
     * Pause the timer
     */
    pause() {
        if (!this.state.isRunning || this.state.isPaused) return;
        
        this.state.isPaused = true;
        this.state.pauseTime = Date.now();
        clearInterval(this.timerInterval);
        
        // Update display to show paused state
        if (this.displayElement) {
            this.displayElement.classList.add('paused');
            const timerText = this.displayElement.querySelector('.timer-text');
            if (timerText) {
                timerText.textContent += ' (Paused)';
            }
        }
        
        this.logTimerEvent('pause');
    }
    
    /**
     * Resume the timer
     */
    resume() {
        if (!this.state.isRunning || !this.state.isPaused) return;
        
        // Adjust start time for the pause duration
        const pauseDuration = Date.now() - this.state.pauseTime;
        this.state.startTime += pauseDuration;
        this.state.lastSaveTime += pauseDuration;
        
        this.state.isPaused = false;
        delete this.state.pauseTime;
        
        // Restart timer interval
        this.timerInterval = setInterval(() => this.update(), 100);
        
        // Update display
        if (this.displayElement) {
            this.displayElement.classList.remove('paused');
        }
        
        this.updateDisplay();
        this.logTimerEvent('resume');
    }
    
    /**
     * Stop the timer
     * @returns {Object} Timer results
     */
    stop() {
        if (!this.state.isRunning) return null;
        
        clearInterval(this.timerInterval);
        
        const results = {
            questionId: this.state.questionId,
            difficulty: this.state.questionDifficulty,
            totalTime: this.state.totalTime,
            timeSpent: this.state.elapsed,
            timeRemaining: this.state.remaining,
            wasCompleted: this.state.remaining > 0,
            colorHistory: this.state.colorHistory || []
        };
        
        // Reset state
        this.state.isRunning = false;
        this.state.isPaused = false;
        this.state.startTime = null;
        this.state.elapsed = 0;
        this.state.remaining = 0;
        
        // Update display to show stopped state
        this.updateDisplay();
        
        this.logTimerEvent('stop', results);
        return results;
    }
    
    /**
     * Reset timer to initial state
     */
    reset() {
        this.stop();
        this.state = {
            isRunning: false,
            isPaused: false,
            startTime: null,
            elapsed: 0,
            remaining: 0,
            totalTime: 0,
            currentColor: 'green',
            isFlashing: false,
            questionDifficulty: 'medium',
            questionId: null,
            lastSaveTime: null
        };
        
        this.updateDisplay();
        this.logTimerEvent('reset');
    }
    
    /**
     * Main timer update loop
     */
    update() {
        if (!this.state.isRunning || this.state.isPaused) return;
        
        // Calculate elapsed time
        const now = Date.now();
        this.state.elapsed = Math.floor((now - this.state.startTime) / 1000);
        this.state.remaining = Math.max(0, this.state.totalTime - this.state.elapsed);
        
        // Check for time expiry
        if (this.state.remaining <= 0) {
            this.handleTimeExpiry();
            return;
        }
        
        // Update color based on remaining time
        this.updateColor();
        
        // Check for warnings
        this.checkWarnings();
        
        // Auto-save every 30 seconds
        if (now - this.state.lastSaveTime >= 30000) {
            this.autoSave();
            this.state.lastSaveTime = now;
        }
        
        // Update display
        this.updateDisplay();
        
        // Call update callback
        if (typeof this.config.onTimeUpdate === 'function') {
            this.config.onTimeUpdate({
                elapsed: this.state.elapsed,
                remaining: this.state.remaining,
                percentage: (this.state.elapsed / this.state.totalTime) * 100,
                color: this.state.currentColor,
                isFlashing: this.state.isFlashing
            });
        }
    }
    
    /**
     * Update timer color based on remaining time
     */
    updateColor() {
        const percentage = this.state.remaining / this.state.totalTime;
        let newColor = this.state.currentColor;
        let newFlashing = this.state.isFlashing;
        
        // Determine color based on percentage
        if (percentage > this.config.greenThreshold) {
            newColor = 'green';
        } else if (percentage > this.config.yellowThreshold) {
            newColor = 'yellow';
        } else if (percentage > this.config.redThreshold) {
            newColor = 'red';
        } else {
            newColor = 'red';
            // Check for flashing (last few seconds)
            newFlashing = this.state.remaining <= this.config.flashingThreshold;
        }
        
        // Update if color changed
        if (newColor !== this.state.currentColor || newFlashing !== this.state.isFlashing) {
            const oldColor = this.state.currentColor;
            this.state.currentColor = newColor;
            this.state.isFlashing = newFlashing;
            
            // Track color history
            if (!this.state.colorHistory) {
                this.state.colorHistory = [];
            }
            this.state.colorHistory.push({
                time: Date.now(),
                from: oldColor,
                to: newColor,
                remaining: this.state.remaining,
                elapsed: this.state.elapsed
            });
            
            // Update UI
            this.updateDisplay();
            
            // Call color change callback
            if (typeof this.config.onColorChange === 'function') {
                this.config.onColorChange({
                    from: oldColor,
                    to: newColor,
                    isFlashing: newFlashing,
                    remaining: this.state.remaining
                });
            }
            
            this.logTimerEvent('color_change', {
                from: oldColor,
                to: newColor,
                remaining: this.state.remaining
            });
        }
    }
    
    /**
     * Check for and trigger warnings
     */
    checkWarnings() {
        // Warning at 10 seconds remaining
        if (this.state.remaining === this.config.warningAtSeconds) {
            this.triggerWarning();
        }
        
        // Additional warning at 5 seconds if not already flashing
        if (this.state.remaining === 5 && !this.state.isFlashing) {
            this.triggerWarning('final');
        }
    }
    
    /**
     * Trigger a warning
     * @param {string} type - Warning type ('10_seconds', 'final')
     */
    triggerWarning(type = '10_seconds') {
        // Show warning in UI
        if (this.displayElement) {
            const warningElement = this.displayElement.querySelector('.timer-warning');
            if (warningElement) {
                warningElement.style.display = 'block';
                warningElement.textContent = type === 'final' 
                    ? '⚡ Last 5 seconds!' 
                    : '⚠️ 10 seconds remaining!';
                
                // Hide after 3 seconds
                setTimeout(() => {
                    warningElement.style.display = 'none';
                }, 3000);
            }
        }
        
        // Call warning callback
        if (typeof this.config.onWarning === 'function') {
            this.config.onWarning({
                type,
                remaining: this.state.remaining,
                elapsed: this.state.elapsed
            });
        }
        
        // Log warning
        this.logTimerEvent('warning', {
            type,
            remaining: this.state.remaining
        });
    }
    
    /**
     * Handle time expiry
     */
    handleTimeExpiry() {
        clearInterval(this.timerInterval);
        
        // Set final state
        this.state.remaining = 0;
        this.state.elapsed = this.state.totalTime;
        this.state.currentColor = 'expired';
        this.state.isFlashing = false;
        
        // Update display
        this.updateDisplay();
        
        // Call expiry callback
        if (typeof this.config.onExpire === 'function') {
            this.config.onExpire({
                questionId: this.state.questionId,
                difficulty: this.state.questionDifficulty,
                totalTime: this.state.totalTime
            });
        }
        
        // Auto-submit if enabled
        if (this.config.autoSubmit) {
            setTimeout(() => {
                if (typeof this.config.onAutoSubmit === 'function') {
                    this.config.onAutoSubmit({
                        questionId: this.state.questionId,
                        reason: 'time_expiry'
                    });
                }
            }, 500);
        }
        
        this.logTimerEvent('expire', {
            questionId: this.state.questionId,
            difficulty: this.state.questionDifficulty
        });
    }
    
    /**
     * Auto-save progress
     */
    autoSave() {
        // This would typically save to IndexedDB
        const saveData = {
            questionId: this.state.questionId,
            elapsed: this.state.elapsed,
            remaining: this.state.remaining,
            timestamp: Date.now(),
            color: this.state.currentColor
        };
        
        // Save to localStorage as example
        try {
            const saves = JSON.parse(localStorage.getItem('timerAutoSaves') || '[]');
            saves.push(saveData);
            localStorage.setItem('timerAutoSaves', JSON.stringify(saves.slice(-10))); // Keep last 10 saves
        } catch (e) {
            console.warn('Could not auto-save timer data:', e);
        }
        
        this.logTimerEvent('auto_save', saveData);
    }
    
    /**
     * Handle tab switching (potential cheating detection)
     */
    handleTabSwitch() {
        if (!this.config.cheatDetection) return;
        
        // Log tab switch event
        this.logTimerEvent('tab_switch', {
            timestamp: Date.now(),
            remaining: this.state.remaining
        });
        
        // In a real implementation, this would notify the security system
        if (typeof window.cheatDetection !== 'undefined') {
            window.cheatDetection.logEvent('tab_switch_during_exam', {
                questionId: this.state.questionId,
                remainingTime: this.state.remaining
            });
        }
    }
    
    /**
     * Handle window blur
     */
    handleWindowBlur() {
        if (!this.config.cheatDetection) return;
        
        this.logTimerEvent('window_blur', {
            timestamp: Date.now(),
            remaining: this.state.remaining
        });
    }
    
    /**
     * Update the timer display
     */
    updateDisplay() {
        if (!this.displayElement) return;
        
        // Update timer text
        const timerText = this.displayElement.querySelector('.timer-text');
        if (timerText) {
            const minutes = Math.floor(this.state.remaining / 60);
            const seconds = this.state.remaining % 60;
            timerText.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            // Add milliseconds if enabled
            if (this.config.showMilliseconds && this.state.isRunning && !this.state.isPaused) {
                const ms = 1000 - (Date.now() % 1000);
                timerText.textContent += `.${Math.floor(ms / 100)}`;
            }
        }
        
        // Update color indicator
        const colorIndicator = this.displayElement.querySelector('.timer-color-indicator');
        if (colorIndicator) {
            // Remove all color classes
            colorIndicator.classList.remove('green', 'yellow', 'red', 'expired', 'flashing');
            
            // Add current color class
            colorIndicator.classList.add(this.state.currentColor);
            
            // Add flashing class if needed
            if (this.state.isFlashing) {
                colorIndicator.classList.add('flashing');
            }
            
            // Update background color
            const colors = {
                green: '#4CAF50',
                yellow: '#FF9800',
                red: '#F44336',
                expired: '#9E9E9E'
            };
            colorIndicator.style.backgroundColor = colors[this.state.currentColor] || '#4CAF50';
        }
        
        // Update progress bar
        if (this.progressElement && this.state.totalTime > 0) {
            const percentage = (this.state.elapsed / this.state.totalTime) * 100;
            this.progressElement.style.width = `${percentage}%`;
            
            // Update progress bar color
            this.progressElement.style.backgroundColor = this.getColorForPercentage(percentage);
        }
        
        // Update container classes
        this.displayElement.classList.remove('timer-green', 'timer-yellow', 'timer-red', 'timer-expired');
        this.displayElement.classList.add(`timer-${this.state.currentColor}`);
        
        if (this.state.isFlashing) {
            this.displayElement.classList.add('timer-flashing');
        } else {
            this.displayElement.classList.remove('timer-flashing');
        }
    }
    
    /**
     * Get time for difficulty level
     * @param {string} difficulty - Difficulty level
     * @returns {number} Time in seconds
     */
    getTimeForDifficulty(difficulty) {
        const times = {
            easy: this.config.easyTime,
            medium: this.config.mediumTime,
            hard: this.config.hardTime,
            expert: this.config.expertTime
        };
        
        return times[difficulty.toLowerCase()] || this.config.mediumTime;
    }
    
    /**
     * Get color for percentage
     * @param {number} percentage - Percentage of time elapsed
     * @returns {string} CSS color
     */
    getColorForPercentage(percentage) {
        if (percentage <= 30) return '#4CAF50'; // Green
        if (percentage <= 70) return '#FF9800'; // Yellow
        if (percentage <= 90) return '#F44336'; // Red
        return '#D32F2F'; // Dark red for >90%
    }
    
    /**
     * Get current timer state
     * @returns {Object} Timer state
     */
    getState() {
        return {
            ...this.state,
            formattedTime: this.formatTime(this.state.remaining),
            formattedElapsed: this.formatTime(this.state.elapsed),
            percentageElapsed: (this.state.elapsed / this.state.totalTime) * 100,
            percentageRemaining: (this.state.remaining / this.state.totalTime) * 100
        };
    }
    
    /**
     * Format time as MM:SS
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    /**
     * Add time to the timer
     * @param {number} seconds - Seconds to add (can be negative)
     */
    addTime(seconds) {
        if (!this.state.isRunning) return;
        
        // Update remaining time
        this.state.remaining = Math.max(0, this.state.remaining + seconds);
        
        // Adjust start time to account for added time
        if (this.state.startTime) {
            this.state.startTime -= seconds * 1000;
        }
        
        // Update display
        this.update();
        
        this.logTimerEvent('time_adjusted', {
            secondsAdded: seconds,
            newRemaining: this.state.remaining
        });
    }
    
    /**
     * Get statistics for the current question
     * @returns {Object} Timer statistics
     */
    getStatistics() {
        return {
            questionId: this.state.questionId,
            difficulty: this.state.questionDifficulty,
            allocatedTime: this.state.totalTime,
            timeSpent: this.state.elapsed,
            timeRemaining: this.state.remaining,
            efficiency: this.state.elapsed > 0 ? 
                Math.min(100, (this.state.elapsed / this.state.totalTime) * 100) : 0,
            colorChanges: this.state.colorHistory ? this.state.colorHistory.length : 0,
            averageTimePerColor: this.getAverageTimePerColor()
        };
    }
    
    /**
     * Calculate average time spent in each color
     * @returns {Object} Average times
     */
    getAverageTimePerColor() {
        if (!this.state.colorHistory || this.state.colorHistory.length < 2) {
            return {};
        }
        
        const times = {};
        const colorDurations = {};
        
        // Calculate durations for each color period
        for (let i = 1; i < this.state.colorHistory.length; i++) {
            const prev = this.state.colorHistory[i - 1];
            const curr = this.state.colorHistory[i];
            const duration = (curr.time - prev.time) / 1000;
            const color = prev.to;
            
            if (!colorDurations[color]) {
                colorDurations[color] = [];
            }
            colorDurations[color].push(duration);
        }
        
        // Calculate averages
        for (const color in colorDurations) {
            const durations = colorDurations[color];
            const sum = durations.reduce((a, b) => a + b, 0);
            times[color] = sum / durations.length;
        }
        
        return times;
    }
    
    /**
     * Log timer event
     * @param {string} event - Event type
     * @param {Object} data - Event data
     */
    logTimerEvent(event, data = {}) {
        const logEntry = {
            timestamp: Date.now(),
            event,
            questionId: this.state.questionId,
            difficulty: this.state.questionDifficulty,
            ...data,
            state: {
                isRunning: this.state.isRunning,
                isPaused: this.state.isPaused,
                elapsed: this.state.elapsed,
                remaining: this.state.remaining,
                color: this.state.currentColor
            }
        };
        
        // Save to localStorage for debugging
        try {
            const logs = JSON.parse(localStorage.getItem('timerLogs') || '[]');
            logs.push(logEntry);
            localStorage.setItem('timerLogs', JSON.stringify(logs.slice(-50))); // Keep last 50 logs
        } catch (e) {
            // Silently fail if localStorage is not available
        }
        
        // Console log in development
        if (this.config.debug) {
            console.log(`[Timer] ${event}:`, logEntry);
        }
    }
    
    /**
     * Get all timer logs
     * @returns {Array} Timer logs
     */
    getLogs() {
        try {
            return JSON.parse(localStorage.getItem('timerLogs') || '[]');
        } catch (e) {
            return [];
        }
    }
    
    /**
     * Clear timer logs
     */
    clearLogs() {
        try {
            localStorage.removeItem('timerLogs');
            localStorage.removeItem('timerAutoSaves');
        } catch (e) {
            // Silently fail
        }
    }
    
    /**
     * Export timer data
     * @returns {Object} Timer data export
     */
    exportData() {
        return {
            config: this.config,
            state: this.state,
            statistics: this.getStatistics(),
            logs: this.getLogs(),
            exportTime: Date.now()
        };
    }
    
    /**
     * Import timer data
     * @param {Object} data - Timer data to import
     */
    importData(data) {
        if (data.config) {
            this.config = { ...this.config, ...data.config };
        }
        
        if (data.state) {
            this.state = { ...this.state, ...data.state };
            this.updateDisplay();
        }
        
        if (data.logs) {
            try {
                localStorage.setItem('timerLogs', JSON.stringify(data.logs));
            } catch (e) {
                console.warn('Could not import timer logs:', e);
            }
        }
    }
    
    /**
     * Destroy timer instance and clean up
     */
    destroy() {
        this.stop();
        
        // Remove event listeners
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.handleTabSwitch);
            window.removeEventListener('blur', this.handleWindowBlur);
        }
        
        // Remove DOM element if we created it
        if (this.displayElement && this.displayElement.parentNode) {
            this.displayElement.parentNode.removeChild(this.displayElement);
        }
        
        // Clear intervals
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
        }
        
        // Clear references
        this.displayElement = null;
        this.progressElement = null;
        this.config = null;
        this.state = null;
    }
}

// Utility functions for standalone timer operations
const TimerUtils = {
    /**
     * Format seconds to MM:SS
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },
    
    /**
     * Calculate time for difficulty
     * @param {string} difficulty - Difficulty level
     * @param {Object} customTimes - Custom time settings
     * @returns {number} Time in seconds
     */
    calculateTime(difficulty, customTimes = {}) {
        const times = {
            easy: customTimes.easyTime || 21,
            medium: customTimes.mediumTime || 30,
            hard: customTimes.hardTime || 42,
            expert: customTimes.expertTime || 54
        };
        
        return times[difficulty.toLowerCase()] || times.medium;
    },
    
    /**
     * Get color for remaining time percentage
     * @param {number} remaining - Remaining time in seconds
     * @param {number} total - Total time in seconds
     * @param {Object} thresholds - Color thresholds
     * @returns {string} Color name
     */
    getColorForTime(remaining, total, thresholds = {}) {
        const percentage = remaining / total;
        const green = thresholds.greenThreshold || 0.7;
        const yellow = thresholds.yellowThreshold || 0.3;
        const red = thresholds.redThreshold || 0.1;
        
        if (percentage > green) return 'green';
        if (percentage > yellow) return 'yellow';
        if (percentage > red) return 'red';
        return 'red'; // For less than red threshold
    },
    
    /**
     * Should timer flash?
     * @param {number} remaining - Remaining time in seconds
     * @param {number} threshold - Flashing threshold
     * @returns {boolean} Whether to flash
     */
    shouldFlash(remaining, threshold = 5) {
        return remaining <= threshold;
    },
    
    /**
     * Create a simple timer display
     * @param {HTMLElement} container - Container element
     * @param {number} time - Time in seconds
     * @param {string} color - Timer color
     * @param {boolean} flashing - Whether to flash
     */
    createSimpleDisplay(container, time, color = 'green', flashing = false) {
        const timerElement = document.createElement('div');
        timerElement.className = `simple-timer timer-${color} ${flashing ? 'timer-flashing' : ''}`;
        timerElement.innerHTML = `
            <div class="timer-content">
                <span class="timer-value">${this.formatTime(time)}</span>
                <div class="timer-color" style="background-color: ${this.getColorHex(color)}"></div>
            </div>
        `;
        
        if (container) {
            container.innerHTML = '';
            container.appendChild(timerElement);
        }
        
        return timerElement;
    },
    
    /**
     * Get hex color for color name
     * @param {string} color - Color name
     * @returns {string} Hex color
     */
    getColorHex(color) {
        const colors = {
            green: '#4CAF50',
            yellow: '#FF9800',
            red: '#F44336',
            expired: '#9E9E9E'
        };
        return colors[color] || '#4CAF50';
    },
    
    /**
     * Validate time settings
     * @param {Object} settings - Time settings
     * @returns {Object} Validation result
     */
    validateSettings(settings) {
        const errors = [];
        const warnings = [];
        
        // Check required fields
        if (!settings.easyTime || settings.easyTime < 1) {
            errors.push('Easy time must be at least 1 second');
        }
        if (!settings.mediumTime || settings.mediumTime < 1) {
            errors.push('Medium time must be at least 1 second');
        }
        if (!settings.hardTime || settings.hardTime < 1) {
            errors.push('Hard time must be at least 1 second');
        }
        if (!settings.expertTime || settings.expertTime < 1) {
            errors.push('Expert time must be at least 1 second');
        }
        
        // Check logical progression (easy < medium < hard < expert)
        if (settings.easyTime >= settings.mediumTime) {
            warnings.push('Easy time should be less than medium time');
        }
        if (settings.mediumTime >= settings.hardTime) {
            warnings.push('Medium time should be less than hard time');
        }
        if (settings.hardTime >= settings.expertTime) {
            warnings.push('Hard time should be less than expert time');
        }
        
        // Check color thresholds
        if (settings.greenThreshold <= settings.yellowThreshold) {
            errors.push('Green threshold must be greater than yellow threshold');
        }
        if (settings.yellowThreshold <= settings.redThreshold) {
            errors.push('Yellow threshold must be greater than red threshold');
        }
        if (settings.redThreshold <= 0) {
            errors.push('Red threshold must be greater than 0');
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }
};

// CSS styles for the timer (to be injected into the page)
const TimerStyles = `
.adaptive-timer {
    position: relative;
    display: inline-block;
    padding: 10px 20px;
    border-radius: 8px;
    background-color: #f5f5f5;
    font-family: 'Arial', sans-serif;
    font-size: 1.5rem;
    font-weight: bold;
    transition: all 0.3s ease;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.adaptive-timer.timer-green {
    background-color: rgba(76, 175, 80, 0.1);
    border: 2px solid #4CAF50;
    color: #2E7D32;
}

.adaptive-timer.timer-yellow {
    background-color: rgba(255, 152, 0, 0.1);
    border: 2px solid #FF9800;
    color: #EF6C00;
}

.adaptive-timer.timer-red {
    background-color: rgba(244, 67, 54, 0.1);
    border: 2px solid #F44336;
    color: #D32F2F;
}

.adaptive-timer.timer-expired {
    background-color: rgba(158, 158, 158, 0.1);
    border: 2px solid #9E9E9E;
    color: #616161;
}

.adaptive-timer.timer-flashing {
    animation: timer-flash 1s infinite;
}

.adaptive-timer.paused {
    opacity: 0.7;
    border-style: dashed;
}

@keyframes timer-flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}

.timer-display {
    display: flex;
    align-items: center;
    gap: 10px;
}

.timer-text {
    min-width: 60px;
    text-align: center;
}

.timer-color-indicator {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    transition: background-color 0.3s ease;
}

.timer-color-indicator.flashing {
    animation: indicator-flash 0.5s infinite;
}

@keyframes indicator-flash {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
}

.timer-progress {
    margin-top: 8px;
}

.progress-bar {
    width: 100%;
    height: 6px;
    background-color: #e0e0e0;
    border-radius: 3px;
    overflow: hidden;
}

.progress-fill {
    height: 100%;
    width: 0%;
    transition: width 0.1s linear, background-color 0.3s ease;
}

.timer-warning {
    margin-top: 8px;
    padding: 4px 8px;
    background-color: #FFF3CD;
    border: 1px solid #FFEAA7;
    border-radius: 4px;
    color: #856404;
    font-size: 0.875rem;
    text-align: center;
}

.simple-timer {
    padding: 8px 16px;
    border-radius: 6px;
    font-weight: bold;
    display: inline-flex;
    align-items: center;
    gap: 8px;
}

.timer-content {
    display: flex;
    align-items: center;
    gap: 8px;
}

.timer-color {
    width: 12px;
    height: 12px;
    border-radius: 50%;
}

/* Exam room specific styles */
.exam-timer {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 1000;
    font-size: 1.8rem;
    padding: 12px 24px;
}

.exam-timer.timer-red.timer-flashing {
    animation: exam-timer-flash 0.5s infinite;
}

@keyframes exam-timer-flash {
    0%, 100% { 
        background-color: rgba(244, 67, 54, 0.2);
        box-shadow: 0 0 0 rgba(244, 67, 54, 0.4);
    }
    50% { 
        background-color: rgba(244, 67, 54, 0.4);
        box-shadow: 0 0 20px rgba(244, 67, 54, 0.6);
    }
}

/* Mobile responsive */
@media (max-width: 768px) {
    .adaptive-timer {
        padding: 8px 16px;
        font-size: 1.3rem;
    }
    
    .exam-timer {
        top: 10px;
        right: 10px;
        font-size: 1.5rem;
        padding: 10px 20px;
    }
}
`;

// Inject styles into the document
if (typeof document !== 'undefined') {
    const styleElement = document.createElement('style');
    styleElement.textContent = TimerStyles;
    document.head.appendChild(styleElement);
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
    // Node.js/CommonJS
    module.exports = {
        AdaptiveTimer,
        TimerUtils,
        TimerStyles
    };
} else if (typeof define === 'function' && define.amd) {
    // AMD
    define([], function() {
        return {
            AdaptiveTimer,
            TimerUtils,
            TimerStyles
        };
    });
} else {
    // Browser global
    window.AdaptiveTimer = AdaptiveTimer;
    window.TimerUtils = TimerUtils;
    window.TimerStyles = TimerStyles;
}
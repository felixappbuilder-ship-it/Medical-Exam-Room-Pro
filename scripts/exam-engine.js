/**
 * exam-engine.js - Core Exam Logic
 * Purpose: Exam execution, timing, question selection, state management
 * Features: Question randomization, adaptive timing, difficulty balancing, auto-save
 */

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const EXAM_CONFIG = {
    // Time per difficulty (seconds)
    TIMING: {
        EASY: 21,      // Level 1
        MEDIUM: 30,    // Level 2
        INTERMEDIATE: 42, // Level 3
        HARD: 54,      // Level 4
        EXPERT: 54     // Level 5
    },
    
    // Difficulty distribution for mixed exams
    DIFFICULTY_DISTRIBUTION: {
        EASY: 0.2,     // 20%
        MEDIUM: 0.3,   // 30%
        INTERMEDIATE: 0.25, // 25%
        HARD: 0.15,    // 15%
        EXPERT: 0.10   // 10%
    },
    
    // Exam modes
    MODES: {
        PRACTICE: 'practice',
        TIMED: 'timed',
        QUICK: 'quick',
        STANDARD: 'standard',
        FULL: 'full',
        CUSTOM: 'custom'
    },
    
    // Exam type settings
    EXAM_TYPES: {
        QUICK: { questions: 10, time: 5 * 60 },      // 5-8 minutes
        STANDARD: { questions: 25, time: 15 * 60 },  // 12-19 minutes
        FULL: { questions: 50, time: 30 * 60 }       // 25-38 minutes
    },
    
    // Auto-save interval (milliseconds)
    AUTO_SAVE_INTERVAL: 30000, // 30 seconds
    
    // Question navigation
    MAX_QUESTION_HISTORY: 100, // How many previous questions to remember
    
    // Security
    MIN_TIME_PER_QUESTION: 3, // Minimum realistic time per question (seconds)
    MAX_TIME_PER_QUESTION: 120 // Maximum allowed time per question (seconds)
};

// ============================================================================
// EXAM ENGINE CLASS
// ============================================================================

class ExamEngine {
    constructor() {
        this.examState = null;
        this.currentQuestionIndex = 0;
        this.isPaused = false;
        this.isCompleted = false;
        this.autoSaveTimer = null;
        this.questionStartTime = null;
        this.eventListeners = {};
        
        // Bind methods
        this.startExam = this.startExam.bind(this);
        this.pauseExam = this.pauseExam.bind(this);
        this.resumeExam = this.resumeExam.bind(this);
        this.submitExam = this.submitExam.bind(this);
        this.nextQuestion = this.nextQuestion.bind(this);
        this.previousQuestion = this.previousQuestion.bind(this);
        this.goToQuestion = this.goToQuestion.bind(this);
        this.flagQuestion = this.flagQuestion.bind(this);
        this.saveAnswer = this.saveAnswer.bind(this);
        this.autoSave = this.autoSave.bind(this);
        
        console.log("Exam Engine initialized");
    }
    
    // ============================================================================
    // EXAM INITIALIZATION & CONTROL
    // ============================================================================
    
    /**
     * Start a new exam with provided settings and questions
     * @param {Object} settings - Exam settings
     * @param {Array} questions - Questions for the exam
     * @returns {Object} - Exam state
     */
    async startExam(settings, questions) {
        try {
            // Validate inputs
            if (!settings || !questions || questions.length === 0) {
                throw new Error("Invalid exam configuration");
            }
            
            // Create exam state
            this.examState = {
                id: `exam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                settings: this.validateSettings(settings),
                questions: this.prepareQuestions(questions, settings),
                startTime: Date.now(),
                currentTime: Date.now(),
                timeSpent: 0,
                pausedTime: 0,
                answers: {},
                flags: {},
                navigation: [],
                isCompleted: false,
                autoSaveCount: 0,
                lastSaveTime: null,
                createdAt: new Date().toISOString(),
                version: '1.0'
            };
            
            // Initialize question answers
            this.examState.questions.forEach((q, index) => {
                this.examState.answers[q.id] = {
                    selectedOption: null,
                    timeSpent: 0,
                    isFlagged: false,
                    isAnswered: false,
                    isViewed: false,
                    confidence: null,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };
                
                this.examState.flags[q.id] = false;
            });
            
            // Mark first question as viewed
            const firstQuestion = this.examState.questions[0];
            this.examState.answers[firstQuestion.id].isViewed = true;
            
            // Set current question
            this.currentQuestionIndex = 0;
            this.questionStartTime = Date.now();
            this.isPaused = false;
            this.isCompleted = false;
            
            // Start auto-save
            this.startAutoSave();
            
            // Dispatch event
            this.dispatchEvent('examStarted', {
                examId: this.examState.id,
                totalQuestions: this.examState.questions.length,
                settings: this.examState.settings
            });
            
            console.log(`Exam started: ${this.examState.id} with ${this.examState.questions.length} questions`);
            
            // Return current question for UI
            return {
                examId: this.examState.id,
                currentQuestion: this.getCurrentQuestion(),
                progress: this.getProgress(),
                timeRemaining: this.getTimeRemaining()
            };
        } catch (error) {
            console.error("Failed to start exam:", error);
            throw error;
        }
    }
    
    /**
     * Resume an existing exam from saved state
     * @param {Object} savedState - Saved exam state
     * @returns {Object} - Exam state
     */
    async resumeExam(savedState) {
        try {
            if (!savedState || !savedState.id) {
                throw new Error("Invalid saved state");
            }
            
            // Restore exam state
            this.examState = savedState;
            this.currentQuestionIndex = savedState.currentQuestionIndex || 0;
            this.isPaused = false;
            this.isCompleted = savedState.isCompleted || false;
            
            // Resume timing
            if (!this.isCompleted) {
                this.questionStartTime = Date.now();
                this.startAutoSave();
                
                // Dispatch event
                this.dispatchEvent('examResumed', {
                    examId: this.examState.id,
                    currentQuestion: this.currentQuestionIndex + 1,
                    totalQuestions: this.examState.questions.length
                });
                
                console.log(`Exam resumed: ${this.examState.id}`);
            }
            
            return {
                examId: this.examState.id,
                currentQuestion: this.getCurrentQuestion(),
                progress: this.getProgress(),
                timeRemaining: this.getTimeRemaining(),
                isCompleted: this.isCompleted
            };
        } catch (error) {
            console.error("Failed to resume exam:", error);
            throw error;
        }
    }
    
    /**
     * Pause the exam
     */
    pauseExam() {
        if (!this.examState || this.isPaused || this.isCompleted) {
            return;
        }
        
        this.isPaused = true;
        
        // Update time spent on current question
        this.updateQuestionTime();
        
        // Store pause time
        this.examState.pausedTime = Date.now();
        
        // Stop auto-save
        this.stopAutoSave();
        
        // Dispatch event
        this.dispatchEvent('examPaused', {
            examId: this.examState.id,
            currentQuestion: this.currentQuestionIndex + 1
        });
        
        console.log("Exam paused");
    }
    
    /**
     * Resume from pause
     */
    resumeExamFromPause() {
        if (!this.examState || !this.isPaused || this.isCompleted) {
            return;
        }
        
        this.isPaused = false;
        
        // Adjust time for pause duration
        const pauseDuration = Date.now() - this.examState.pausedTime;
        this.questionStartTime += pauseDuration;
        
        // Restart auto-save
        this.startAutoSave();
        
        // Dispatch event
        this.dispatchEvent('examResumed', {
            examId: this.examState.id,
            currentQuestion: this.currentQuestionIndex + 1
        });
        
        console.log("Exam resumed from pause");
    }
    
    /**
     * Submit the exam for scoring
     * @returns {Object} - Exam results
     */
    async submitExam() {
        try {
            if (!this.examState || this.isCompleted) {
                throw new Error("No active exam or exam already completed");
            }
            
            // Update time for current question
            this.updateQuestionTime();
            
            // Mark as completed
            this.isCompleted = true;
            this.examState.isCompleted = true;
            this.examState.completedAt = new Date().toISOString();
            this.examState.totalTimeSpent = this.calculateTotalTime();
            
            // Stop auto-save
            this.stopAutoSave();
            
            // Calculate results
            const results = this.calculateResults();
            
            // Save final state
            await this.saveExamState();
            
            // Dispatch event
            this.dispatchEvent('examSubmitted', {
                examId: this.examState.id,
                results: results
            });
            
            console.log(`Exam submitted: ${this.examState.id}`);
            
            return {
                examId: this.examState.id,
                results: results,
                examState: this.examState
            };
        } catch (error) {
            console.error("Failed to submit exam:", error);
            throw error;
        }
    }
    
    /**
     * Force quit exam without submitting
     */
    async quitExam() {
        if (!this.examState) return;
        
        // Save current state before quitting
        await this.saveExamState();
        
        // Stop auto-save
        this.stopAutoSave();
        
        // Dispatch event
        this.dispatchEvent('examQuit', {
            examId: this.examState.id,
            progress: this.getProgress()
        });
        
        console.log("Exam quit");
        
        // Clear state
        this.examState = null;
        this.currentQuestionIndex = 0;
        this.isPaused = false;
        this.isCompleted = false;
    }
    
    // ============================================================================
    // QUESTION NAVIGATION
    // ============================================================================
    
    /**
     * Get current question
     * @returns {Object} - Current question with user answer
     */
    getCurrentQuestion() {
        if (!this.examState || this.currentQuestionIndex >= this.examState.questions.length) {
            return null;
        }
        
        const question = this.examState.questions[this.currentQuestionIndex];
        const answer = this.examState.answers[question.id];
        
        return {
            ...question,
            questionNumber: this.currentQuestionIndex + 1,
            userAnswer: answer.selectedOption,
            isFlagged: answer.isFlagged,
            timeSpent: answer.timeSpent,
            isAnswered: answer.isAnswered,
            isViewed: answer.isViewed,
            timeAllocated: this.getTimeForQuestion(question)
        };
    }
    
    /**
     * Move to next question
     * @returns {Object} - Next question
     */
    nextQuestion() {
        if (!this.examState || this.isCompleted) {
            return null;
        }
        
        // Update time for current question
        this.updateQuestionTime();
        
        // Save navigation history
        this.examState.navigation.push({
            from: this.currentQuestionIndex,
            to: this.currentQuestionIndex + 1,
            timestamp: Date.now()
        });
        
        // Trim navigation history
        if (this.examState.navigation.length > EXAM_CONFIG.MAX_QUESTION_HISTORY) {
            this.examState.navigation.shift();
        }
        
        // Move to next question
        this.currentQuestionIndex++;
        
        // Check if exam is complete
        if (this.currentQuestionIndex >= this.examState.questions.length) {
            this.currentQuestionIndex = this.examState.questions.length - 1;
            
            // If auto-submit is enabled, submit the exam
            if (this.examState.settings.autoSubmit) {
                this.submitExam();
                return null;
            }
            
            return this.getCurrentQuestion();
        }
        
        // Mark question as viewed
        const questionId = this.examState.questions[this.currentQuestionIndex].id;
        this.examState.answers[questionId].isViewed = true;
        
        // Reset question start time
        this.questionStartTime = Date.now();
        
        // Dispatch event
        this.dispatchEvent('questionChanged', {
            questionNumber: this.currentQuestionIndex + 1,
            totalQuestions: this.examState.questions.length
        });
        
        return this.getCurrentQuestion();
    }
    
    /**
     * Move to previous question
     * @returns {Object} - Previous question
     */
    previousQuestion() {
        if (!this.examState || this.currentQuestionIndex <= 0 || this.isCompleted) {
            return null;
        }
        
        // Update time for current question
        this.updateQuestionTime();
        
        // Save navigation history
        this.examState.navigation.push({
            from: this.currentQuestionIndex,
            to: this.currentQuestionIndex - 1,
            timestamp: Date.now()
        });
        
        // Move to previous question
        this.currentQuestionIndex--;
        
        // Mark question as viewed
        const questionId = this.examState.questions[this.currentQuestionIndex].id;
        this.examState.answers[questionId].isViewed = true;
        
        // Reset question start time
        this.questionStartTime = Date.now();
        
        // Dispatch event
        this.dispatchEvent('questionChanged', {
            questionNumber: this.currentQuestionIndex + 1,
            totalQuestions: this.examState.questions.length
        });
        
        return this.getCurrentQuestion();
    }
    
    /**
     * Go to specific question by index
     * @param {number} index - Question index (0-based)
     * @returns {Object} - Question at index
     */
    goToQuestion(index) {
        if (!this.examState || this.isCompleted) {
            return null;
        }
        
        // Validate index
        if (index < 0 || index >= this.examState.questions.length) {
            throw new Error(`Invalid question index: ${index}`);
        }
        
        // Update time for current question
        this.updateQuestionTime();
        
        // Save navigation history
        this.examState.navigation.push({
            from: this.currentQuestionIndex,
            to: index,
            timestamp: Date.now()
        });
        
        // Change current question
        this.currentQuestionIndex = index;
        
        // Mark question as viewed
        const questionId = this.examState.questions[this.currentQuestionIndex].id;
        this.examState.answers[questionId].isViewed = true;
        
        // Reset question start time
        this.questionStartTime = Date.now();
        
        // Dispatch event
        this.dispatchEvent('questionChanged', {
            questionNumber: this.currentQuestionIndex + 1,
            totalQuestions: this.examState.questions.length
        });
        
        return this.getCurrentQuestion();
    }
    
    /**
     * Go to question by ID
     * @param {string} questionId - Question ID
     * @returns {Object} - Question
     */
    goToQuestionById(questionId) {
        if (!this.examState) return null;
        
        const index = this.examState.questions.findIndex(q => q.id === questionId);
        if (index === -1) {
            throw new Error(`Question not found: ${questionId}`);
        }
        
        return this.goToQuestion(index);
    }
    
    // ============================================================================
    // ANSWER MANAGEMENT
    // ============================================================================
    
    /**
     * Save answer for current question
     * @param {string} answer - Selected option (e.g., "A", "B", "C", "D", "E")
     * @param {number} confidence - Confidence level 1-5 (optional)
     */
    saveAnswer(answer, confidence = null) {
        if (!this.examState || this.isCompleted) {
            return false;
        }
        
        const currentQuestion = this.examState.questions[this.currentQuestionIndex];
        if (!currentQuestion) return false;
        
        const answerData = this.examState.answers[currentQuestion.id];
        
        // Validate answer format
        if (answer && !this.validateAnswerFormat(answer, currentQuestion.options)) {
            throw new Error(`Invalid answer format: ${answer}`);
        }
        
        // Update answer
        answerData.selectedOption = answer;
        answerData.isAnswered = !!answer;
        answerData.confidence = confidence;
        answerData.updatedAt = Date.now();
        
        // Update time spent
        this.updateQuestionTime();
        
        // Dispatch event
        this.dispatchEvent('answerSaved', {
            questionId: currentQuestion.id,
            questionNumber: this.currentQuestionIndex + 1,
            answer: answer,
            isAnswered: !!answer
        });
        
        return true;
    }
    
    /**
     * Clear answer for current question
     */
    clearAnswer() {
        return this.saveAnswer(null);
    }
    
    /**
     * Flag current question for review
     * @param {boolean} flagged - Flag status
     */
    flagQuestion(flagged = true) {
        if (!this.examState || this.isCompleted) {
            return false;
        }
        
        const currentQuestion = this.examState.questions[this.currentQuestionIndex];
        if (!currentQuestion) return false;
        
        const answerData = this.examState.answers[currentQuestion.id];
        answerData.isFlagged = flagged;
        answerData.updatedAt = Date.now();
        
        this.examState.flags[currentQuestion.id] = flagged;
        
        // Dispatch event
        this.dispatchEvent('questionFlagged', {
            questionId: currentQuestion.id,
            questionNumber: this.currentQuestionIndex + 1,
            flagged: flagged
        });
        
        return true;
    }
    
    /**
     * Toggle flag for current question
     */
    toggleFlag() {
        if (!this.examState) return false;
        
        const currentQuestion = this.examState.questions[this.currentQuestionIndex];
        if (!currentQuestion) return false;
        
        const currentFlag = this.examState.answers[currentQuestion.id].isFlagged;
        return this.flagQuestion(!currentFlag);
    }
    
    /**
     * Get all flagged questions
     * @returns {Array} - Flagged question indices
     */
    getFlaggedQuestions() {
        if (!this.examState) return [];
        
        return this.examState.questions
            .map((q, index) => ({
                index,
                question: q,
                answer: this.examState.answers[q.id]
            }))
            .filter(item => item.answer.isFlagged);
    }
    
    /**
     * Get all unanswered questions
     * @returns {Array} - Unanswered question indices
     */
    getUnansweredQuestions() {
        if (!this.examState) return [];
        
        return this.examState.questions
            .map((q, index) => ({
                index,
                question: q,
                answer: this.examState.answers[q.id]
            }))
            .filter(item => !item.answer.isAnswered);
    }
    
    // ============================================================================
    // TIME MANAGEMENT
    // ============================================================================
    
    /**
     * Update time spent on current question
     */
    updateQuestionTime() {
        if (!this.examState || !this.questionStartTime || this.isPaused) {
            return;
        }
        
        const currentQuestion = this.examState.questions[this.currentQuestionIndex];
        if (!currentQuestion) return;
        
        const now = Date.now();
        const timeSpent = Math.floor((now - this.questionStartTime) / 1000);
        
        // Validate time spent (anti-cheating)
        if (timeSpent < EXAM_CONFIG.MIN_TIME_PER_QUESTION) {
            console.warn(`Suspiciously fast answer: ${timeSpent}s for question ${currentQuestion.id}`);
        }
        
        if (timeSpent > EXAM_CONFIG.MAX_TIME_PER_QUESTION) {
            console.warn(`Excessive time spent: ${timeSpent}s for question ${currentQuestion.id}`);
        }
        
        // Update answer time
        const answerData = this.examState.answers[currentQuestion.id];
        answerData.timeSpent = timeSpent;
        
        // Update total exam time
        this.examState.timeSpent += timeSpent;
        
        // Reset start time
        this.questionStartTime = now;
        
        return timeSpent;
    }
    
    /**
     * Get time allocated for a question based on difficulty
     * @param {Object} question - Question object
     * @returns {number} - Time in seconds
     */
    getTimeForQuestion(question) {
        const difficulty = question.difficulty || 3;
        
        switch(difficulty) {
            case 1: return EXAM_CONFIG.TIMING.EASY;
            case 2: return EXAM_CONFIG.TIMING.MEDIUM;
            case 3: return EXAM_CONFIG.TIMING.INTERMEDIATE;
            case 4: return EXAM_CONFIG.TIMING.HARD;
            case 5: return EXAM_CONFIG.TIMING.EXPERT;
            default: return EXAM_CONFIG.TIMING.MEDIUM;
        }
    }
    
    /**
     * Get time spent on current question
     * @returns {number} - Time in seconds
     */
    getCurrentQuestionTimeSpent() {
        if (!this.examState || !this.questionStartTime || this.isPaused) {
            return 0;
        }
        
        const now = Date.now();
        return Math.floor((now - this.questionStartTime) / 1000);
    }
    
    /**
     * Get total time spent on exam
     * @returns {number} - Time in seconds
     */
    calculateTotalTime() {
        if (!this.examState) return 0;
        
        let total = this.examState.timeSpent || 0;
        
        // Add time for current question if exam is active
        if (!this.isCompleted && !this.isPaused) {
            total += this.getCurrentQuestionTimeSpent();
        }
        
        return total;
    }
    
    /**
     * Get time remaining for current question
     * @returns {Object} - Time remaining and percentage
     */
    getCurrentQuestionTimeRemaining() {
        if (!this.examState || this.isCompleted) {
            return { seconds: 0, percentage: 0 };
        }
        
        const currentQuestion = this.examState.questions[this.currentQuestionIndex];
        if (!currentQuestion) return { seconds: 0, percentage: 0 };
        
        const allocatedTime = this.getTimeForQuestion(currentQuestion);
        const spentTime = this.getCurrentQuestionTimeSpent();
        const remaining = Math.max(0, allocatedTime - spentTime);
        const percentage = Math.max(0, Math.min(100, (spentTime / allocatedTime) * 100));
        
        return {
            seconds: remaining,
            percentage: percentage,
            allocated: allocatedTime,
            spent: spentTime
        };
    }
    
    /**
     * Get overall exam time remaining (for timed exams)
     * @returns {Object} - Time remaining and percentage
     */
    getExamTimeRemaining() {
        if (!this.examState || !this.examState.settings || 
            this.examState.settings.mode !== EXAM_CONFIG.MODES.TIMED) {
            return null;
        }
        
        const examDuration = this.examState.settings.duration * 60; // Convert minutes to seconds
        const timeSpent = this.calculateTotalTime();
        const remaining = Math.max(0, examDuration - timeSpent);
        const percentage = Math.max(0, Math.min(100, (timeSpent / examDuration) * 100));
        
        return {
            seconds: remaining,
            percentage: percentage,
            allocated: examDuration,
            spent: timeSpent
        };
    }
    
    /**
     * Check if time is up for current question
     * @returns {boolean} - True if time is up
     */
    isQuestionTimeUp() {
        if (!this.examState || this.isCompleted) return false;
        
        const timeRemaining = this.getCurrentQuestionTimeRemaining();
        return timeRemaining.seconds <= 0;
    }
    
    /**
     * Check if exam time is up (for timed exams)
     * @returns {boolean} - True if exam time is up
     */
    isExamTimeUp() {
        if (!this.examState || this.isCompleted) return false;
        
        if (this.examState.settings.mode === EXAM_CONFIG.MODES.TIMED) {
            const timeRemaining = this.getExamTimeRemaining();
            return timeRemaining && timeRemaining.seconds <= 0;
        }
        
        return false;
    }
    
    // ============================================================================
    // PROGRESS & STATISTICS
    // ============================================================================
    
    /**
     * Get exam progress
     * @returns {Object} - Progress statistics
     */
    getProgress() {
        if (!this.examState) {
            return {
                current: 0,
                total: 0,
                percentage: 0,
                answered: 0,
                flagged: 0,
                visited: 0
            };
        }
        
        const totalQuestions = this.examState.questions.length;
        const answered = Object.values(this.examState.answers).filter(a => a.isAnswered).length;
        const flagged = Object.values(this.examState.answers).filter(a => a.isFlagged).length;
        const visited = Object.values(this.examState.answers).filter(a => a.isViewed).length;
        
        return {
            current: this.currentQuestionIndex + 1,
            total: totalQuestions,
            percentage: Math.round((this.currentQuestionIndex + 1) / totalQuestions * 100),
            answered: answered,
            flagged: flagged,
            visited: visited,
            unanswered: totalQuestions - answered,
            notVisited: totalQuestions - visited
        };
    }
    
    /**
     * Get question statistics
     * @returns {Object} - Question statistics
     */
    getQuestionStatistics() {
        if (!this.examState) return {};
        
        const stats = {
            total: this.examState.questions.length,
            bySubject: {},
            byDifficulty: {},
            byTopic: {},
            timeSpent: {
                total: 0,
                average: 0,
                byDifficulty: {}
            }
        };
        
        // Calculate statistics
        this.examState.questions.forEach((question, index) => {
            const answer = this.examState.answers[question.id];
            
            // By subject
            if (!stats.bySubject[question.subject]) {
                stats.bySubject[question.subject] = {
                    count: 0,
                    answered: 0,
                    flagged: 0,
                    timeSpent: 0
                };
            }
            stats.bySubject[question.subject].count++;
            if (answer.isAnswered) stats.bySubject[question.subject].answered++;
            if (answer.isFlagged) stats.bySubject[question.subject].flagged++;
            stats.bySubject[question.subject].timeSpent += answer.timeSpent;
            
            // By difficulty
            const difficulty = question.difficulty || 3;
            if (!stats.byDifficulty[difficulty]) {
                stats.byDifficulty[difficulty] = {
                    count: 0,
                    answered: 0,
                    flagged: 0,
                    timeSpent: 0
                };
            }
            stats.byDifficulty[difficulty].count++;
            if (answer.isAnswered) stats.byDifficulty[difficulty].answered++;
            if (answer.isFlagged) stats.byDifficulty[difficulty].flagged++;
            stats.byDifficulty[difficulty].timeSpent += answer.timeSpent;
            
            // By topic
            if (question.topic) {
                if (!stats.byTopic[question.topic]) {
                    stats.byTopic[question.topic] = {
                        count: 0,
                        answered: 0,
                        flagged: 0,
                        timeSpent: 0
                    };
                }
                stats.byTopic[question.topic].count++;
                if (answer.isAnswered) stats.byTopic[question.topic].answered++;
                if (answer.isFlagged) stats.byTopic[question.topic].flagged++;
                stats.byTopic[question.topic].timeSpent += answer.timeSpent;
            }
            
            // Time statistics
            stats.timeSpent.total += answer.timeSpent;
            
            if (!stats.timeSpent.byDifficulty[difficulty]) {
                stats.timeSpent.byDifficulty[difficulty] = {
                    total: 0,
                    count: 0
                };
            }
            stats.timeSpent.byDifficulty[difficulty].total += answer.timeSpent;
            stats.timeSpent.byDifficulty[difficulty].count++;
        });
        
        // Calculate averages
        if (stats.total > 0) {
            stats.timeSpent.average = stats.timeSpent.total / stats.total;
            
            // Calculate averages for byDifficulty
            Object.keys(stats.timeSpent.byDifficulty).forEach(diff => {
                const data = stats.timeSpent.byDifficulty[diff];
                if (data.count > 0) {
                    data.average = data.total / data.count;
                }
            });
        }
        
        return stats;
    }
    
    /**
     * Calculate exam results
     * @returns {Object} - Exam results
     */
    calculateResults() {
        if (!this.examState) return null;
        
        // Ensure we have all times updated
        this.updateQuestionTime();
        
        const totalQuestions = this.examState.questions.length;
        let correctAnswers = 0;
        let totalTimeSpent = 0;
        let scoreBySubject = {};
        let scoreByDifficulty = {};
        let scoreByTopic = {};
        
        // Calculate scores
        this.examState.questions.forEach(question => {
            const answer = this.examState.answers[question.id];
            const isCorrect = answer.selectedOption === question.correct;
            
            if (isCorrect) {
                correctAnswers++;
            }
            
            totalTimeSpent += answer.timeSpent || 0;
            
            // Subject scores
            if (!scoreBySubject[question.subject]) {
                scoreBySubject[question.subject] = {
                    total: 0,
                    correct: 0,
                    timeSpent: 0
                };
            }
            scoreBySubject[question.subject].total++;
            if (isCorrect) scoreBySubject[question.subject].correct++;
            scoreBySubject[question.subject].timeSpent += answer.timeSpent || 0;
            
            // Difficulty scores
            const difficulty = question.difficulty || 3;
            if (!scoreByDifficulty[difficulty]) {
                scoreByDifficulty[difficulty] = {
                    total: 0,
                    correct: 0,
                    timeSpent: 0
                };
            }
            scoreByDifficulty[difficulty].total++;
            if (isCorrect) scoreByDifficulty[difficulty].correct++;
            scoreByDifficulty[difficulty].timeSpent += answer.timeSpent || 0;
            
            // Topic scores
            if (question.topic) {
                if (!scoreByTopic[question.topic]) {
                    scoreByTopic[question.topic] = {
                        total: 0,
                        correct: 0,
                        timeSpent: 0
                    };
                }
                scoreByTopic[question.topic].total++;
                if (isCorrect) scoreByTopic[question.topic].correct++;
                scoreByTopic[question.topic].timeSpent += answer.timeSpent || 0;
            }
        });
        
        // Calculate percentages
        const overallScore = totalQuestions > 0 ? (correctAnswers / totalQuestions * 100) : 0;
        const averageTimePerQuestion = totalQuestions > 0 ? totalTimeSpent / totalQuestions : 0;
        
        // Calculate subject percentages
        Object.keys(scoreBySubject).forEach(subject => {
            const data = scoreBySubject[subject];
            data.percentage = data.total > 0 ? (data.correct / data.total * 100) : 0;
            data.averageTime = data.total > 0 ? data.timeSpent / data.total : 0;
        });
        
        // Calculate difficulty percentages
        Object.keys(scoreByDifficulty).forEach(difficulty => {
            const data = scoreByDifficulty[difficulty];
            data.percentage = data.total > 0 ? (data.correct / data.total * 100) : 0;
            data.averageTime = data.total > 0 ? data.timeSpent / data.total : 0;
        });
        
        // Calculate topic percentages
        Object.keys(scoreByTopic).forEach(topic => {
            const data = scoreByTopic[topic];
            data.percentage = data.total > 0 ? (data.correct / data.total * 100) : 0;
            data.averageTime = data.total > 0 ? data.timeSpent / data.total : 0;
        });
        
        // Identify weak areas (subjects/topics with lowest scores)
        const weakAreas = [];
        
        // Add subjects with score < 70%
        Object.keys(scoreBySubject).forEach(subject => {
            if (scoreBySubject[subject].percentage < 70 && scoreBySubject[subject].total >= 3) {
                weakAreas.push({
                    type: 'subject',
                    name: subject,
                    score: scoreBySubject[subject].percentage,
                    totalQuestions: scoreBySubject[subject].total
                });
            }
        });
        
        // Add topics with score < 70%
        Object.keys(scoreByTopic).forEach(topic => {
            if (scoreByTopic[topic].percentage < 70 && scoreByTopic[topic].total >= 3) {
                weakAreas.push({
                    type: 'topic',
                    name: topic,
                    score: scoreByTopic[topic].percentage,
                    totalQuestions: scoreByTopic[topic].total
                });
            }
        });
        
        // Sort weak areas by score (lowest first)
        weakAreas.sort((a, b) => a.score - b.score);
        
        // Calculate performance metrics
        const performance = {
            speed: averageTimePerQuestion < 30 ? 'fast' : averageTimePerQuestion < 45 ? 'moderate' : 'slow',
            accuracy: overallScore >= 80 ? 'high' : overallScore >= 60 ? 'moderate' : 'low',
            consistency: this.calculateConsistency(scoreBySubject)
        };
        
        return {
            examId: this.examState.id,
            totalQuestions: totalQuestions,
            correctAnswers: correctAnswers,
            incorrectAnswers: totalQuestions - correctAnswers,
            unansweredQuestions: Object.values(this.examState.answers).filter(a => !a.isAnswered).length,
            score: overallScore,
            timeSpent: totalTimeSpent,
            averageTimePerQuestion: averageTimePerQuestion,
            startedAt: this.examState.startTime,
            completedAt: this.examState.completedAt || Date.now(),
            subjects: scoreBySubject,
            difficulties: scoreByDifficulty,
            topics: scoreByTopic,
            weakAreas: weakAreas.slice(0, 5), // Top 5 weak areas
            performance: performance,
            settings: this.examState.settings
        };
    }
    
    /**
     * Calculate consistency across subjects
     * @param {Object} subjectScores - Scores by subject
     * @returns {string} - Consistency level
     */
    calculateConsistency(subjectScores) {
        const scores = Object.values(subjectScores).map(s => s.percentage);
        if (scores.length < 2) return 'unknown';
        
        const average = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((a, b) => a + Math.pow(b - average, 2), 0) / scores.length;
        const stdDev = Math.sqrt(variance);
        
        if (stdDev < 10) return 'high';
        if (stdDev < 20) return 'moderate';
        return 'low';
    }
    
    // ============================================================================
    // STATE MANAGEMENT & PERSISTENCE
    // ============================================================================
    
    /**
     * Start auto-save timer
     */
    startAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
        }
        
        this.autoSaveTimer = setInterval(() => {
            this.autoSave();
        }, EXAM_CONFIG.AUTO_SAVE_INTERVAL);
    }
    
    /**
     * Stop auto-save timer
     */
    stopAutoSave() {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
    }
    
    /**
     * Auto-save exam state
     */
    async autoSave() {
        if (!this.examState || this.isCompleted || this.isPaused) {
            return;
        }
        
        try {
            // Update time for current question
            this.updateQuestionTime();
            
            // Update exam state
            this.examState.currentQuestionIndex = this.currentQuestionIndex;
            this.examState.currentTime = Date.now();
            this.examState.autoSaveCount = (this.examState.autoSaveCount || 0) + 1;
            this.examState.lastSaveTime = new Date().toISOString();
            
            // Save to IndexedDB via db.js
            if (typeof MedicalExamDB !== 'undefined' && MedicalExamDB.saveExamResult) {
                await MedicalExamDB.saveExamResult({
                    ...this.examState,
                    isActive: !this.isCompleted
                });
            } else {
                // Fallback to localStorage
                localStorage.setItem(`exam_${this.examState.id}`, JSON.stringify(this.examState));
            }
            
            // Dispatch event
            this.dispatchEvent('autoSaved', {
                examId: this.examState.id,
                count: this.examState.autoSaveCount
            });
            
            console.log(`Auto-saved exam ${this.examState.id} (${this.examState.autoSaveCount})`);
        } catch (error) {
            console.error("Auto-save failed:", error);
        }
    }
    
    /**
     * Save exam state manually
     */
    async saveExamState() {
        if (!this.examState) return;
        
        try {
            // Update time for current question
            this.updateQuestionTime();
            
            // Update exam state
            this.examState.currentQuestionIndex = this.currentQuestionIndex;
            this.examState.currentTime = Date.now();
            this.examState.lastSaveTime = new Date().toISOString();
            
            // Save to IndexedDB via db.js
            if (typeof MedicalExamDB !== 'undefined' && MedicalExamDB.saveExamResult) {
                await MedicalExamDB.saveExamResult({
                    ...this.examState,
                    isActive: !this.isCompleted
                });
            } else {
                // Fallback to localStorage
                localStorage.setItem(`exam_${this.examState.id}`, JSON.stringify(this.examState));
            }
            
            // Dispatch event
            this.dispatchEvent('examSaved', {
                examId: this.examState.id
            });
            
            console.log(`Exam state saved: ${this.examState.id}`);
            
            return true;
        } catch (error) {
            console.error("Failed to save exam state:", error);
            throw error;
        }
    }
    
    /**
     * Load exam state from storage
     * @param {string} examId - Exam ID to load
     */
    async loadExamState(examId) {
        try {
            let savedState = null;
            
            // Try to load from IndexedDB
            if (typeof MedicalExamDB !== 'undefined' && MedicalExamDB.getExam) {
                savedState = await MedicalExamDB.getExam(examId);
            }
            
            // Fallback to localStorage
            if (!savedState) {
                const saved = localStorage.getItem(`exam_${examId}`);
                if (saved) {
                    savedState = JSON.parse(saved);
                }
            }
            
            if (!savedState) {
                throw new Error(`Exam not found: ${examId}`);
            }
            
            // Resume exam
            return await this.resumeExam(savedState);
        } catch (error) {
            console.error("Failed to load exam state:", error);
            throw error;
        }
    }
    
    /**
     * Get current exam state
     * @returns {Object} - Current exam state
     */
    getExamState() {
        if (!this.examState) return null;
        
        // Update time before returning
        this.updateQuestionTime();
        
        return {
            ...this.examState,
            currentQuestionIndex: this.currentQuestionIndex,
            isPaused: this.isPaused,
            isCompleted: this.isCompleted
        };
    }
    
    // ============================================================================
    // QUESTION PREPARATION & VALIDATION
    // ============================================================================
    
    /**
     * Validate exam settings
     * @param {Object} settings - Exam settings
     * @returns {Object} - Validated settings
     */
    validateSettings(settings) {
        const defaults = {
            mode: EXAM_CONFIG.MODES.STANDARD,
            duration: 15, // minutes
            questionCount: 25,
            subjects: [],
            topics: [],
            difficulty: 'mixed', // 'mixed', 'easy', 'medium', 'hard', 'expert'
            showExplanation: true,
            allowReview: true,
            allowFlagging: true,
            autoSubmit: false,
            randomizeQuestions: true,
            preventBackNavigation: false,
            showTimer: true,
            requireConfirmation: true
        };
        
        // Merge with defaults
        const validated = { ...defaults, ...settings };
        
        // Validate mode-specific settings
        switch(validated.mode) {
            case EXAM_CONFIG.MODES.QUICK:
                validated.questionCount = EXAM_CONFIG.EXAM_TYPES.QUICK.questions;
                validated.duration = EXAM_CONFIG.EXAM_TYPES.QUICK.time / 60; // Convert to minutes
                break;
            case EXAM_CONFIG.MODES.STANDARD:
                validated.questionCount = EXAM_CONFIG.EXAM_TYPES.STANDARD.questions;
                validated.duration = EXAM_CONFIG.EXAM_TYPES.STANDARD.time / 60;
                break;
            case EXAM_CONFIG.MODES.FULL:
                validated.questionCount = EXAM_CONFIG.EXAM_TYPES.FULL.questions;
                validated.duration = EXAM_CONFIG.EXAM_TYPES.FULL.time / 60;
                break;
        }
        
        return validated;
    }
    
    /**
     * Prepare questions for exam
     * @param {Array} questions - Raw questions
     * @param {Object} settings - Exam settings
     * @returns {Array} - Prepared questions
     */
    prepareQuestions(questions, settings) {
        let prepared = [...questions];
        
        // Apply difficulty filter if specified
        if (settings.difficulty && settings.difficulty !== 'mixed') {
            const difficultyMap = {
                'easy': 1,
                'medium': 2,
                'hard': 4,
                'expert': 5
            };
            
            const targetDifficulty = difficultyMap[settings.difficulty];
            if (targetDifficulty) {
                prepared = prepared.filter(q => q.difficulty === targetDifficulty);
            }
        }
        
        // Limit to requested count
        if (settings.questionCount && prepared.length > settings.questionCount) {
            // Randomize if requested
            if (settings.randomizeQuestions) {
                prepared = this.shuffleArray(prepared);
            }
            prepared = prepared.slice(0, settings.questionCount);
        }
        
        // Apply difficulty balancing for mixed exams
        if (settings.difficulty === 'mixed' && prepared.length > 10) {
            prepared = this.balanceDifficulty(prepared);
        }
        
        // Remove sensitive data (answers) for exam
        prepared = prepared.map(q => ({
            id: q.id,
            question: q.question,
            options: q.options,
            subject: q.subject,
            topic: q.topic,
            difficulty: q.difficulty,
            image: q.image,
            reference: q.reference,
            hints: q.hints,
            // DO NOT include correct answer or explanation
            timeAllocated: this.getTimeForQuestion(q)
        }));
        
        return prepared;
    }
    
    /**
     * Balance difficulty distribution
     * @param {Array} questions - Questions to balance
     * @returns {Array} - Balanced questions
     */
    balanceDifficulty(questions) {
        const counts = {
            1: 0, // Easy
            2: 0, // Medium
            3: 0, // Intermediate
            4: 0, // Hard
            5: 0  // Expert
        };
        
        // Count current distribution
        questions.forEach(q => {
            const diff = q.difficulty || 3;
            if (counts[diff] !== undefined) {
                counts[diff]++;
            }
        });
        
        // Calculate target distribution
        const total = questions.length;
        const targets = {
            1: Math.floor(total * EXAM_CONFIG.DIFFICULTY_DISTRIBUTION.EASY),
            2: Math.floor(total * EXAM_CONFIG.DIFFICULTY_DISTRIBUTION.MEDIUM),
            3: Math.floor(total * EXAM_CONFIG.DIFFICULTY_DISTRIBUTION.INTERMEDIATE),
            4: Math.floor(total * EXAM_CONFIG.DIFFICULTY_DISTRIBUTION.HARD),
            5: Math.floor(total * EXAM_CONFIG.DIFFICULTY_DISTRIBUTION.EXPERT)
        };
        
        // Adjust to ensure total matches
        let remaining = total - Object.values(targets).reduce((a, b) => a + b, 0);
        for (let i = 1; i <= 5 && remaining > 0; i++) {
            targets[i]++;
            remaining--;
        }
        
        // Sort questions by difficulty
        const byDifficulty = { 1: [], 2: [], 3: [], 4: [], 5: [] };
        questions.forEach(q => {
            const diff = q.difficulty || 3;
            if (byDifficulty[diff]) {
                byDifficulty[diff].push(q);
            }
        });
        
        // Shuffle each difficulty group
        Object.keys(byDifficulty).forEach(diff => {
            byDifficulty[diff] = this.shuffleArray(byDifficulty[diff]);
        });
        
        // Select balanced questions
        const balanced = [];
        for (let diff = 1; diff <= 5; diff++) {
            const needed = Math.min(targets[diff], byDifficulty[diff].length);
            balanced.push(...byDifficulty[diff].slice(0, needed));
        }
        
        // If we don't have enough questions, add more from any difficulty
        if (balanced.length < total) {
            const allRemaining = [];
            for (let diff = 1; diff <= 5; diff++) {
                allRemaining.push(...byDifficulty[diff].slice(targets[diff]));
            }
            
            // Shuffle remaining and add
            allRemaining.sort(() => Math.random() - 0.5);
            balanced.push(...allRemaining.slice(0, total - balanced.length));
        }
        
        // Final shuffle
        return this.shuffleArray(balanced);
    }
    
    /**
     * Validate answer format
     * @param {string} answer - Selected answer
     * @param {Array} options - Available options
     * @returns {boolean} - True if valid
     */
    validateAnswerFormat(answer, options) {
        if (!answer) return true; // Empty answer is valid (unanswered)
        
        // Extract option letters (A, B, C, etc.)
        const optionLetters = options.map(opt => {
            const match = opt.match(/^([A-E])\./);
            return match ? match[1] : null;
        }).filter(letter => letter !== null);
        
        // Check if answer matches one of the option letters
        return optionLetters.includes(answer.toUpperCase());
    }
    
    // ============================================================================
    // UTILITY FUNCTIONS
    // ============================================================================
    
    /**
     * Shuffle array (Fisher-Yates algorithm)
     * @param {Array} array - Array to shuffle
     * @returns {Array} - Shuffled array
     */
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
    
    /**
     * Format time in MM:SS
     * @param {number} seconds - Time in seconds
     * @returns {string} - Formatted time
     */
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    
    /**
     * Get time color based on percentage
     * @param {number} percentage - Time percentage used (0-100)
     * @returns {string} - Color class
     */
    getTimeColor(percentage) {
        if (percentage < 30) return 'green';
        if (percentage < 70) return 'yellow';
        if (percentage < 95) return 'red';
        return 'flashing-red';
    }
    
    // ============================================================================
    // EVENT HANDLING
    // ============================================================================
    
    /**
     * Add event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    addEventListener(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }
    
    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    removeEventListener(event, callback) {
        if (!this.eventListeners[event]) return;
        
        const index = this.eventListeners[event].indexOf(callback);
        if (index > -1) {
            this.eventListeners[event].splice(index, 1);
        }
    }
    
    /**
     * Dispatch event to listeners
     * @param {string} event - Event name
     * @param {Object} data - Event data
     */
    dispatchEvent(event, data = {}) {
        if (!this.eventListeners[event]) return;
        
        // Add engine reference to data
        const eventData = {
            ...data,
            engine: this
        };
        
        this.eventListeners[event].forEach(callback => {
            try {
                callback(eventData);
            } catch (error) {
                console.error(`Error in event listener for ${event}:`, error);
            }
        });
    }
    
    // ============================================================================
    // DESTRUCTOR
    // ============================================================================
    
    /**
     * Clean up resources
     */
    destroy() {
        this.stopAutoSave();
        this.eventListeners = {};
        this.examState = null;
        console.log("Exam Engine destroyed");
    }
}

// ============================================================================
// GLOBAL INSTANCE & EXPORTS
// ============================================================================

// Create global instance
const ExamEngineInstance = new ExamEngine();

// Make it available globally
window.ExamEngine = ExamEngineInstance;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExamEngineInstance;
}

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    console.log('Exam Engine module loaded and ready');
    
    // Dispatch ready event
    const event = new CustomEvent('examEngineReady', {
        detail: { engine: ExamEngineInstance }
    });
    document.dispatchEvent(event);
});

// ============================================================================
// DEBUG & TESTING
// ============================================================================

// Debug functions for development
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    window.debugExamEngine = function() {
        console.group("Exam Engine Debug");
        console.log("State:", ExamEngineInstance.examState);
        console.log("Current Index:", ExamEngineInstance.currentQuestionIndex);
        console.log("Is Paused:", ExamEngineInstance.isPaused);
        console.log("Is Completed:", ExamEngineInstance.isCompleted);
        console.log("Progress:", ExamEngineInstance.getProgress());
        console.groupEnd();
    };
    
    window.testExamEngine = async function(questionCount = 10) {
        // Generate test questions
        const testQuestions = [];
        for (let i = 1; i <= questionCount; i++) {
            testQuestions.push({
                id: `test_${i}`,
                question: `Test Question ${i}: What is the correct answer?`,
                options: [
                    "A. Option A",
                    "B. Option B", 
                    "C. Option C",
                    "D. Option D"
                ],
                correct: i % 4 === 0 ? "D" : i % 3 === 0 ? "C" : i % 2 === 0 ? "B" : "A",
                subject: "Test",
                topic: "General",
                difficulty: (i % 5) + 1
            });
        }
        
        const settings = {
            mode: EXAM_CONFIG.MODES.PRACTICE,
            questionCount: questionCount,
            subjects: ["Test"],
            topics: ["General"],
            difficulty: "mixed"
        };
        
        try {
            console.log(`Starting test exam with ${questionCount} questions...`);
            const result = await ExamEngineInstance.startExam(settings, testQuestions);
            console.log("Test exam started:", result);
            return result;
        } catch (error) {
            console.error("Test exam failed:", error);
        }
    };
}

console.log("exam-engine.js loaded successfully - Medical Exam Room Pro Exam Engine");
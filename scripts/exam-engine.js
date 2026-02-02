// scripts/exam-engine.js

/**
 * Exam Engine for Medical Exam Room Pro
 * Core exam logic with adaptive timing, difficulty balancing, and intelligent question selection
 * 
 * Features implemented:
 * - Question randomization algorithm
 * - Adaptive timing (21-54 seconds based on difficulty)
 * - Difficulty balancing
 * - Question flagging
 * - Navigation between questions
 * - Auto-save every 30 seconds
 * - Pause/resume functionality
 * - Exam state persistence
 */

class ExamEngine {
    constructor() {
        // Exam configuration
        this.config = {
            examId: null,
            subjects: [],
            topics: [],
            questionCount: 25,
            examMode: 'timed', // 'timed', 'practice', 'review'
            difficulty: 'mixed', // 'mixed', 'easy', 'medium', 'hard', 'expert'
            timerMode: 'adaptive', // 'adaptive', 'strict', 'relaxed', 'untimed'
            questionOrder: 'random' // 'random', 'sequential', 'difficulty'
        };
        
        // Exam state
        this.state = {
            status: 'idle', // 'idle', 'loading', 'active', 'paused', 'completed', 'submitted'
            currentQuestion: 1,
            questions: [],
            answers: {},
            flags: {},
            timestamps: {},
            timeSpent: {},
            startTime: null,
            endTime: null,
            totalTime: 0,
            autoSaveInterval: null,
            lastSave: null
        };
        
        // Timing configuration
        this.timing = {
            easy: 21,    // seconds
            medium: 30,  // seconds
            hard: 42,    // seconds
            expert: 54   // seconds
        };
        
        // Difficulty distribution (for mixed difficulty)
        this.difficultyDistribution = {
            easy: 0.2,    // 20%
            medium: 0.3,  // 30%
            hard: 0.3,    // 30%
            expert: 0.2   // 20%
        };
        
        // References to other modules
        this.questions = null;
        this.timer = null;
        this.db = null;
        
        // Initialize
        this.init();
    }
    
    /**
     * Initialize exam engine
     */
    init() {
        // Get references to other modules
        if (typeof questions !== 'undefined') {
            this.questions = questions;
        }
        
        if (typeof db !== 'undefined') {
            this.db = db;
        }
        
        // Load saved state if available
        this.loadSavedState();
        
        // Setup auto-save
        this.setupAutoSave();
        
        console.log('Exam engine initialized');
    }
    
    /**
     * Setup exam configuration
     */
    setupExam(config) {
        this.config = {
            ...this.config,
            ...config
        };
        
        // Generate unique exam ID if not provided
        if (!this.config.examId) {
            this.config.examId = 'exam_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
        
        // Set initial state
        this.state = {
            status: 'loading',
            currentQuestion: 1,
            questions: [],
            answers: {},
            flags: {},
            timestamps: {},
            timeSpent: {},
            startTime: null,
            endTime: null,
            totalTime: 0,
            autoSaveInterval: null,
            lastSave: null
        };
        
        console.log('Exam setup completed:', this.config);
    }
    
    /**
     * Start exam
     */
    async startExam() {
        if (this.state.status !== 'loading') {
            throw new Error('Exam not properly configured');
        }
        
        try {
            // Load questions
            await this.loadQuestions();
            
            // Initialize exam state
            this.state.startTime = new Date().toISOString();
            this.state.status = 'active';
            
            // Record start timestamp for first question
            this.state.timestamps[1] = Date.now();
            
            // Start auto-save
            this.startAutoSave();
            
            // Log exam start
            await this.logExamEvent('exam_started', {
                config: this.config,
                startTime: this.state.startTime
            });
            
            console.log('Exam started:', this.config.examId);
            
            // Return first question
            return this.getCurrentQuestion();
            
        } catch (error) {
            console.error('Error starting exam:', error);
            this.state.status = 'idle';
            throw error;
        }
    }
    
    /**
     * Load questions for exam
     */
    async loadQuestions() {
        if (!this.questions) {
            throw new Error('Question bank not available');
        }
        
        // Get exam configuration
        const examConfig = {
            subjects: this.config.subjects,
            topics: this.config.topics,
            questionCount: this.config.questionCount,
            difficulty: this.config.difficulty,
            randomize: this.config.questionOrder === 'random'
        };
        
        // Get questions from question bank
        const loadedQuestions = await this.questions.getExamQuestions(examConfig);
        
        if (!loadedQuestions || loadedQuestions.length === 0) {
            throw new Error('No questions available for the selected criteria');
        }
        
        // Apply question ordering
        this.state.questions = this.applyQuestionOrdering(loadedQuestions);
        
        console.log(`Loaded ${this.state.questions.length} questions for exam`);
    }
    
    /**
     * Apply question ordering
     */
    applyQuestionOrdering(questions) {
        switch (this.config.questionOrder) {
            case 'sequential':
                // Sort by question number (if available) or keep as is
                return questions.sort((a, b) => (a.questionNumber || 0) - (b.questionNumber || 0));
                
            case 'difficulty':
                // Sort by difficulty level (easiest first)
                return questions.sort((a, b) => (a.difficultyLevel || 2) - (b.difficultyLevel || 2));
                
            case 'random':
            default:
                // Random shuffle
                return this.shuffleArray(questions);
        }
    }
    
    /**
     * Get current question
     */
    getCurrentQuestion() {
        if (this.state.questions.length === 0) {
            return null;
        }
        
        const questionIndex = this.state.currentQuestion - 1;
        if (questionIndex >= this.state.questions.length) {
            return null;
        }
        
        const question = this.state.questions[questionIndex];
        
        // Add exam-specific data
        return {
            ...question,
            examQuestionNumber: this.state.currentQuestion,
            totalQuestions: this.state.questions.length,
            userAnswer: this.state.answers[this.state.currentQuestion],
            flagged: this.state.flags[this.state.currentQuestion] || false,
            timeSpent: this.state.timeSpent[this.state.currentQuestion] || 0
        };
    }
    
    /**
     * Get question by number
     */
    getQuestion(questionNumber) {
        const questionIndex = questionNumber - 1;
        if (questionIndex < 0 || questionIndex >= this.state.questions.length) {
            return null;
        }
        
        const question = this.state.questions[questionIndex];
        
        return {
            ...question,
            examQuestionNumber: questionNumber,
            totalQuestions: this.state.questions.length,
            userAnswer: this.state.answers[questionNumber],
            flagged: this.state.flags[questionNumber] || false,
            timeSpent: this.state.timeSpent[questionNumber] || 0
        };
    }
    
    /**
     * Navigate to question
     */
    navigateToQuestion(questionNumber) {
        if (questionNumber < 1 || questionNumber > this.state.questions.length) {
            throw new Error(`Invalid question number: ${questionNumber}`);
        }
        
        // Record time spent on current question
        if (this.state.status === 'active' && this.state.currentQuestion !== questionNumber) {
            this.recordTimeSpent(this.state.currentQuestion);
        }
        
        // Update current question
        const previousQuestion = this.state.currentQuestion;
        this.state.currentQuestion = questionNumber;
        
        // Record timestamp for new question
        if (!this.state.timestamps[questionNumber]) {
            this.state.timestamps[questionNumber] = Date.now();
        }
        
        // Log navigation
        this.logExamEvent('question_navigated', {
            from: previousQuestion,
            to: questionNumber,
            timestamp: Date.now()
        });
        
        return this.getCurrentQuestion();
    }
    
    /**
     * Navigate to next question
     */
    nextQuestion() {
        const nextQuestion = this.state.currentQuestion + 1;
        if (nextQuestion > this.state.questions.length) {
            return null;
        }
        
        return this.navigateToQuestion(nextQuestion);
    }
    
    /**
     * Navigate to previous question
     */
    previousQuestion() {
        const prevQuestion = this.state.currentQuestion - 1;
        if (prevQuestion < 1) {
            return null;
        }
        
        return this.navigateToQuestion(prevQuestion);
    }
    
    /**
     * Answer current question
     */
    answerQuestion(answer) {
        if (this.state.status !== 'active' && this.state.status !== 'paused') {
            throw new Error('Exam is not active');
        }
        
        const questionNumber = this.state.currentQuestion;
        
        // Record answer
        this.state.answers[questionNumber] = answer;
        
        // Record time spent
        this.recordTimeSpent(questionNumber);
        
        // Log answer
        this.logExamEvent('question_answered', {
            questionNumber: questionNumber,
            answer: answer,
            timestamp: Date.now(),
            timeSpent: this.state.timeSpent[questionNumber] || 0
        });
        
        // Auto-advance if configured
        if (this.config.autoAdvance) {
            setTimeout(() => this.nextQuestion(), 500);
        }
        
        return this.getCurrentQuestion();
    }
    
    /**
     * Flag current question
     */
    flagQuestion(flagged = true) {
        if (this.state.status !== 'active' && this.state.status !== 'paused') {
            throw new Error('Exam is not active');
        }
        
        const questionNumber = this.state.currentQuestion;
        this.state.flags[questionNumber] = flagged;
        
        // Log flag
        this.logExamEvent('question_flagged', {
            questionNumber: questionNumber,
            flagged: flagged,
            timestamp: Date.now()
        });
        
        return this.getCurrentQuestion();
    }
    
    /**
     * Toggle flag for current question
     */
    toggleFlag() {
        const currentFlag = this.state.flags[this.state.currentQuestion] || false;
        return this.flagQuestion(!currentFlag);
    }
    
    /**
     * Record time spent on question
     */
    recordTimeSpent(questionNumber) {
        if (!this.state.timestamps[questionNumber]) {
            return 0;
        }
        
        const startTime = this.state.timestamps[questionNumber];
        const endTime = Date.now();
        const timeSpent = Math.floor((endTime - startTime) / 1000); // Convert to seconds
        
        // Update time spent
        this.state.timeSpent[questionNumber] = timeSpent;
        
        // Clear timestamp
        delete this.state.timestamps[questionNumber];
        
        return timeSpent;
    }
    
    /**
     * Get time limit for current question
     */
    getTimeLimit() {
        if (this.config.timerMode === 'untimed') {
            return null; // No time limit
        }
        
        const question = this.getCurrentQuestion();
        if (!question) {
            return this.timing.medium;
        }
        
        // Get difficulty-based timing
        let timeLimit;
        switch (question.difficulty) {
            case 'Easy':
                timeLimit = this.timing.easy;
                break;
            case 'Medium':
                timeLimit = this.timing.medium;
                break;
            case 'Hard':
                timeLimit = this.timing.hard;
                break;
            case 'Expert':
                timeLimit = this.timing.expert;
                break;
            default:
                timeLimit = this.timing.medium;
        }
        
        // Adjust for timer mode
        switch (this.config.timerMode) {
            case 'strict':
                return 30; // Fixed 30 seconds
            case 'relaxed':
                return 60; // Fixed 60 seconds
            case 'adaptive':
            default:
                return timeLimit;
        }
    }
    
    /**
     * Get time spent on current question
     */
    getTimeSpent() {
        const questionNumber = this.state.currentQuestion;
        
        if (this.state.timeSpent[questionNumber]) {
            return this.state.timeSpent[questionNumber];
        }
        
        if (this.state.timestamps[questionNumber]) {
            const startTime = this.state.timestamps[questionNumber];
            const currentTime = Date.now();
            return Math.floor((currentTime - startTime) / 1000);
        }
        
        return 0;
    }
    
    /**
     * Get time remaining for current question
     */
    getTimeRemaining() {
        const timeLimit = this.getTimeLimit();
        if (timeLimit === null) {
            return null; // Untimed
        }
        
        const timeSpent = this.getTimeSpent();
        const timeRemaining = Math.max(0, timeLimit - timeSpent);
        
        return timeRemaining;
    }
    
    /**
     * Check if time is running out (for color warnings)
     */
    getTimeWarningLevel() {
        const timeRemaining = this.getTimeRemaining();
        if (timeRemaining === null) {
            return 'normal'; // Untimed
        }
        
        const timeLimit = this.getTimeLimit();
        const percentage = timeRemaining / timeLimit;
        
        if (percentage > 0.7) {
            return 'normal'; // Green: >70% remaining
        } else if (percentage > 0.3) {
            return 'warning'; // Yellow: 30-70% remaining
        } else if (percentage > 0.1) {
            return 'danger'; // Red: 10-30% remaining
        } else {
            return 'critical'; // Flashing red: <10% remaining
        }
    }
    
    /**
     * Pause exam
     */
    pauseExam() {
        if (this.state.status !== 'active') {
            throw new Error('Exam is not active');
        }
        
        // Record time spent on current question
        this.recordTimeSpent(this.state.currentQuestion);
        
        // Update status
        this.state.status = 'paused';
        
        // Stop auto-save temporarily
        this.stopAutoSave();
        
        // Log pause
        this.logExamEvent('exam_paused', {
            timestamp: Date.now(),
            currentQuestion: this.state.currentQuestion
        });
        
        console.log('Exam paused');
    }
    
    /**
     * Resume exam
     */
    resumeExam() {
        if (this.state.status !== 'paused') {
            throw new Error('Exam is not paused');
        }
        
        // Update status
        this.state.status = 'active';
        
        // Record timestamp for current question
        this.state.timestamps[this.state.currentQuestion] = Date.now();
        
        // Restart auto-save
        this.startAutoSave();
        
        // Log resume
        this.logExamEvent('exam_resumed', {
            timestamp: Date.now(),
            currentQuestion: this.state.currentQuestion
        });
        
        console.log('Exam resumed');
        
        return this.getCurrentQuestion();
    }
    
    /**
     * Submit exam
     */
    async submitExam() {
        if (this.state.status !== 'active' && this.state.status !== 'paused') {
            throw new Error('Exam is not active');
        }
        
        try {
            // Record final time spent
            this.recordTimeSpent(this.state.currentQuestion);
            
            // Update status
            this.state.status = 'submitted';
            this.state.endTime = new Date().toISOString();
            
            // Stop auto-save
            this.stopAutoSave();
            
            // Calculate results
            const results = await this.calculateResults();
            
            // Save exam results
            await this.saveExamResults(results);
            
            // Log submission
            await this.logExamEvent('exam_submitted', {
                timestamp: Date.now(),
                results: results
            });
            
            console.log('Exam submitted:', results);
            
            return results;
            
        } catch (error) {
            console.error('Error submitting exam:', error);
            this.state.status = 'active';
            throw error;
        }
    }
    
    /**
     * Calculate exam results
     */
    async calculateResults() {
        const totalQuestions = this.state.questions.length;
        let correctAnswers = 0;
        let totalTime = 0;
        const detailedResults = [];
        
        // Calculate score and gather detailed results
        for (let i = 0; i < totalQuestions; i++) {
            const questionNumber = i + 1;
            const question = this.state.questions[i];
            const userAnswer = this.state.answers[questionNumber];
            const timeSpent = this.state.timeSpent[questionNumber] || 0;
            const isCorrect = userAnswer === question.correct;
            
            if (isCorrect) {
                correctAnswers++;
            }
            
            totalTime += timeSpent;
            
            detailedResults.push({
                questionNumber: questionNumber,
                questionId: question.id,
                question: question.question,
                options: question.options,
                userAnswer: userAnswer,
                correctAnswer: question.correct,
                isCorrect: isCorrect,
                timeSpent: timeSpent,
                subject: question.subject,
                topic: question.topic,
                difficulty: question.difficulty,
                flagged: this.state.flags[questionNumber] || false,
                explanation: question.explanation,
                reference: question.reference
            });
        }
        
        // Calculate score
        const score = Math.round((correctAnswers / totalQuestions) * 100);
        
        // Calculate average time per question
        const averageTime = totalQuestions > 0 ? Math.round(totalTime / totalQuestions) : 0;
        
        // Identify weak areas
        const weakAreas = this.identifyWeakAreas(detailedResults);
        
        // Prepare results
        const results = {
            examId: this.config.examId,
            config: this.config,
            score: score,
            correctAnswers: correctAnswers,
            totalQuestions: totalQuestions,
            totalTime: totalTime,
            averageTime: averageTime,
            startTime: this.state.startTime,
            endTime: this.state.endTime,
            answers: this.state.answers,
            flags: this.state.flags,
            timeSpent: this.state.timeSpent,
            detailedResults: detailedResults,
            weakAreas: weakAreas,
            performanceBySubject: this.calculatePerformanceBySubject(detailedResults),
            performanceByTopic: this.calculatePerformanceByTopic(detailedResults),
            performanceByDifficulty: this.calculatePerformanceByDifficulty(detailedResults)
        };
        
        return results;
    }
    
    /**
     * Identify weak areas
     */
    identifyWeakAreas(detailedResults) {
        const topicPerformance = {};
        
        // Group by topic and calculate performance
        detailedResults.forEach(result => {
            const key = `${result.subject}:${result.topic}`;
            if (!topicPerformance[key]) {
                topicPerformance[key] = {
                    subject: result.subject,
                    topic: result.topic,
                    total: 0,
                    correct: 0
                };
            }
            
            topicPerformance[key].total++;
            if (result.isCorrect) {
                topicPerformance[key].correct++;
            }
        });
        
        // Calculate error rates and identify weak areas
        const weakAreas = [];
        Object.values(topicPerformance).forEach(performance => {
            if (performance.total >= 3) { // Only consider with enough questions
                const accuracy = performance.correct / performance.total;
                if (accuracy < 0.6) { // Less than 60% accuracy
                    weakAreas.push({
                        subject: performance.subject,
                        topic: performance.topic,
                        accuracy: Math.round(accuracy * 100),
                        totalQuestions: performance.total,
                        correct: performance.correct,
                        incorrect: performance.total - performance.correct
                    });
                }
            }
        });
        
        // Sort by accuracy (lowest first)
        weakAreas.sort((a, b) => a.accuracy - b.accuracy);
        
        return weakAreas;
    }
    
    /**
     * Calculate performance by subject
     */
    calculatePerformanceBySubject(detailedResults) {
        const subjectPerformance = {};
        
        detailedResults.forEach(result => {
            if (!subjectPerformance[result.subject]) {
                subjectPerformance[result.subject] = {
                    total: 0,
                    correct: 0,
                    timeSpent: 0
                };
            }
            
            subjectPerformance[result.subject].total++;
            if (result.isCorrect) {
                subjectPerformance[result.subject].correct++;
            }
            subjectPerformance[result.subject].timeSpent += result.timeSpent;
        });
        
        // Calculate percentages and averages
        Object.keys(subjectPerformance).forEach(subject => {
            const perf = subjectPerformance[subject];
            perf.accuracy = Math.round((perf.correct / perf.total) * 100);
            perf.averageTime = Math.round(perf.timeSpent / perf.total);
        });
        
        return subjectPerformance;
    }
    
    /**
     * Calculate performance by topic
     */
    calculatePerformanceByTopic(detailedResults) {
        const topicPerformance = {};
        
        detailedResults.forEach(result => {
            const key = `${result.subject}:${result.topic}`;
            if (!topicPerformance[key]) {
                topicPerformance[key] = {
                    subject: result.subject,
                    topic: result.topic,
                    total: 0,
                    correct: 0,
                    timeSpent: 0
                };
            }
            
            topicPerformance[key].total++;
            if (result.isCorrect) {
                topicPerformance[key].correct++;
            }
            topicPerformance[key].timeSpent += result.timeSpent;
        });
        
        // Calculate percentages and averages
        Object.keys(topicPerformance).forEach(key => {
            const perf = topicPerformance[key];
            perf.accuracy = Math.round((perf.correct / perf.total) * 100);
            perf.averageTime = Math.round(perf.timeSpent / perf.total);
        });
        
        return topicPerformance;
    }
    
    /**
     * Calculate performance by difficulty
     */
    calculatePerformanceByDifficulty(detailedResults) {
        const difficultyPerformance = {
            Easy: { total: 0, correct: 0, timeSpent: 0 },
            Medium: { total: 0, correct: 0, timeSpent: 0 },
            Hard: { total: 0, correct: 0, timeSpent: 0 },
            Expert: { total: 0, correct: 0, timeSpent: 0 }
        };
        
        detailedResults.forEach(result => {
            const difficulty = result.difficulty || 'Medium';
            if (difficultyPerformance[difficulty]) {
                difficultyPerformance[difficulty].total++;
                if (result.isCorrect) {
                    difficultyPerformance[difficulty].correct++;
                }
                difficultyPerformance[difficulty].timeSpent += result.timeSpent;
            }
        });
        
        // Calculate percentages and averages
        Object.keys(difficultyPerformance).forEach(difficulty => {
            const perf = difficultyPerformance[difficulty];
            if (perf.total > 0) {
                perf.accuracy = Math.round((perf.correct / perf.total) * 100);
                perf.averageTime = Math.round(perf.timeSpent / perf.total);
            }
        });
        
        return difficultyPerformance;
    }
    
    /**
     * Save exam results
     */
    async saveExamResults(results) {
        // Save to IndexedDB
        if (this.db && this.db.saveExamResults) {
            try {
                await this.db.saveExamResults(results);
                console.log('Exam results saved to database');
            } catch (error) {
                console.error('Error saving to database:', error);
            }
        }
        
        // Save to localStorage as backup
        try {
            localStorage.setItem(`exam_results_${this.config.examId}`, JSON.stringify(results));
            localStorage.setItem('last_exam_results', JSON.stringify(results));
            localStorage.setItem('last_exam_id', this.config.examId);
            console.log('Exam results saved to localStorage');
        } catch (error) {
            console.error('Error saving to localStorage:', error);
        }
        
        // Update user progress in question bank
        if (this.questions) {
            try {
                results.detailedResults.forEach(result => {
                    if (result.questionId) {
                        this.questions.markQuestionReviewed(result.questionId, result.isCorrect);
                    }
                });
                console.log('User progress updated');
            } catch (error) {
                console.error('Error updating user progress:', error);
            }
        }
    }
    
    /**
     * Setup auto-save
     */
    setupAutoSave() {
        // Clear any existing interval
        if (this.state.autoSaveInterval) {
            clearInterval(this.state.autoSaveInterval);
            this.state.autoSaveInterval = null;
        }
    }
    
    /**
     * Start auto-save
     */
    startAutoSave() {
        this.setupAutoSave();
        
        // Save every 30 seconds
        this.state.autoSaveInterval = setInterval(() => {
            this.saveExamState();
        }, 30000); // 30 seconds
        
        console.log('Auto-save started');
    }
    
    /**
     * Stop auto-save
     */
    stopAutoSave() {
        if (this.state.autoSaveInterval) {
            clearInterval(this.state.autoSaveInterval);
            this.state.autoSaveInterval = null;
            console.log('Auto-save stopped');
        }
    }
    
    /**
     * Save exam state
     */
    async saveExamState() {
        if (this.state.status !== 'active' && this.state.status !== 'paused') {
            return;
        }
        
        try {
            // Record time spent on current question
            this.recordTimeSpent(this.state.currentQuestion);
            
            // Prepare state for saving
            const saveState = {
                config: this.config,
                state: {
                    ...this.state,
                    autoSaveInterval: null // Don't save interval
                },
                timestamp: Date.now()
            };
            
            // Save to localStorage
            localStorage.setItem('exam_state_autosave', JSON.stringify(saveState));
            this.state.lastSave = new Date().toISOString();
            
            // Log save
            this.logExamEvent('autosave', {
                timestamp: Date.now(),
                currentQuestion: this.state.currentQuestion
            });
            
        } catch (error) {
            console.error('Error auto-saving exam state:', error);
        }
    }
    
    /**
     * Load saved state
     */
    loadSavedState() {
        try {
            const savedState = localStorage.getItem('exam_state_autosave');
            if (savedState) {
                const parsed = JSON.parse(savedState);
                
                // Check if state is recent (less than 1 hour old)
                const oneHourAgo = Date.now() - (60 * 60 * 1000);
                if (parsed.timestamp && parsed.timestamp > oneHourAgo) {
                    this.config = parsed.config || this.config;
                    this.state = {
                        ...parsed.state,
                        autoSaveInterval: null,
                        status: 'paused' // Set to paused so user can resume
                    };
                    
                    console.log('Loaded saved exam state');
                    return true;
                } else {
                    // Clear old state
                    localStorage.removeItem('exam_state_autosave');
                }
            }
        } catch (error) {
            console.error('Error loading saved state:', error);
        }
        
        return false;
    }
    
    /**
     * Clear saved state
     */
    clearSavedState() {
        try {
            localStorage.removeItem('exam_state_autosave');
            console.log('Cleared saved exam state');
        } catch (error) {
            console.error('Error clearing saved state:', error);
        }
    }
    
    /**
     * Log exam event
     */
    async logExamEvent(eventType, data = {}) {
        const event = {
            type: eventType,
            examId: this.config.examId,
            timestamp: Date.now(),
            data: data
        };
        
        // Save to IndexedDB if available
        if (this.db && this.db.logSecurityEvent) {
            try {
                await this.db.logSecurityEvent({
                    ...event,
                    eventType: `exam_${eventType}`,
                    userId: localStorage.getItem('userId') || 'anonymous'
                });
            } catch (error) {
                console.error('Error logging event to database:', error);
            }
        }
        
        // Also save to localStorage for debugging
        try {
            const examLogs = JSON.parse(localStorage.getItem('exam_logs') || '[]');
            examLogs.push(event);
            if (examLogs.length > 1000) {
                examLogs.splice(0, 500); // Keep only last 500 events
            }
            localStorage.setItem('exam_logs', JSON.stringify(examLogs));
        } catch (error) {
            console.error('Error logging event to localStorage:', error);
        }
        
        return event;
    }
    
    /**
     * Get exam summary
     */
    getExamSummary() {
        const answered = Object.keys(this.state.answers).length;
        const flagged = Object.values(this.state.flags).filter(f => f).length;
        const total = this.state.questions.length;
        
        return {
            examId: this.config.examId,
            status: this.state.status,
            currentQuestion: this.state.currentQuestion,
            totalQuestions: total,
            answered: answered,
            unanswered: total - answered,
            flagged: flagged,
            progress: Math.round((answered / total) * 100),
            startTime: this.state.startTime,
            elapsedTime: this.state.startTime ? 
                Math.floor((Date.now() - new Date(this.state.startTime).getTime()) / 1000) : 0
        };
    }
    
    /**
     * Get all questions with status
     */
    getAllQuestionsStatus() {
        return this.state.questions.map((question, index) => {
            const questionNumber = index + 1;
            return {
                questionNumber: questionNumber,
                subject: question.subject,
                topic: question.topic,
                difficulty: question.difficulty,
                answered: this.state.answers[questionNumber] !== undefined,
                flagged: this.state.flags[questionNumber] || false,
                current: questionNumber === this.state.currentQuestion
            };
        });
    }
    
    /**
     * Get unanswered questions
     */
    getUnansweredQuestions() {
        const unanswered = [];
        for (let i = 0; i < this.state.questions.length; i++) {
            const questionNumber = i + 1;
            if (this.state.answers[questionNumber] === undefined) {
                unanswered.push(questionNumber);
            }
        }
        return unanswered;
    }
    
    /**
     * Get flagged questions
     */
    getFlaggedQuestions() {
        const flagged = [];
        for (let i = 0; i < this.state.questions.length; i++) {
            const questionNumber = i + 1;
            if (this.state.flags[questionNumber]) {
                flagged.push(questionNumber);
            }
        }
        return flagged;
    }
    
    /**
     * Reset exam
     */
    resetExam() {
        this.stopAutoSave();
        this.clearSavedState();
        
        this.config = {
            examId: null,
            subjects: [],
            topics: [],
            questionCount: 25,
            examMode: 'timed',
            difficulty: 'mixed',
            timerMode: 'adaptive',
            questionOrder: 'random'
        };
        
        this.state = {
            status: 'idle',
            currentQuestion: 1,
            questions: [],
            answers: {},
            flags: {},
            timestamps: {},
            timeSpent: {},
            startTime: null,
            endTime: null,
            totalTime: 0,
            autoSaveInterval: null,
            lastSave: null
        };
        
        console.log('Exam engine reset');
    }
    
    /**
     * Shuffle array (Fisher-Yates algorithm)
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
     * Get exam configuration
     */
    getConfig() {
        return { ...this.config };
    }
    
    /**
     * Get exam state
     */
    getState() {
        return { ...this.state };
    }
    
    /**
     * Check if exam is active
     */
    isActive() {
        return this.state.status === 'active';
    }
    
    /**
     * Check if exam is paused
     */
    isPaused() {
        return this.state.status === 'paused';
    }
    
    /**
     * Check if exam is completed
     */
    isCompleted() {
        return this.state.status === 'submitted' || this.state.status === 'completed';
    }
    
    /**
     * Get remaining time for entire exam
     */
    getTotalTimeRemaining() {
        if (!this.state.startTime || this.config.timerMode === 'untimed') {
            return null;
        }
        
        // Calculate total time limit based on average question time
        const averageTime = this.timing.medium; // Use medium as baseline
        const totalTimeLimit = this.state.questions.length * averageTime;
        
        // Calculate elapsed time
        const elapsed = Math.floor((Date.now() - new Date(this.state.startTime).getTime()) / 1000);
        const remaining = Math.max(0, totalTimeLimit - elapsed);
        
        return remaining;
    }
}

// Create global instance
const examEngine = new ExamEngine();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = examEngine;
}
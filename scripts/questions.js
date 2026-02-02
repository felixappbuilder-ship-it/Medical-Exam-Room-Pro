// scripts/questions.js

/**
 * Question Bank Manager for Medical Exam Room Pro
 * Handles loading, caching, and managing the 5,000+ question bank
 * 
 * Features implemented:
 * - Load question bank JSON
 * - Parse questions on-the-fly
 * - Filter by subject/topic/difficulty
 * - Search functionality
 * - Question statistics tracking
 * - Mark questions as reviewed/flagged
 * - Personal notes attachment
 * - Image/diagram lazy loading
 */

class QuestionBankManager {
    constructor() {
        this.questionBank = {
            Anatomy: [],
            Physiology: [],
            Biochemistry: [],
            Histology: [],
            Embryology: [],
            Pathology: [],
            Pharmacology: [],
            Microbiology: []
        };
        
        this.subjects = [
            { id: 'anatomy', name: 'Anatomy', icon: '🦴', color: '#2196F3', questions: 720 },
            { id: 'physiology', name: 'Physiology', icon: '❤️', color: '#F44336', questions: 1150 },
            { id: 'biochemistry', name: 'Biochemistry', icon: '🧪', color: '#4CAF50', questions: 810 },
            { id: 'histology', name: 'Histology', icon: '🔬', color: '#FF9800', questions: 450 },
            { id: 'embryology', name: 'Embryology', icon: '👶', color: '#9C27B0', questions: 390 },
            { id: 'pathology', name: 'Pathology', icon: '🩺', color: '#3F51B5', questions: 540 },
            { id: 'pharmacology', name: 'Pharmacology', icon: '💊', color: '#009688', questions: 460 },
            { id: 'microbiology', name: 'Microbiology', icon: '🦠', color: '#FF5722', questions: 430 }
        ];
        
        this.loaded = false;
        this.loading = false;
        this.stats = {};
        this.userProgress = {};
        this.questionCache = new Map();
        
        // Initialize
        this.init();
    }
    
    /**
     * Initialize question bank manager
     */
    async init() {
        await this.loadUserProgress();
        await this.calculateStats();
    }
    
    /**
     * Get all subjects
     */
    getSubjects() {
        return this.subjects;
    }
    
    /**
     * Get subject by ID
     */
    getSubject(subjectId) {
        return this.subjects.find(s => s.id === subjectId);
    }
    
    /**
     * Load question bank from JSON files
     */
    async loadQuestionBank() {
        if (this.loaded) {
            return this.questionBank;
        }
        
        if (this.loading) {
            // Wait for ongoing load
            return new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (this.loaded) {
                        clearInterval(checkInterval);
                        resolve(this.questionBank);
                    }
                }, 100);
            });
        }
        
        this.loading = true;
        console.log('Loading question bank...');
        
        try {
            // Load from IndexedDB cache first
            const cached = await this.loadFromCache();
            if (cached && Object.keys(cached).length > 0) {
                this.questionBank = cached;
                this.loaded = true;
                this.loading = false;
                console.log('Question bank loaded from cache');
                return this.questionBank;
            }
            
            // Load from JSON files
            await this.loadFromJSON();
            
            // Cache to IndexedDB
            await this.saveToCache();
            
            this.loaded = true;
            console.log('Question bank loaded successfully');
            
        } catch (error) {
            console.error('Error loading question bank:', error);
            throw error;
        } finally {
            this.loading = false;
        }
        
        return this.questionBank;
    }
    
    /**
     * Load from IndexedDB cache
     */
    async loadFromCache() {
        try {
            if (typeof db !== 'undefined' && db.getSetting) {
                const cachedBank = await db.getSetting('question_bank_cache');
                if (cachedBank) {
                    return JSON.parse(cachedBank);
                }
            }
        } catch (error) {
            console.warn('Could not load from cache:', error);
        }
        return null;
    }
    
    /**
     * Save to IndexedDB cache
     */
    async saveToCache() {
        try {
            if (typeof db !== 'undefined' && db.saveSetting) {
                await db.saveSetting('question_bank_cache', JSON.stringify(this.questionBank));
                console.log('Question bank cached');
            }
        } catch (error) {
            console.warn('Could not save to cache:', error);
        }
    }
    
    /**
     * Load from JSON files
     */
    async loadFromJSON() {
        const loadPromises = this.subjects.map(async (subject) => {
            try {
                const subjectName = subject.name.toLowerCase();
                const response = await fetch(`data/questions/${subjectName}/${subjectName}.json`);
                
                if (!response.ok) {
                    throw new Error(`Failed to load ${subject.name} questions: ${response.status}`);
                }
                
                const data = await response.json();
                this.questionBank[subject.name] = data.questions || data;
                
                console.log(`Loaded ${this.questionBank[subject.name].length} ${subject.name} questions`);
                
                // Load topics if separate files
                await this.loadSubjectTopics(subjectName);
                
            } catch (error) {
                console.error(`Error loading ${subject.name}:`, error);
                // Try alternative loading method
                await this.loadSubjectFromAlternative(subject.name);
            }
        });
        
        await Promise.all(loadPromises);
    }
    
    /**
     * Load subject topics from separate JSON files
     */
    async loadSubjectTopics(subjectName) {
        // Define topics for each subject based on blueprint
        const subjectTopics = {
            anatomy: [
                'gross-anatomy', 'upper-limb', 'lower-limb', 'thorax', 'abdomen',
                'pelvis-perineum', 'head-neck', 'neuroanatomy', 'cross-sectional', 'radiological-anatomy'
            ],
            physiology: [
                'introduction-homeostasis', 'cell-physiology', 'body-fluids-compartments',
                'cellular-transport', 'signal-transduction', 'cardiovascular', 'renal',
                'respiratory', 'neurophysiology', 'endocrine', 'gastrointestinal',
                'special-senses', 'reproductive', 'muscle-physiology', 'integrative-physiology'
            ],
            biochemistry: [
                'biomolecules', 'enzymology', 'metabolism', 'bioenergetics', 'molecular-biology',
                'clinical-biochemistry', 'nutrition', 'acid-base-balance', 'biochemical-techniques',
                'integration-metabolism'
            ],
            histology: ['general-histology', 'epithelium', 'connective-tissue', 'muscle-tissue', 'nervous-tissue', 'organs'],
            embryology: ['general-embryology', 'gametogenesis', 'fertilization', 'gastrulation', 'organogenesis', 'fetal-development'],
            pathology: ['general-pathology', 'inflammation', 'neoplasia', 'hematopathology', 'systemic-pathology', 'clinical-pathology'],
            pharmacology: ['general-pharmacology', 'autonomic-drugs', 'cns-drugs', 'cardiovascular-drugs', 'chemotherapy', 'toxicology'],
            microbiology: ['general-microbiology', 'bacteriology', 'virology', 'mycology', 'parasitology', 'immunology']
        };
        
        const topics = subjectTopics[subjectName] || [];
        const subject = this.subjects.find(s => s.id === subjectName);
        
        if (!subject || topics.length === 0) return;
        
        const topicPromises = topics.map(async (topic) => {
            try {
                const response = await fetch(`data/questions/${subjectName}/${topic}.json`);
                if (response.ok) {
                    const data = await response.json();
                    const questions = data.questions || data;
                    
                    // Add topic information to each question
                    questions.forEach(q => {
                        q.subject = subject.name;
                        q.topic = this.formatTopicName(topic);
                    });
                    
                    // Add to question bank
                    this.questionBank[subject.name].push(...questions);
                    
                    console.log(`Loaded ${questions.length} questions for ${subject.name} - ${topic}`);
                }
            } catch (error) {
                console.warn(`Could not load topic ${topic} for ${subject.name}:`, error);
            }
        });
        
        await Promise.all(topicPromises);
    }
    
    /**
     * Format topic name for display
     */
    formatTopicName(topic) {
        return topic
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
    
    /**
     * Alternative loading method for subjects
     */
    async loadSubjectFromAlternative(subjectName) {
        try {
            // Try loading from a single combined file
            const response = await fetch(`data/questions/${subjectName.toLowerCase()}.json`);
            if (response.ok) {
                const data = await response.json();
                this.questionBank[subjectName] = data.questions || data;
                console.log(`Loaded ${this.questionBank[subjectName].length} ${subjectName} questions from alternative source`);
            } else {
                // Generate placeholder questions for development
                this.generatePlaceholderQuestions(subjectName);
            }
        } catch (error) {
            console.error(`Alternative load failed for ${subjectName}:`, error);
            this.generatePlaceholderQuestions(subjectName);
        }
    }
    
    /**
     * Generate placeholder questions (for development only)
     */
    generatePlaceholderQuestions(subjectName) {
        const subject = this.subjects.find(s => s.name === subjectName);
        if (!subject) return;
        
        const questionCount = subject.questions || 100;
        const questions = [];
        
        const topics = {
            Anatomy: ['Gross Anatomy', 'Upper Limb', 'Lower Limb', 'Thorax', 'Abdomen'],
            Physiology: ['Cell Physiology', 'Cardiovascular', 'Respiratory', 'Renal', 'Neurophysiology'],
            Biochemistry: ['Biomolecules', 'Metabolism', 'Enzymology', 'Molecular Biology', 'Clinical Biochemistry'],
            Histology: ['Epithelium', 'Connective Tissue', 'Muscle Tissue', 'Nervous Tissue', 'Organs'],
            Embryology: ['Gametogenesis', 'Fertilization', 'Gastrulation', 'Organogenesis', 'Fetal Development'],
            Pathology: ['Inflammation', 'Neoplasia', 'Hemostasis', 'Immunopathology', 'Systemic Pathology'],
            Pharmacology: ['General Pharmacology', 'Autonomic Drugs', 'CNS Drugs', 'Cardiovascular Drugs', 'Chemotherapy'],
            Microbiology: ['Bacteriology', 'Virology', 'Mycology', 'Parasitology', 'Immunology']
        };
        
        const difficulties = ['Easy', 'Medium', 'Hard', 'Expert'];
        
        for (let i = 1; i <= questionCount; i++) {
            const topic = topics[subjectName][Math.floor(Math.random() * topics[subjectName].length)];
            const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
            
            questions.push({
                id: `${subjectName.toLowerCase()}_${i.toString().padStart(3, '0')}`,
                question: `Sample question ${i} about ${topic.toLowerCase()} in ${subjectName}?`,
                options: [
                    'Option A is the correct answer',
                    'Option B is incorrect',
                    'Option C might be correct',
                    'Option D is definitely wrong',
                    'Option E requires more thought'
                ],
                correct: 'A',
                explanation: `This is a sample explanation for question ${i}. The correct answer is A because...`,
                subject: subjectName,
                topic: topic,
                difficulty: difficulty,
                difficultyLevel: difficulties.indexOf(difficulty) + 1,
                reference: `Reference ${i}: ${subjectName} Textbook, Chapter ${Math.ceil(i/20)}`,
                hints: [
                    `Hint 1: Consider the basic principles of ${topic}`,
                    `Hint 2: Review ${subjectName} concepts related to this topic`
                ]
            });
        }
        
        this.questionBank[subjectName] = questions;
        console.log(`Generated ${questions.length} placeholder questions for ${subjectName}`);
    }
    
    /**
     * Get question by ID
     */
    async getQuestion(questionId) {
        // Check cache first
        if (this.questionCache.has(questionId)) {
            return this.questionCache.get(questionId);
        }
        
        await this.ensureLoaded();
        
        // Find question in bank
        for (const subject in this.questionBank) {
            const question = this.questionBank[subject].find(q => q.id === questionId);
            if (question) {
                // Enhance question with additional data
                const enhancedQuestion = this.enhanceQuestion(question);
                this.questionCache.set(questionId, enhancedQuestion);
                return enhancedQuestion;
            }
        }
        
        // Try loading from IndexedDB
        if (typeof db !== 'undefined' && db.getQuestion) {
            const question = await db.getQuestion(questionId);
            if (question) {
                this.questionCache.set(questionId, question);
                return question;
            }
        }
        
        console.warn(`Question not found: ${questionId}`);
        return null;
    }
    
    /**
     * Enhance question with additional data
     */
    enhanceQuestion(question) {
        if (!question) return null;
        
        // Ensure all required fields exist
        const enhanced = {
            id: question.id,
            question: question.question || question.text || '',
            options: question.options || [],
            correct: question.correct || question.correctAnswer || '',
            explanation: question.explanation || '',
            subject: question.subject || '',
            topic: question.topic || 'General',
            difficulty: question.difficulty || 'Medium',
            difficultyLevel: question.difficultyLevel || 2,
            image: question.image || null,
            reference: question.reference || '',
            hints: question.hints || [],
            metadata: question.metadata || {}
        };
        
        // Parse options if they're in a different format
        if (typeof enhanced.options === 'string') {
            enhanced.options = enhanced.options.split(',').map(opt => opt.trim());
        }
        
        // Ensure we have exactly 5 options
        while (enhanced.options.length < 5) {
            enhanced.options.push(`Option ${String.fromCharCode(65 + enhanced.options.length)}`);
        }
        
        // Truncate to 5 options if more
        if (enhanced.options.length > 5) {
            enhanced.options = enhanced.options.slice(0, 5);
        }
        
        return enhanced;
    }
    
    /**
     * Get questions by filter
     */
    async getQuestions(filter = {}) {
        await this.ensureLoaded();
        
        let questions = [];
        
        // Collect questions based on filter
        if (filter.subject) {
            const subjectQuestions = this.questionBank[filter.subject] || [];
            questions = [...subjectQuestions];
        } else {
            // Get questions from all subjects
            for (const subject in this.questionBank) {
                questions.push(...this.questionBank[subject]);
            }
        }
        
        // Apply filters
        if (filter.topic) {
            questions = questions.filter(q => q.topic === filter.topic);
        }
        
        if (filter.difficulty) {
            questions = questions.filter(q => q.difficulty === filter.difficulty);
        }
        
        if (filter.difficultyLevel) {
            questions = questions.filter(q => q.difficultyLevel === filter.difficultyLevel);
        }
        
        if (filter.minDifficulty) {
            questions = questions.filter(q => q.difficultyLevel >= filter.minDifficulty);
        }
        
        if (filter.maxDifficulty) {
            questions = questions.filter(q => q.difficultyLevel <= filter.maxDifficulty);
        }
        
        // Apply limit
        if (filter.limit) {
            questions = questions.slice(0, filter.limit);
        }
        
        // Apply offset for pagination
        if (filter.offset) {
            questions = questions.slice(filter.offset);
        }
        
        // Randomize if requested
        if (filter.randomize) {
            questions = this.shuffleArray(questions);
        }
        
        // Enhance questions
        return questions.map(q => this.enhanceQuestion(q));
    }
    
    /**
     * Get questions for exam
     */
    async getExamQuestions(examConfig) {
        const {
            subjects = [],
            topics = [],
            questionCount = 25,
            difficulty = 'mixed',
            randomize = true
        } = examConfig;
        
        let allQuestions = [];
        
        // Get questions for selected subjects
        if (subjects.length > 0) {
            for (const subject of subjects) {
                const subjectQuestions = await this.getQuestions({
                    subject: subject,
                    topic: topics.length > 0 ? undefined : undefined
                });
                allQuestions.push(...subjectQuestions);
            }
        } else {
            // Get questions from all subjects
            allQuestions = await this.getQuestions({});
        }
        
        // Filter by topics if specified
        if (topics.length > 0) {
            allQuestions = allQuestions.filter(q => topics.includes(q.topic));
        }
        
        // Apply difficulty filter
        if (difficulty !== 'mixed') {
            allQuestions = allQuestions.filter(q => q.difficulty === difficulty);
        } else {
            // Mixed difficulty: ensure distribution
            allQuestions = this.balanceDifficulty(allQuestions);
        }
        
        // Randomize
        if (randomize) {
            allQuestions = this.shuffleArray(allQuestions);
        }
        
        // Apply question count limit
        const selectedQuestions = allQuestions.slice(0, questionCount);
        
        // Add question numbers
        return selectedQuestions.map((q, index) => ({
            ...q,
            questionNumber: index + 1
        }));
    }
    
    /**
     * Balance difficulty levels
     */
    balanceDifficulty(questions) {
        const difficultyDistribution = {
            'Easy': 0.2,    // 20%
            'Medium': 0.3,  // 30%
            'Hard': 0.3,    // 30%
            'Expert': 0.2   // 20%
        };
        
        const grouped = {
            'Easy': [],
            'Medium': [],
            'Hard': [],
            'Expert': []
        };
        
        // Group questions by difficulty
        questions.forEach(q => {
            if (grouped[q.difficulty]) {
                grouped[q.difficulty].push(q);
            }
        });
        
        // Shuffle each group
        Object.keys(grouped).forEach(diff => {
            grouped[diff] = this.shuffleArray(grouped[diff]);
        });
        
        // Calculate target counts
        const totalQuestions = questions.length;
        const targetCounts = {};
        Object.keys(difficultyDistribution).forEach(diff => {
            targetCounts[diff] = Math.floor(totalQuestions * difficultyDistribution[diff]);
        });
        
        // Select questions based on target distribution
        const selected = [];
        Object.keys(grouped).forEach(diff => {
            const count = Math.min(targetCounts[diff] || 0, grouped[diff].length);
            selected.push(...grouped[diff].slice(0, count));
        });
        
        // If we don't have enough questions, add more from whatever is available
        if (selected.length < totalQuestions) {
            const remaining = questions.filter(q => !selected.includes(q));
            selected.push(...remaining.slice(0, totalQuestions - selected.length));
        }
        
        return this.shuffleArray(selected);
    }
    
    /**
     * Search questions
     */
    async searchQuestions(query, options = {}) {
        await this.ensureLoaded();
        
        const {
            subject = null,
            topic = null,
            difficulty = null,
            limit = 50
        } = options;
        
        let results = [];
        const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 2);
        
        if (searchTerms.length === 0) {
            return [];
        }
        
        // Search through all questions
        for (const subjectName in this.questionBank) {
            // Skip if subject filter doesn't match
            if (subject && subjectName !== subject) continue;
            
            for (const question of this.questionBank[subjectName]) {
                // Apply filters
                if (topic && question.topic !== topic) continue;
                if (difficulty && question.difficulty !== difficulty) continue;
                
                // Search in question text and options
                const searchText = (
                    question.question +
                    ' ' + (question.options || []).join(' ') +
                    ' ' + (question.explanation || '') +
                    ' ' + (question.topic || '')
                ).toLowerCase();
                
                // Check if all search terms are found
                const matches = searchTerms.every(term => searchText.includes(term));
                
                if (matches) {
                    results.push(this.enhanceQuestion(question));
                    
                    if (results.length >= limit) {
                        return results;
                    }
                }
            }
        }
        
        return results;
    }
    
    /**
     * Get question statistics
     */
    async getQuestionStats() {
        await this.ensureLoaded();
        
        if (Object.keys(this.stats).length > 0) {
            return this.stats;
        }
        
        await this.calculateStats();
        return this.stats;
    }
    
    /**
     * Calculate statistics
     */
    async calculateStats() {
        await this.ensureLoaded();
        
        const stats = {
            totalQuestions: 0,
            bySubject: {},
            byTopic: {},
            byDifficulty: {},
            topics: []
        };
        
        for (const subject in this.questionBank) {
            const questions = this.questionBank[subject];
            stats.totalQuestions += questions.length;
            
            // Subject statistics
            stats.bySubject[subject] = {
                count: questions.length,
                topics: new Set(),
                difficulties: {}
            };
            
            // Process each question
            questions.forEach(q => {
                const question = this.enhanceQuestion(q);
                
                // Topic statistics
                const topic = question.topic;
                if (topic) {
                    stats.bySubject[subject].topics.add(topic);
                    
                    if (!stats.byTopic[topic]) {
                        stats.byTopic[topic] = {
                            count: 0,
                            subject: subject,
                            difficulties: {}
                        };
                        stats.topics.push({
                            name: topic,
                            subject: subject,
                            count: 0
                        });
                    }
                    stats.byTopic[topic].count++;
                    
                    const topicObj = stats.topics.find(t => t.name === topic);
                    if (topicObj) {
                        topicObj.count++;
                    }
                }
                
                // Difficulty statistics
                const difficulty = question.difficulty;
                if (difficulty) {
                    // Subject difficulty
                    if (!stats.bySubject[subject].difficulties[difficulty]) {
                        stats.bySubject[subject].difficulties[difficulty] = 0;
                    }
                    stats.bySubject[subject].difficulties[difficulty]++;
                    
                    // Global difficulty
                    if (!stats.byDifficulty[difficulty]) {
                        stats.byDifficulty[difficulty] = 0;
                    }
                    stats.byDifficulty[difficulty]++;
                    
                    // Topic difficulty
                    if (topic) {
                        if (!stats.byTopic[topic].difficulties[difficulty]) {
                            stats.byTopic[topic].difficulties[difficulty] = 0;
                        }
                        stats.byTopic[topic].difficulties[difficulty]++;
                    }
                }
            });
            
            // Convert Set to Array
            stats.bySubject[subject].topics = Array.from(stats.bySubject[subject].topics);
        }
        
        // Sort topics by count
        stats.topics.sort((a, b) => b.count - a.count);
        
        this.stats = stats;
        return stats;
    }
    
    /**
     * Get topics for subject
     */
    async getTopicsForSubject(subject) {
        await this.ensureLoaded();
        
        const stats = await this.getQuestionStats();
        const subjectStats = stats.bySubject[subject];
        
        if (!subjectStats) {
            return [];
        }
        
        return subjectStats.topics.map(topic => ({
            name: topic,
            count: stats.byTopic[topic]?.count || 0,
            subject: subject
        }));
    }
    
    /**
     * Get question count by subject and topic
     */
    async getQuestionCount(subject = null, topic = null) {
        await this.ensureLoaded();
        
        if (!subject) {
            return this.questionBank.reduce((total, questions) => total + questions.length, 0);
        }
        
        const subjectQuestions = this.questionBank[subject] || [];
        
        if (!topic) {
            return subjectQuestions.length;
        }
        
        return subjectQuestions.filter(q => q.topic === topic).length;
    }
    
    /**
     * Mark question as reviewed
     */
    async markQuestionReviewed(questionId, correct = null) {
        await this.loadUserProgress();
        
        if (!this.userProgress.reviews) {
            this.userProgress.reviews = {};
        }
        
        this.userProgress.reviews[questionId] = {
            reviewedAt: new Date().toISOString(),
            correct: correct,
            count: (this.userProgress.reviews[questionId]?.count || 0) + 1
        };
        
        await this.saveUserProgress();
        
        // Update cache
        if (this.questionCache.has(questionId)) {
            const question = this.questionCache.get(questionId);
            question.reviewed = this.userProgress.reviews[questionId];
            this.questionCache.set(questionId, question);
        }
    }
    
    /**
     * Flag question
     */
    async flagQuestion(questionId, reason = '') {
        await this.loadUserProgress();
        
        if (!this.userProgress.flags) {
            this.userProgress.flags = {};
        }
        
        this.userProgress.flags[questionId] = {
            flaggedAt: new Date().toISOString(),
            reason: reason
        };
        
        await this.saveUserProgress();
    }
    
    /**
     * Unflag question
     */
    async unflagQuestion(questionId) {
        await this.loadUserProgress();
        
        if (this.userProgress.flags && this.userProgress.flags[questionId]) {
            delete this.userProgress.flags[questionId];
            await this.saveUserProgress();
        }
    }
    
    /**
     * Add note to question
     */
    async addQuestionNote(questionId, note) {
        await this.loadUserProgress();
        
        if (!this.userProgress.notes) {
            this.userProgress.notes = {};
        }
        
        if (!this.userProgress.notes[questionId]) {
            this.userProgress.notes[questionId] = [];
        }
        
        this.userProgress.notes[questionId].push({
            note: note,
            createdAt: new Date().toISOString()
        });
        
        await this.saveUserProgress();
    }
    
    /**
     * Get question notes
     */
    async getQuestionNotes(questionId) {
        await this.loadUserProgress();
        
        return this.userProgress.notes?.[questionId] || [];
    }
    
    /**
     * Get flagged questions
     */
    async getFlaggedQuestions() {
        await this.loadUserProgress();
        
        const flaggedIds = Object.keys(this.userProgress.flags || {});
        const questions = [];
        
        for (const questionId of flaggedIds) {
            const question = await this.getQuestion(questionId);
            if (question) {
                question.flag = this.userProgress.flags[questionId];
                questions.push(question);
            }
        }
        
        return questions;
    }
    
    /**
     * Get review history
     */
    async getReviewHistory() {
        await this.loadUserProgress();
        
        const reviewIds = Object.keys(this.userProgress.reviews || {});
        const history = [];
        
        for (const questionId of reviewIds) {
            const question = await this.getQuestion(questionId);
            if (question) {
                history.push({
                    question: question,
                    review: this.userProgress.reviews[questionId]
                });
            }
        }
        
        // Sort by most recent review
        history.sort((a, b) => 
            new Date(b.review.reviewedAt) - new Date(a.review.reviewedAt)
        );
        
        return history;
    }
    
    /**
     * Get weak areas based on review history
     */
    async getWeakAreas() {
        await this.loadUserProgress();
        
        const reviews = this.userProgress.reviews || {};
        const topicPerformance = {};
        
        // Analyze performance by topic
        for (const [questionId, review] of Object.entries(reviews)) {
            if (review.correct === false) {
                const question = await this.getQuestion(questionId);
                if (question && question.topic) {
                    if (!topicPerformance[question.topic]) {
                        topicPerformance[question.topic] = {
                            subject: question.subject,
                            total: 0,
                            incorrect: 0
                        };
                    }
                    topicPerformance[question.topic].total++;
                    topicPerformance[question.topic].incorrect++;
                }
            } else if (review.correct === true) {
                const question = await this.getQuestion(questionId);
                if (question && question.topic) {
                    if (!topicPerformance[question.topic]) {
                        topicPerformance[question.topic] = {
                            subject: question.subject,
                            total: 0,
                            incorrect: 0
                        };
                    }
                    topicPerformance[question.topic].total++;
                }
            }
        }
        
        // Calculate error rates
        const weakAreas = [];
        for (const [topic, data] of Object.entries(topicPerformance)) {
            if (data.total >= 3) { // Only consider topics with enough data
                const errorRate = data.incorrect / data.total;
                if (errorRate > 0.3) { // More than 30% error rate
                    weakAreas.push({
                        topic: topic,
                        subject: data.subject,
                        errorRate: Math.round(errorRate * 100),
                        totalQuestions: data.total,
                        incorrect: data.incorrect
                    });
                }
            }
        }
        
        // Sort by error rate (highest first)
        weakAreas.sort((a, b) => b.errorRate - a.errorRate);
        
        return weakAreas;
    }
    
    /**
     * Load user progress from localStorage
     */
    async loadUserProgress() {
        try {
            const progressJson = localStorage.getItem('question_progress');
            if (progressJson) {
                this.userProgress = JSON.parse(progressJson);
            } else {
                this.userProgress = {
                    reviews: {},
                    flags: {},
                    notes: {}
                };
            }
        } catch (error) {
            console.error('Error loading user progress:', error);
            this.userProgress = {
                reviews: {},
                flags: {},
                notes: {}
            };
        }
    }
    
    /**
     * Save user progress to localStorage
     */
    async saveUserProgress() {
        try {
            localStorage.setItem('question_progress', JSON.stringify(this.userProgress));
        } catch (error) {
            console.error('Error saving user progress:', error);
        }
    }
    
    /**
     * Preload images for questions
     */
    async preloadImages(questionIds) {
        const imageUrls = new Set();
        
        // Collect image URLs
        for (const questionId of questionIds) {
            const question = await this.getQuestion(questionId);
            if (question && question.image) {
                imageUrls.add(`images/${question.image}`);
            }
        }
        
        // Preload images
        const preloadPromises = Array.from(imageUrls).map(url => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = resolve;
                img.onerror = reject;
                img.src = url;
            });
        });
        
        try {
            await Promise.all(preloadPromises);
            console.log(`Preloaded ${preloadPromises.length} images`);
        } catch (error) {
            console.warn('Some images failed to preload:', error);
        }
    }
    
    /**
     * Clear question cache
     */
    clearCache() {
        this.questionCache.clear();
        console.log('Question cache cleared');
    }
    
    /**
     * Reset user progress
     */
    async resetProgress() {
        this.userProgress = {
            reviews: {},
            flags: {},
            notes: {}
        };
        await this.saveUserProgress();
        console.log('User progress reset');
    }
    
    /**
     * Ensure question bank is loaded
     */
    async ensureLoaded() {
        if (!this.loaded && !this.loading) {
            await this.loadQuestionBank();
        } else if (this.loading) {
            // Wait for loading to complete
            await new Promise(resolve => {
                const checkInterval = setInterval(() => {
                    if (this.loaded) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
            });
        }
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
     * Validate question
     */
    validateQuestion(question) {
        const errors = [];
        
        if (!question.id) {
            errors.push('Question must have an id');
        }
        
        if (!question.question || question.question.trim().length === 0) {
            errors.push('Question must have text');
        }
        
        if (!question.options || !Array.isArray(question.options) || question.options.length < 2) {
            errors.push('Question must have at least 2 options');
        }
        
        if (!question.correct || question.correct.trim().length === 0) {
            errors.push('Question must have a correct answer');
        }
        
        if (!question.subject || question.subject.trim().length === 0) {
            errors.push('Question must have a subject');
        }
        
        if (!question.topic || question.topic.trim().length === 0) {
            errors.push('Question must have a topic');
        }
        
        if (!question.difficulty || !['Easy', 'Medium', 'Hard', 'Expert'].includes(question.difficulty)) {
            errors.push('Question must have a valid difficulty (Easy, Medium, Hard, Expert)');
        }
        
        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }
}

// Create global instance
const questions = new QuestionBankManager();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = questions;
}
/**
 * questions.js - Question Bank Manager
 * Purpose: Question storage, retrieval, filtering, and management
 * Features: Load question bank JSON, filter by subject/topic/difficulty, question statistics
 */

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

const QUESTION_BASE_URL = './data/questions/';
const QUESTION_STORAGE_KEY = 'medical_exam_question_bank';
const QUESTION_STATS_KEY = 'medical_exam_question_stats';
const QUESTION_NOTES_KEY = 'medical_exam_question_notes';

// Subject configuration from blueprint
const SUBJECTS = {
    anatomy: {
        name: "Anatomy",
        icon: "💀",
        color: "#FF6B6B",
        questionCount: 720,
        topics: [
            "gross-anatomy", "upper-limb", "lower-limb", "thorax",
            "abdomen", "pelvis-perineum", "head-neck", "neuroanatomy",
            "cross-sectional", "radiological-anatomy"
        ]
    },
    physiology: {
        name: "Physiology",
        icon: "❤️",
        color: "#4ECDC4",
        questionCount: 1150,
        topics: [
            "introduction-homeostasis", "cell-physiology", "body-fluids-compartments",
            "cellular-transport", "signal-transduction", "cardiovascular",
            "renal", "respiratory", "neurophysiology", "endocrine",
            "gastrointestinal", "special-senses", "reproductive",
            "muscle-physiology", "integrative-physiology"
        ]
    },
    biochemistry: {
        name: "Biochemistry",
        icon: "🧬",
        color: "#45B7D1",
        questionCount: 810,
        topics: [
            "biomolecules", "enzymology", "metabolism", "bioenergetics",
            "molecular-biology", "clinical-biochemistry", "nutrition",
            "acid-base-balance", "biochemical-techniques", "integration-metabolism"
        ]
    },
    histology: {
        name: "Histology",
        icon: "🔬",
        color: "#96CEB4",
        questionCount: 450,
        topics: [
            "cell-structure", "epithelial-tissue", "connective-tissue",
            "muscle-tissue", "nervous-tissue", "blood-and-hemopoiesis",
            "organ-systems", "histotechniques", "microscopic-anatomy"
        ]
    },
    embryology: {
        name: "Embryology",
        icon: "👶",
        color: "#FFEAA7",
        questionCount: 390,
        topics: [
            "gametogenesis", "fertilization", "week-1-development",
            "week-2-development", "week-3-development", "fetal-period",
            "placental-development", "congenital-anomalies", "system-organogenesis"
        ]
    },
    pathology: {
        name: "Pathology",
        icon: "🦠",
        color: "#DDA0DD",
        questionCount: 540,
        topics: [
            "cellular-injury", "inflammation", "tissue-repair",
            "hemodynamic-disorders", "genetic-disorders", "immunopathology",
            "neoplasia", "infectious-diseases", "environmental-nutritional"
        ]
    },
    pharmacology: {
        name: "Pharmacology",
        icon: "💊",
        color: "#FFD166",
        questionCount: 460,
        topics: [
            "pharmacokinetics", "pharmacodynamics", "autonomic-pharmacology",
            "cns-pharmacology", "cardiovascular-pharma", "endocrine-pharma",
            "chemotherapy", "toxicology", "clinical-pharmacology"
        ]
    },
    microbiology: {
        name: "Microbiology",
        icon: "🧫",
        color: "#A8E6CF",
        questionCount: 430,
        topics: [
            "bacteriology", "virology", "mycology", "parasitology",
            "immunology", "diagnostic-microbiology", "antimicrobial-therapy"
        ]
    }
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let questionBank = {
    loaded: false,
    subjects: {},
    totalQuestions: 0,
    loadedCount: 0,
    cache: new Map() // For fast lookups by ID
};

let questionStats = {
    attempts: {},
    correct: {},
    timeSpent: {},
    flagged: {},
    lastSeen: {}
};

let questionNotes = {};

// ============================================================================
// CORE FUNCTIONS - QUESTION LOADING
// ============================================================================

/**
 * Initialize the question bank
 */
async function initQuestionBank() {
    try {
        console.log("Initializing question bank...");
        
        // Load from localStorage first for quick startup
        loadFromLocalStorage();
        
        // Load statistics and notes
        loadQuestionStats();
        loadQuestionNotes();
        
        // Mark as loaded
        questionBank.loaded = true;
        console.log("Question bank initialized successfully");
        
        return true;
    } catch (error) {
        console.error("Failed to initialize question bank:", error);
        return false;
    }
}

/**
 * Load questions for a specific subject and topic on demand
 * @param {string} subject - Subject key (e.g., "anatomy")
 * @param {string} topic - Topic key (e.g., "upper-limb")
 * @returns {Promise<Array>} - Array of questions
 */
async function loadQuestions(subject, topic) {
    if (!SUBJECTS[subject]) {
        throw new Error(`Invalid subject: ${subject}`);
    }
    
    if (!SUBJECTS[subject].topics.includes(topic)) {
        throw new Error(`Invalid topic for ${subject}: ${topic}`);
    }
    
    try {
        console.log(`Loading questions for ${subject}/${topic}...`);
        
        // Check if already loaded
        const cacheKey = `${subject}_${topic}`;
        if (questionBank.subjects[cacheKey]) {
            console.log(`Questions already loaded from cache for ${cacheKey}`);
            return questionBank.subjects[cacheKey];
        }
        
        // Load from JSON file
        const url = `${QUESTION_BASE_URL}${subject}/${topic}.json`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.status}`);
        }
        
        const questions = await response.json();
        
        // Validate question format
        questions.forEach((q, index) => {
            if (!validateQuestion(q)) {
                console.warn(`Invalid question format at index ${index} in ${cacheKey}`);
            }
            
            // Generate ID if not present
            if (!q.id) {
                q.id = `${subject}_${topic}_${index}`;
            }
            
            // Ensure all required fields
            q.subject = subject;
            q.topic = topic;
            q.subjectName = SUBJECTS[subject].name;
            
            // Add to cache for fast lookup
            questionBank.cache.set(q.id, q);
        });
        
        // Store in memory
        questionBank.subjects[cacheKey] = questions;
        questionBank.loadedCount += questions.length;
        
        console.log(`Loaded ${questions.length} questions for ${subject}/${topic}`);
        
        // Save to localStorage for offline use
        saveToLocalStorage(subject, topic, questions);
        
        return questions;
    } catch (error) {
        console.error(`Error loading questions for ${subject}/${topic}:`, error);
        
        // Try to load from localStorage as fallback
        const cached = loadFromLocalStorage(subject, topic);
        if (cached && cached.length > 0) {
            console.log(`Loaded ${cached.length} questions from localStorage fallback`);
            return cached;
        }
        
        throw error;
    }
}

/**
 * Load questions for multiple topics
 * @param {Array} topics - Array of {subject, topic} objects
 * @returns {Promise<Array>} - Combined array of questions
 */
async function loadMultipleTopics(topics) {
    const allQuestions = [];
    
    for (const topic of topics) {
        try {
            const questions = await loadQuestions(topic.subject, topic.topic);
            allQuestions.push(...questions);
        } catch (error) {
            console.error(`Failed to load ${topic.subject}/${topic.topic}:`, error);
            // Continue with other topics
        }
    }
    
    return allQuestions;
}

/**
 * Get questions for exam based on criteria
 * @param {Object} criteria - Selection criteria
 * @returns {Promise<Array>} - Selected questions
 */
async function getQuestionsForExam(criteria) {
    const {
        subjects = [],
        topics = [],
        difficulty = [],
        count = 25,
        randomize = true,
        excludeSeen = false
    } = criteria;
    
    let allQuestions = [];
    
    // Load questions based on subjects/topics
    if (topics.length > 0) {
        allQuestions = await loadMultipleTopics(topics);
    } else if (subjects.length > 0) {
        // Load all topics for selected subjects
        const topicsToLoad = [];
        subjects.forEach(subject => {
            if (SUBJECTS[subject]) {
                SUBJECTS[subject].topics.forEach(topic => {
                    topicsToLoad.push({ subject, topic });
                });
            }
        });
        allQuestions = await loadMultipleTopics(topicsToLoad);
    } else {
        throw new Error("No subjects or topics specified");
    }
    
    // Apply filters
    let filteredQuestions = allQuestions;
    
    // Filter by difficulty
    if (difficulty.length > 0) {
        filteredQuestions = filteredQuestions.filter(q => 
            difficulty.includes(q.difficulty)
        );
    }
    
    // Exclude recently seen questions
    if (excludeSeen) {
        filteredQuestions = filteredQuestions.filter(q => {
            const lastSeen = questionStats.lastSeen[q.id];
            if (!lastSeen) return true;
            
            // Exclude if seen in last 24 hours
            const hoursSinceSeen = (Date.now() - lastSeen) / (1000 * 60 * 60);
            return hoursSinceSeen > 24;
        });
    }
    
    // Randomize if requested
    if (randomize) {
        filteredQuestions = shuffleArray(filteredQuestions);
    }
    
    // Limit to requested count
    return filteredQuestions.slice(0, count);
}

/**
 * Get a single question by ID
 * @param {string} questionId - Question ID
 * @returns {Promise<Object>} - Question object
 */
async function getQuestionById(questionId) {
    // Check cache first
    if (questionBank.cache.has(questionId)) {
        return questionBank.cache.get(questionId);
    }
    
    // Parse subject and topic from ID
    const parts = questionId.split('_');
    if (parts.length < 3) {
        throw new Error(`Invalid question ID format: ${questionId}`);
    }
    
    const subject = parts[0];
    const topic = parts[1];
    
    // Load the topic and find the question
    const questions = await loadQuestions(subject, topic);
    const question = questions.find(q => q.id === questionId);
    
    if (!question) {
        throw new Error(`Question not found: ${questionId}`);
    }
    
    return question;
}

// ============================================================================
// EXAM-RELATED FUNCTIONS
// ============================================================================

/**
 * Prepare questions for exam room
 * @param {Array} questions - Raw questions from selection
 * @returns {Array} - Processed questions ready for exam
 */
function prepareForExam(questions) {
    return questions.map(q => {
        // Create a clean version without answers for exam
        return {
            id: q.id,
            question: q.question,
            options: q.options,
            subject: q.subject,
            topic: q.topic,
            difficulty: q.difficulty,
            image: q.image,
            // Don't include correct answer or explanation
            timeAllocated: getTimeForDifficulty(q.difficulty)
        };
    });
}

/**
 * Get time allocation based on difficulty
 * @param {number} difficulty - Difficulty level 1-5
 * @returns {number} - Time in seconds
 */
function getTimeForDifficulty(difficulty) {
    switch(difficulty) {
        case 1: return 21; // Easy
        case 2: return 30; // Moderate
        case 3: return 42; // Intermediate
        case 4: // Fall through
        case 5: return 54; // Hard/Expert
        default: return 30;
    }
}

/**
 * Save exam attempt to storage for review
 * @param {Array} examQuestions - Questions with user answers
 * @param {Object} examResult - Overall exam result
 */
function saveExamAttempt(examQuestions, examResult) {
    try {
        const attempt = {
            id: generateId(),
            timestamp: Date.now(),
            questions: examQuestions,
            result: examResult,
            subject: examResult.subject,
            score: examResult.score,
            timeSpent: examResult.timeSpent
        };
        
        // Save to IndexedDB via db.js
        if (typeof window.saveExamResult === 'function') {
            window.saveExamResult(attempt);
        } else {
            // Fallback to localStorage
            const attempts = JSON.parse(localStorage.getItem('exam_attempts') || '[]');
            attempts.push(attempt);
            localStorage.setItem('exam_attempts', JSON.stringify(attempts));
        }
        
        // Update question statistics
        updateQuestionStatsFromExam(examQuestions);
        
        console.log("Exam attempt saved successfully");
        return attempt.id;
    } catch (error) {
        console.error("Failed to save exam attempt:", error);
        throw error;
    }
}

/**
 * Update statistics based on exam results
 * @param {Array} examQuestions - Questions with user answers
 */
function updateQuestionStatsFromExam(examQuestions) {
    examQuestions.forEach(q => {
        const questionId = q.id;
        
        // Initialize if needed
        if (!questionStats.attempts[questionId]) {
            questionStats.attempts[questionId] = 0;
            questionStats.correct[questionId] = 0;
            questionStats.timeSpent[questionId] = 0;
        }
        
        // Update statistics
        questionStats.attempts[questionId]++;
        
        if (q.userAnswer === q.correct) {
            questionStats.correct[questionId]++;
        }
        
        questionStats.timeSpent[questionId] += q.timeSpent || 0;
        questionStats.lastSeen[questionId] = Date.now();
        
        // Save to localStorage
        saveQuestionStats();
    });
}

// ============================================================================
// QUESTION FILTERING & SEARCH
// ============================================================================

/**
 * Filter questions by various criteria
 * @param {Array} questions - Questions to filter
 * @param {Object} filters - Filter criteria
 * @returns {Array} - Filtered questions
 */
function filterQuestions(questions, filters) {
    let filtered = [...questions];
    
    // Filter by subject
    if (filters.subject) {
        filtered = filtered.filter(q => q.subject === filters.subject);
    }
    
    // Filter by topic
    if (filters.topic) {
        filtered = filtered.filter(q => q.topic === filters.topic);
    }
    
    // Filter by difficulty
    if (filters.difficulty) {
        const difficulties = Array.isArray(filters.difficulty) ? 
            filters.difficulty : [filters.difficulty];
        filtered = filtered.filter(q => difficulties.includes(q.difficulty));
    }
    
    // Filter by keyword search
    if (filters.search) {
        const searchTerm = filters.search.toLowerCase();
        filtered = filtered.filter(q => 
            q.question.toLowerCase().includes(searchTerm) ||
            (q.keywords && q.keywords.some(kw => kw.toLowerCase().includes(searchTerm)))
        );
    }
    
    // Filter by flagged status
    if (filters.flagged === true) {
        filtered = filtered.filter(q => questionStats.flagged && questionStats.flagged[q.id]);
    }
    
    // Filter by not attempted
    if (filters.notAttempted === true) {
        filtered = filtered.filter(q => !questionStats.attempts || !questionStats.attempts[q.id]);
    }
    
    return filtered;
}

/**
 * Search questions by keyword
 * @param {string} keyword - Search term
 * @param {string} subject - Optional subject filter
 * @returns {Promise<Array>} - Matching questions
 */
async function searchQuestions(keyword, subject = null) {
    const results = [];
    const searchTerm = keyword.toLowerCase();
    
    // Get all loaded questions
    const allQuestions = Array.from(questionBank.cache.values());
    
    // Search through loaded questions
    for (const question of allQuestions) {
        // Apply subject filter
        if (subject && question.subject !== subject) {
            continue;
        }
        
        // Check question text
        if (question.question.toLowerCase().includes(searchTerm)) {
            results.push(question);
            continue;
        }
        
        // Check options
        if (question.options && question.options.some(opt => 
            opt.toLowerCase().includes(searchTerm))) {
            results.push(question);
            continue;
        }
        
        // Check keywords
        if (question.keywords && question.keywords.some(kw => 
            kw.toLowerCase().includes(searchTerm))) {
            results.push(question);
            continue;
        }
        
        // Check explanation
        if (question.explanation && 
            question.explanation.toLowerCase().includes(searchTerm)) {
            results.push(question);
        }
    }
    
    return results;
}

// ============================================================================
// STATISTICS & ANALYTICS
// ============================================================================

/**
 * Get question statistics
 * @param {string} questionId - Question ID
 * @returns {Object} - Statistics object
 */
function getQuestionStats(questionId) {
    return {
        attempts: questionStats.attempts[questionId] || 0,
        correct: questionStats.correct[questionId] || 0,
        accuracy: questionStats.attempts[questionId] ? 
            (questionStats.correct[questionId] / questionStats.attempts[questionId] * 100).toFixed(1) : 0,
        timeSpent: questionStats.timeSpent[questionId] || 0,
        flagged: questionStats.flagged && questionStats.flagged[questionId] || false,
        lastSeen: questionStats.lastSeen[questionId] || null
    };
}

/**
 * Toggle flagged status for a question
 * @param {string} questionId - Question ID
 * @returns {boolean} - New flagged status
 */
function toggleFlagQuestion(questionId) {
    if (!questionStats.flagged) {
        questionStats.flagged = {};
    }
    
    questionStats.flagged[questionId] = !questionStats.flagged[questionId];
    saveQuestionStats();
    
    return questionStats.flagged[questionId];
}

/**
 * Get flagged questions
 * @returns {Array} - Array of flagged question IDs
 */
function getFlaggedQuestions() {
    if (!questionStats.flagged) return [];
    
    return Object.keys(questionStats.flagged)
        .filter(id => questionStats.flagged[id]);
}

// ============================================================================
// NOTES MANAGEMENT
// ============================================================================

/**
 * Add/edit note for a question
 * @param {string} questionId - Question ID
 * @param {string} note - Note text
 */
function saveQuestionNote(questionId, note) {
    if (!questionNotes[questionId]) {
        questionNotes[questionId] = [];
    }
    
    questionNotes[questionId].push({
        id: generateId(),
        text: note,
        timestamp: Date.now()
    });
    
    saveQuestionNotes();
}

/**
 * Get notes for a question
 * @param {string} questionId - Question ID
 * @returns {Array} - Array of notes
 */
function getQuestionNotes(questionId) {
    return questionNotes[questionId] || [];
}

/**
 * Delete a specific note
 * @param {string} questionId - Question ID
 * @param {string} noteId - Note ID to delete
 */
function deleteQuestionNote(questionId, noteId) {
    if (!questionNotes[questionId]) return;
    
    questionNotes[questionId] = questionNotes[questionId]
        .filter(note => note.id !== noteId);
    
    saveQuestionNotes();
}

// ============================================================================
// STORAGE MANAGEMENT
// ============================================================================

/**
 * Save questions to localStorage
 * @param {string} subject - Subject key
 * @param {string} topic - Topic key
 * @param {Array} questions - Questions to save
 */
function saveToLocalStorage(subject, topic, questions) {
    try {
        const key = `${QUESTION_STORAGE_KEY}_${subject}_${topic}`;
        localStorage.setItem(key, JSON.stringify({
            timestamp: Date.now(),
            version: '1.0',
            questions: questions
        }));
        
        console.log(`Saved ${questions.length} questions to localStorage: ${key}`);
    } catch (error) {
        console.error("Failed to save to localStorage:", error);
    }
}

/**
 * Load questions from localStorage
 * @param {string} subject - Optional subject filter
 * @param {string} topic - Optional topic filter
 * @returns {Array|Object} - Loaded questions or all cached data
 */
function loadFromLocalStorage(subject = null, topic = null) {
    if (subject && topic) {
        const key = `${QUESTION_STORAGE_KEY}_${subject}_${topic}`;
        const data = localStorage.getItem(key);
        
        if (data) {
            try {
                const parsed = JSON.parse(data);
                console.log(`Loaded ${parsed.questions.length} questions from localStorage: ${key}`);
                
                // Add to cache
                parsed.questions.forEach(q => {
                    questionBank.cache.set(q.id, q);
                });
                
                return parsed.questions;
            } catch (error) {
                console.error("Failed to parse localStorage data:", error);
            }
        }
        return [];
    }
    
    // Load all cached questions
    const allQuestions = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(QUESTION_STORAGE_KEY)) {
            try {
                const data = JSON.parse(localStorage.getItem(key));
                allQuestions.push(...data.questions);
                
                // Add to cache
                data.questions.forEach(q => {
                    questionBank.cache.set(q.id, q);
                });
            } catch (error) {
                console.error(`Failed to parse ${key}:`, error);
            }
        }
    }
    
    console.log(`Loaded ${allQuestions.length} total questions from localStorage cache`);
    return allQuestions;
}

/**
 * Save question statistics to localStorage
 */
function saveQuestionStats() {
    try {
        localStorage.setItem(QUESTION_STATS_KEY, JSON.stringify(questionStats));
    } catch (error) {
        console.error("Failed to save question stats:", error);
    }
}

/**
 * Load question statistics from localStorage
 */
function loadQuestionStats() {
    try {
        const data = localStorage.getItem(QUESTION_STATS_KEY);
        if (data) {
            questionStats = JSON.parse(data);
            console.log("Loaded question statistics from localStorage");
        }
    } catch (error) {
        console.error("Failed to load question stats:", error);
    }
}

/**
 * Save question notes to localStorage
 */
function saveQuestionNotes() {
    try {
        localStorage.setItem(QUESTION_NOTES_KEY, JSON.stringify(questionNotes));
    } catch (error) {
        console.error("Failed to save question notes:", error);
    }
}

/**
 * Load question notes from localStorage
 */
function loadQuestionNotes() {
    try {
        const data = localStorage.getItem(QUESTION_NOTES_KEY);
        if (data) {
            questionNotes = JSON.parse(data);
            console.log("Loaded question notes from localStorage");
        }
    } catch (error) {
        console.error("Failed to load question notes:", error);
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Validate question format
 * @param {Object} question - Question to validate
 * @returns {boolean} - True if valid
 */
function validateQuestion(question) {
    const required = ['question', 'options', 'correct'];
    
    for (const field of required) {
        if (!question[field]) {
            console.error(`Missing required field: ${field}`, question);
            return false;
        }
    }
    
    // Validate options array
    if (!Array.isArray(question.options) || question.options.length < 2) {
        console.error("Invalid options array", question);
        return false;
    }
    
    // Validate correct answer
    if (!question.options.some(opt => opt.startsWith(question.correct + '.'))) {
        console.error(`Correct answer ${question.correct} not found in options`, question);
        return false;
    }
    
    return true;
}

/**
 * Shuffle array (Fisher-Yates algorithm)
 * @param {Array} array - Array to shuffle
 * @returns {Array} - Shuffled array
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Generate unique ID
 * @returns {string} - Unique ID
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Get all subjects with metadata
 * @returns {Object} - Subjects configuration
 */
function getAllSubjects() {
    return SUBJECTS;
}

/**
 * Get topics for a subject
 * @param {string} subject - Subject key
 * @returns {Array} - Array of topic names
 */
function getTopicsForSubject(subject) {
    return SUBJECTS[subject] ? SUBJECTS[subject].topics : [];
}

/**
 * Get question count for subject/topic
 * @param {string} subject - Subject key
 * @param {string} topic - Topic key
 * @returns {Promise<number>} - Question count
 */
async function getQuestionCount(subject, topic) {
    try {
        const questions = await loadQuestions(subject, topic);
        return questions.length;
    } catch (error) {
        console.error(`Failed to get question count for ${subject}/${topic}:`, error);
        return 0;
    }
}

/**
 * Get total loaded question count
 * @returns {Object} - Counts by subject and total
 */
function getLoadedCounts() {
    const counts = {
        total: questionBank.loadedCount,
        bySubject: {}
    };
    
    Object.keys(SUBJECTS).forEach(subject => {
        counts.bySubject[subject] = 0;
    });
    
    questionBank.cache.forEach(question => {
        if (counts.bySubject[question.subject] !== undefined) {
            counts.bySubject[question.subject]++;
        }
    });
    
    return counts;
}

// ============================================================================
// EXPORTS & INITIALIZATION
// ============================================================================

// Public API
window.QuestionBank = {
    // Initialization
    init: initQuestionBank,
    
    // Core loading
    loadQuestions,
    loadMultipleTopics,
    getQuestionsForExam,
    getQuestionById,
    
    // Exam functions
    prepareForExam,
    saveExamAttempt,
    
    // Filtering & search
    filterQuestions,
    searchQuestions,
    
    // Statistics
    getQuestionStats,
    toggleFlagQuestion,
    getFlaggedQuestions,
    updateQuestionStatsFromExam,
    
    // Notes
    saveQuestionNote,
    getQuestionNotes,
    deleteQuestionNote,
    
    // Utility
    getAllSubjects,
    getTopicsForSubject,
    getQuestionCount,
    getLoadedCounts,
    
    // Configuration
    SUBJECTS,
    
    // State (read-only)
    get state() {
        return {
            loaded: questionBank.loaded,
            totalLoaded: questionBank.loadedCount,
            cacheSize: questionBank.cache.size
        };
    }
};

// Auto-initialize when loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log("QuestionBank module loaded, initializing...");
    
    // Initialize with a small delay to avoid blocking UI
    setTimeout(async () => {
        await initQuestionBank();
        
        // Dispatch event when initialized
        const event = new CustomEvent('questionBankReady', {
            detail: { success: questionBank.loaded }
        });
        document.dispatchEvent(event);
    }, 100);
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.QuestionBank;
}

// ============================================================================
// EVENT LISTENERS FOR INTEGRATION WITH OTHER MODULES
// ============================================================================

// Listen for exam start to pre-load questions
document.addEventListener('examStarting', async (event) => {
    const { criteria } = event.detail;
    
    if (criteria && criteria.topics) {
        console.log("Pre-loading questions for exam...");
        await loadMultipleTopics(criteria.topics);
    }
});

// Listen for question view to update stats
document.addEventListener('questionViewed', (event) => {
    const { questionId } = event.detail;
    
    if (questionId && questionStats.lastSeen) {
        questionStats.lastSeen[questionId] = Date.now();
        saveQuestionStats();
    }
});

// Listen for offline mode to ensure questions are cached
document.addEventListener('offlineMode', () => {
    console.log("Offline mode detected, ensuring question cache is ready...");
    // We could trigger loading of commonly used topics here
});

// ============================================================================
// DEBUG & DEVELOPMENT HELPERS
// ============================================================================

/**
 * Debug function to inspect question bank state
 */
function debugQuestionBank() {
    console.group("Question Bank Debug Info");
    console.log("Loaded:", questionBank.loaded);
    console.log("Total questions loaded:", questionBank.loadedCount);
    console.log("Cache size:", questionBank.cache.size);
    console.log("Subjects loaded:", Object.keys(questionBank.subjects));
    
    const counts = getLoadedCounts();
    console.log("Counts by subject:", counts.bySubject);
    
    console.log("Question statistics count:", Object.keys(questionStats.attempts || {}).length);
    console.log("Question notes count:", Object.keys(questionNotes).length);
    console.groupEnd();
}

// Make debug function available in development
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    window.debugQuestionBank = debugQuestionBank;
}

console.log("questions.js loaded successfully - Medical Exam Room Pro Question Bank Manager");
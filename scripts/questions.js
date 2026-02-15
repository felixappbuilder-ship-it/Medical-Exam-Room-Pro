```javascript
// scripts/questions.js
// Question Bank Manager – loads questions from JSON/IndexedDB, provides filtering,
// topic lists, and statistics. Works offline and caches in IndexedDB.

(function() {
    'use strict';

    // ==================== Mock Question Data ====================
    // This matches the blueprint's structure and counts.
    // In production, this would be loaded from external JSON files or a CDN.
    const QUESTION_BANK = {
        anatomy: {
            name: 'Anatomy',
            icon: '💀',
            color: '#FF6B6B',
            topics: [
                { id: 'gross-anatomy', name: 'Gross Anatomy', questionCount: 200 },
                { id: 'upper-limb', name: 'Upper Limb', questionCount: 80 },
                { id: 'lower-limb', name: 'Lower Limb', questionCount: 80 },
                { id: 'thorax', name: 'Thorax', questionCount: 60 },
                { id: 'abdomen', name: 'Abdomen', questionCount: 60 },
                { id: 'pelvis-perineum', name: 'Pelvis & Perineum', questionCount: 50 },
                { id: 'head-neck', name: 'Head & Neck', questionCount: 60 },
                { id: 'neuroanatomy', name: 'Neuroanatomy', questionCount: 60 },
                { id: 'cross-sectional', name: 'Cross-Sectional Anatomy', questionCount: 40 },
                { id: 'radiological-anatomy', name: 'Radiological Anatomy', questionCount: 50 }
            ]
        },
        physiology: {
            name: 'Physiology',
            icon: '🧠',
            color: '#4ECDC4',
            topics: [
                { id: 'introduction-homeostasis', name: 'Introduction & Homeostasis', questionCount: 80 },
                { id: 'cell-physiology', name: 'Cell Physiology', questionCount: 120 },
                { id: 'body-fluids', name: 'Body Fluids & Compartments', questionCount: 60 },
                { id: 'cellular-transport', name: 'Cellular Transport', questionCount: 80 },
                { id: 'signal-transduction', name: 'Signal Transduction', questionCount: 70 },
                { id: 'cardiovascular', name: 'Cardiovascular', questionCount: 120 },
                { id: 'renal', name: 'Renal', questionCount: 100 },
                { id: 'respiratory', name: 'Respiratory', questionCount: 80 },
                { id: 'neurophysiology', name: 'Neurophysiology', questionCount: 100 },
                { id: 'endocrine', name: 'Endocrine', questionCount: 80 },
                { id: 'gastrointestinal', name: 'Gastrointestinal', questionCount: 60 },
                { id: 'special-senses', name: 'Special Senses', questionCount: 60 },
                { id: 'reproductive', name: 'Reproductive', questionCount: 50 },
                { id: 'muscle', name: 'Muscle Physiology', questionCount: 50 },
                { id: 'integrative', name: 'Integrative Physiology', questionCount: 40 }
            ]
        },
        biochemistry: {
            name: 'Biochemistry',
            icon: '🧪',
            color: '#45B7D1',
            topics: [
                { id: 'biomolecules', name: 'Biomolecules', questionCount: 100 },
                { id: 'enzymology', name: 'Enzymology', questionCount: 80 },
                { id: 'metabolism', name: 'Metabolism', questionCount: 200 },
                { id: 'bioenergetics', name: 'Bioenergetics', questionCount: 60 },
                { id: 'molecular-biology', name: 'Molecular Biology', questionCount: 150 },
                { id: 'clinical-biochemistry', name: 'Clinical Biochemistry', questionCount: 100 },
                { id: 'nutrition', name: 'Nutrition', questionCount: 50 },
                { id: 'acid-base', name: 'Acid-Base Balance', questionCount: 40 },
                { id: 'techniques', name: 'Biochemical Techniques', questionCount: 30 }
            ]
        },
        histology: {
            name: 'Histology',
            icon: '🔬',
            color: '#96CEB4',
            topics: [
                { id: 'epithelium', name: 'Epithelium', questionCount: 60 },
                { id: 'connective-tissue', name: 'Connective Tissue', questionCount: 70 },
                { id: 'muscle-tissue', name: 'Muscle Tissue', questionCount: 50 },
                { id: 'nervous-tissue', name: 'Nervous Tissue', questionCount: 60 },
                { id: 'cardiovascular-system', name: 'Cardiovascular System', questionCount: 50 },
                { id: 'lymphatic-system', name: 'Lymphatic System', questionCount: 40 },
                { id: 'respiratory-system', name: 'Respiratory System', questionCount: 40 },
                { id: 'digestive-system', name: 'Digestive System', questionCount: 60 },
                { id: 'endocrine-system', name: 'Endocrine System', questionCount: 40 },
                { id: 'urinary-system', name: 'Urinary System', questionCount: 30 },
                { id: 'male-reproductive', name: 'Male Reproductive', questionCount: 30 },
                { id: 'female-reproductive', name: 'Female Reproductive', questionCount: 30 },
                { id: 'skin', name: 'Skin', questionCount: 20 },
                { id: 'special-senses', name: 'Special Senses', questionCount: 30 }
            ]
        },
        embryology: {
            name: 'Embryology',
            icon: '🐣',
            color: '#FFEAA7',
            topics: [
                { id: 'gametogenesis', name: 'Gametogenesis', questionCount: 40 },
                { id: 'fertilization', name: 'Fertilization', questionCount: 30 },
                { id: 'implantation', name: 'Implantation', questionCount: 30 },
                { id: 'bilaminar-disc', name: 'Bilaminar Disc', questionCount: 30 },
                { id: 'trilaminar-disc', name: 'Trilaminar Disc', questionCount: 30 },
                { id: 'neurulation', name: 'Neurulation', questionCount: 40 },
                { id: 'mesoderm', name: 'Mesoderm', questionCount: 40 },
                { id: 'ectoderm', name: 'Ectoderm', questionCount: 30 },
                { id: 'endoderm', name: 'Endoderm', questionCount: 30 },
                { id: 'cardiovascular-embryo', name: 'Cardiovascular', questionCount: 30 },
                { id: 'respiratory-embryo', name: 'Respiratory', questionCount: 20 },
                { id: 'git-embryo', name: 'GIT', questionCount: 30 },
                { id: 'urogenital', name: 'Urogenital', questionCount: 30 },
                { id: 'head-neck-embryo', name: 'Head & Neck', questionCount: 30 },
                { id: 'limb-embryo', name: 'Limbs', questionCount: 20 },
                { id: 'placenta', name: 'Placenta & Fetal Membranes', questionCount: 20 }
            ]
        },
        pathology: {
            name: 'Pathology',
            icon: '🩸',
            color: '#DDA0DD',
            topics: [
                { id: 'cell-injury', name: 'Cell Injury', questionCount: 60 },
                { id: 'inflammation', name: 'Inflammation', questionCount: 70 },
                { id: 'repair', name: 'Repair & Regeneration', questionCount: 40 },
                { id: 'hemodynamics', name: 'Hemodynamics', questionCount: 50 },
                { id: 'genetic-disorders', name: 'Genetic Disorders', questionCount: 40 },
                { id: 'neoplasia', name: 'Neoplasia', questionCount: 70 },
                { id: 'infectious-diseases', name: 'Infectious Diseases', questionCount: 50 },
                { id: 'environmental', name: 'Environmental Pathology', questionCount: 30 },
                { id: 'nutritional', name: 'Nutritional Disorders', questionCount: 30 },
                { id: 'immunopathology', name: 'Immunopathology', questionCount: 50 },
                { id: 'vascular', name: 'Vascular Pathology', questionCount: 40 },
                { id: 'heart', name: 'Heart Pathology', questionCount: 40 },
                { id: 'lung', name: 'Lung Pathology', questionCount: 40 },
                { id: 'git-path', name: 'GIT Pathology', questionCount: 50 },
                { id: 'liver', name: 'Liver & Biliary', questionCount: 40 },
                { id: 'pancreas', name: 'Pancreas', questionCount: 30 },
                { id: 'kidney', name: 'Kidney Pathology', questionCount: 40 },
                { id: 'male-genital', name: 'Male Genital', questionCount: 30 },
                { id: 'female-genital', name: 'Female Genital', questionCount: 30 },
                { id: 'breast', name: 'Breast', questionCount: 30 },
                { id: 'endocrine-path', name: 'Endocrine', questionCount: 30 },
                { id: 'skin-path', name: 'Skin', questionCount: 30 },
                { id: 'bone', name: 'Bone & Joints', questionCount: 30 },
                { id: 'cns', name: 'CNS', questionCount: 30 }
            ]
        },
        pharmacology: {
            name: 'Pharmacology',
            icon: '💊',
            color: '#FDCB6E',
            topics: [
                { id: 'pharmacokinetics', name: 'Pharmacokinetics', questionCount: 50 },
                { id: 'pharmacodynamics', name: 'Pharmacodynamics', questionCount: 50 },
                { id: 'ans', name: 'Autonomic Nervous System', questionCount: 60 },
                { id: 'cns-pharm', name: 'CNS Pharmacology', questionCount: 60 },
                { id: 'cardiovascular-pharm', name: 'Cardiovascular', questionCount: 50 },
                { id: 'renal-pharm', name: 'Renal', questionCount: 30 },
                { id: 'respiratory-pharm', name: 'Respiratory', questionCount: 30 },
                { id: 'git-pharm', name: 'GIT', questionCount: 30 },
                { id: 'endocrine-pharm', name: 'Endocrine', questionCount: 40 },
                { id: 'chemotherapy', name: 'Chemotherapy', questionCount: 60 },
                { id: 'anti-inflammatory', name: 'Anti-inflammatory', questionCount: 30 },
                { id: 'toxicology', name: 'Toxicology', questionCount: 20 },
                { id: 'antibiotics', name: 'Antibiotics', questionCount: 40 },
                { id: 'antivirals', name: 'Antivirals', questionCount: 20 },
                { id: 'antifungals', name: 'Antifungals', questionCount: 20 },
                { id: 'antiparasitics', name: 'Antiparasitics', questionCount: 20 },
                { id: 'immunosuppressants', name: 'Immunosuppressants', questionCount: 20 }
            ]
        },
        microbiology: {
            name: 'Microbiology',
            icon: '🦠',
            color: '#E17055',
            topics: [
                { id: 'bacterial-structure', name: 'Bacterial Structure', questionCount: 30 },
                { id: 'bacterial-genetics', name: 'Bacterial Genetics', questionCount: 30 },
                { id: 'sterilization', name: 'Sterilization & Disinfection', questionCount: 20 },
                { id: 'gram-positive', name: 'Gram-Positive Cocci', questionCount: 30 },
                { id: 'gram-negative', name: 'Gram-Negative Cocci', questionCount: 30 },
                { id: 'gram-positive-bacilli', name: 'Gram-Positive Bacilli', questionCount: 30 },
                { id: 'gram-negative-bacilli', name: 'Gram-Negative Bacilli', questionCount: 40 },
                { id: 'anaerobes', name: 'Anaerobes', questionCount: 20 },
                { id: 'mycobacteria', name: 'Mycobacteria', questionCount: 20 },
                { id: 'spirochetes', name: 'Spirochetes', questionCount: 20 },
                { id: 'virology', name: 'Virology Basics', questionCount: 30 },
                { id: 'dna-viruses', name: 'DNA Viruses', questionCount: 30 },
                { id: 'rna-viruses', name: 'RNA Viruses', questionCount: 40 },
                { id: 'retroviruses', name: 'Retroviruses', questionCount: 20 },
                { id: 'fungi', name: 'Fungi', questionCount: 30 },
                { id: 'parasitology', name: 'Parasitology', questionCount: 40 },
                { id: 'immunology', name: 'Immunology', questionCount: 50 }
            ]
        }
    };

    // ==================== Internal Helpers ====================

    // Cache for loaded questions (to avoid repeated IndexedDB reads)
    let _questionCache = null;
    let _cacheTimestamp = 0;
    const CACHE_TTL = 60000; // 1 minute

    /**
     * Ensure database is available.
     */
    async function ensureDb() {
        if (!window.db) throw new Error('Database module not loaded');
        // Optionally wait for db to be ready (db.js already auto-inits)
    }

    /**
     * Load all questions from IndexedDB (or generate mock if not present).
     * @param {boolean} forceRefresh - bypass cache
     * @returns {Promise<Array>}
     */
    async function loadAllQuestions(forceRefresh = false) {
        await ensureDb();
        const now = Date.now();
        if (!forceRefresh && _questionCache && (now - _cacheTimestamp < CACHE_TTL)) {
            return _questionCache;
        }

        // Try to get from IndexedDB
        let questions = [];
        try {
            questions = await window.db.getQuestions({});
        } catch (e) {
            console.warn('Failed to load questions from DB, using mock', e);
        }

        // If no questions in DB, generate mock data and store it
        if (!questions || questions.length === 0) {
            questions = generateMockQuestions();
            try {
                await window.db.saveQuestions(questions);
                console.log('Mock questions saved to IndexedDB');
            } catch (e) {
                console.warn('Failed to save mock questions to DB', e);
            }
        }

        _questionCache = questions;
        _cacheTimestamp = now;
        return questions;
    }

    /**
     * Generate mock questions based on the topic counts.
     * @returns {Array} Array of question objects.
     */
    function generateMockQuestions() {
        const questions = [];
        let idCounter = 1;
        for (const [subjectId, subject] of Object.entries(QUESTION_BANK)) {
            for (const topic of subject.topics) {
                for (let i = 0; i < topic.questionCount; i++) {
                    const q = {
                        id: `${subjectId}_${topic.id}_${i + 1}`,
                        question: `Sample question ${i+1} for ${subject.name} – ${topic.name}? This is a placeholder.`,
                        options: [
                            `A. Option 1 for ${subject.name}`,
                            `B. Option 2 for ${subject.name}`,
                            `C. Option 3 for ${subject.name}`,
                            `D. Option 4 for ${subject.name}`,
                            `E. Option 5 for ${subject.name}`
                        ],
                        correctAnswer: String.fromCharCode(65 + (i % 5)), // A, B, C, D, E cyclic
                        explanation: `This is the explanation for question ${i+1} in ${topic.name}. The correct answer is ${String.fromCharCode(65 + (i % 5))}.`,
                        subject: subject.name,
                        subjectId: subjectId,
                        topic: topic.name,
                        topicId: topic.id,
                        difficulty: (i % 5) + 1, // 1-5
                        image: null, // no images for mock
                        reference: 'Gray\'s Anatomy, 42nd ed.' // placeholder
                    };
                    questions.push(q);
                }
            }
        }
        // Shuffle to simulate real bank
        return window.utils?.shuffleArray ? window.utils.shuffleArray(questions) : questions;
    }

    // ==================== Public API ====================

    /**
     * Get metadata for a subject (name, icon, color, total questions).
     * @param {string} subjectId - e.g., 'anatomy'
     * @returns {object|null}
     */
    function getSubjectMeta(subjectId) {
        const sub = QUESTION_BANK[subjectId];
        if (!sub) return null;
        return {
            id: subjectId,
            name: sub.name,
            icon: sub.icon,
            color: sub.color,
            questions: sub.topics.reduce((sum, t) => sum + t.questionCount, 0),
            topics: sub.topics.map(t => ({ ...t }))
        };
    }

    /**
     * Get topics for a subject (for subject-specific.html).
     * @param {string} subjectId
     * @returns {Array} Array of topic objects { id, name, questions }
     */
    function getTopicsBySubject(subjectId) {
        const sub = QUESTION_BANK[subjectId];
        return sub ? sub.topics.map(t => ({ id: t.id, name: t.name, questions: t.questionCount })) : [];
    }

    /**
     * Load questions from IndexedDB, optionally filtered.
     * @param {object} filters - { subject, topic, difficulty, limit }
     * @returns {Promise<Array>}
     */
    async function getQuestions(filters = {}) {
        const all = await loadAllQuestions();
        let results = all;

        if (filters.subject) {
            results = results.filter(q => q.subjectId === filters.subject);
        }
        if (filters.topic) {
            results = results.filter(q => q.topicId === filters.topic);
        }
        if (filters.difficulty) {
            results = results.filter(q => q.difficulty === filters.difficulty);
        }
        if (filters.limit) {
            results = results.slice(0, filters.limit);
        }
        return results;
    }

    /**
     * Get a single question by its ID.
     * @param {string} id
     * @returns {Promise<object|null>}
     */
    async function getQuestionById(id) {
        const all = await loadAllQuestions();
        return all.find(q => q.id === id) || null;
    }

    /**
     * Get question count for a subject/topic.
     * @param {string} subjectId
     * @param {string} [topicId] - optional
     * @returns {Promise<number>}
     */
    async function getQuestionCount(subjectId, topicId) {
        const filters = { subject: subjectId };
        if (topicId) filters.topic = topicId;
        const qs = await getQuestions(filters);
        return qs.length;
    }

    /**
     * Search questions by query string.
     * @param {string} query
     * @param {object} filters - additional filters
     * @returns {Promise<Array>}
     */
    async function searchQuestions(query, filters = {}) {
        const all = await getQuestions(filters);
        const lowerQuery = query.toLowerCase();
        return all.filter(q => 
            q.question.toLowerCase().includes(lowerQuery) ||
            q.explanation.toLowerCase().includes(lowerQuery)
        );
    }

    // Filter helpers (synchronous, operate on an array)
    function filterByDifficulty(questions, difficulty) {
        return questions.filter(q => q.difficulty === difficulty);
    }

    function filterByTopic(questions, topicId) {
        return questions.filter(q => q.topicId === topicId);
    }

    function filterBySubject(questions, subjectId) {
        return questions.filter(q => q.subjectId === subjectId);
    }

    // Statistics (for analytics)
    async function getQuestionStatistics(questionId) {
        // In a real app, this would fetch from backend or local usage data.
        // For now, return mock.
        return {
            timesAnswered: Math.floor(Math.random() * 100),
            timesCorrect: Math.floor(Math.random() * 80),
            averageTime: 25 + Math.floor(Math.random() * 20)
        };
    }

    async function updateQuestionStatistics(questionId, result) {
        // Would sync to backend; for now, do nothing.
        console.log('Stat update for', questionId, result);
    }

    async function getMostMissedQuestions(limit = 10) {
        // Mock: return some random questions
        const all = await loadAllQuestions();
        return window.utils?.shuffleArray(all).slice(0, limit) || [];
    }

    // Caching (manual)
    async function cacheQuestions(questions) {
        if (!window.db) throw new Error('DB not available');
        await window.db.saveQuestions(questions);
        _questionCache = questions;
        _cacheTimestamp = Date.now();
    }

    async function getCachedQuestions(key) {
        // Not implemented; key would be used for custom cache segments
        return null;
    }

    function clearQuestionCache() {
        _questionCache = null;
        _cacheTimestamp = 0;
    }

    // Image handling (stubs)
    function loadQuestionImage(imagePath) {
        // In a real app, return image URL or base64
        return imagePath ? `../assets/images/${imagePath}` : null;
    }

    function preloadImages(imagePaths) {
        // Preload images into browser cache
        imagePaths.forEach(path => {
            const img = new Image();
            img.src = loadQuestionImage(path);
        });
    }

    function getImagePath(imageName) {
        return `../assets/images/${imageName}`;
    }

    // ==================== Expose Public API ====================
    window.questions = {
        getSubjectMeta,
        getTopicsBySubject,
        getQuestions,
        getQuestionById,
        getQuestionCount,
        searchQuestions,
        filterByDifficulty,
        filterByTopic,
        filterBySubject,
        getQuestionStatistics,
        updateQuestionStatistics,
        getMostMissedQuestions,
        cacheQuestions,
        getCachedQuestions,
        clearQuestionCache,
        loadQuestionImage,
        preloadImages,
        getImagePath
    };

    // Optionally preload all topics into IndexedDB on first load
    // (already done in loadAllQuestions)
})();
```
// frontend-user/scripts/questions.js

/**
 * Question Bank Manager
 * Loads questions from per‑topic JSON files (data/questions/[subject]/[topic].json).
 * Tries multiple possible paths to work on local, GitHub Pages, and Android.
 */

import * as utils from './utils.js';
import * as db from './db.js';

// ==================== DETECT BASE PATH ====================
const BASE_PATH = (() => {
    const path = window.location.pathname;
    // Remove the page filename and /pages/ if present
    const pagesIndex = path.lastIndexOf('/pages/');
    if (pagesIndex !== -1) {
        return path.substring(0, pagesIndex);
    }
    // If it's a file directly in root, remove filename
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash > 0 && !path.endsWith('/')) {
        return path.substring(0, lastSlash);
    }
    return '';
})();

console.log('[Questions] Base path for JSON:', BASE_PATH);

// ==================== SUBJECT METADATA ====================
const SUBJECT_META = {
    anatomy: { name: 'Anatomy', icon: '💀', color: '#FF6B6B', questions: 720 },
    physiology: { name: 'Physiology', icon: '🧠', color: '#4ECDC4', questions: 1150 },
    biochemistry: { name: 'Biochemistry', icon: '🧪', color: '#45B7D1', questions: 810 },
    histology: { name: 'Histology', icon: '🔬', color: '#96CEB4', questions: 700 },
    embryology: { name: 'Embryology', icon: '🐣', color: '#FFEAA7', questions: 690 },
    pathology: { name: 'Pathology', icon: '🩸', color: '#DDA0DD', questions: 1080 },
    pharmacology: { name: 'Pharmacology', icon: '💊', color: '#FDCB6E', questions: 690 },
    microbiology: { name: 'Microbiology', icon: '🦠', color: '#E17055', questions: 690 }
};

// ==================== COMPLETE TOPICS FROM UPDATED BLUEPRINT ====================
const TOPICS = {
    // ANATOMY - 720 questions, 9 topics
    anatomy: [
        { id: 'introduction-anatomy', name: 'Introduction to Anatomy', questions: 50 },
        { id: 'back', name: 'Back', questions: 50 },
        { id: 'upper-limb', name: 'Upper Limb', questions: 100 },
        { id: 'lower-limb', name: 'Lower Limb', questions: 100 },
        { id: 'thorax', name: 'Thorax', questions: 80 },
        { id: 'abdomen', name: 'Abdomen', questions: 80 },
        { id: 'pelvis-perineum', name: 'Pelvis & Perineum', questions: 60 },
        { id: 'head-neck', name: 'Head & Neck', questions: 100 },
        { id: 'neuroanatomy', name: 'Neuroanatomy', questions: 120 },
        { id: 'cross-sectional-anatomy', name: 'Cross‑Sectional Anatomy', questions: 50 }
    ],

    // PHYSIOLOGY - 1150 questions, 15 topics
    physiology: [
        { id: 'introduction-homeostasis', name: 'Introduction & Homeostasis', questions: 50 },
        { id: 'cell-physiology', name: 'Cell Physiology', questions: 80 },
        { id: 'body-fluids-compartments', name: 'Body Fluids & Compartments', questions: 50 },
        { id: 'cellular-transport', name: 'Cellular Transport', questions: 70 },
        { id: 'membrane-physiology', name: 'Membrane Physiology', questions: 50 },
        { id: 'signal-transduction', name: 'Signal Transduction', questions: 60 },
        { id: 'muscle-physiology', name: 'Muscle Physiology', questions: 70 },
        { id: 'cardiovascular', name: 'Cardiovascular', questions: 150 },
        { id: 'respiratory', name: 'Respiratory', questions: 120 },
        { id: 'renal', name: 'Renal', questions: 120 },
        { id: 'gastrointestinal', name: 'Gastrointestinal', questions: 90 },
        { id: 'endocrine', name: 'Endocrine', questions: 100 },
        { id: 'reproductive', name: 'Reproductive', questions: 60 },
        { id: 'neurophysiology', name: 'Neurophysiology', questions: 120 },
        { id: 'special-senses', name: 'Special Senses', questions: 60 },
        { id: 'integrative-physiology', name: 'Integrative Physiology', questions: 50 }
    ],

    // BIOCHEMISTRY - 810 questions, 17 topics
    biochemistry: [
        { id: 'biomolecules', name: 'Biomolecules', questions: 100 },
        { id: 'amino-acids-proteins', name: 'Amino Acids & Proteins', questions: 60 },
        { id: 'carbohydrates', name: 'Carbohydrates', questions: 60 },
        { id: 'lipids', name: 'Lipids', questions: 60 },
        { id: 'nucleic-acids', name: 'Nucleic Acids', questions: 50 },
        { id: 'enzymology', name: 'Enzymology', questions: 80 },
        { id: 'bioenergetics', name: 'Bioenergetics', questions: 50 },
        { id: 'metabolism-overview', name: 'Metabolism Overview', questions: 50 },
        { id: 'carbohydrate-metabolism', name: 'Carbohydrate Metabolism', questions: 80 },
        { id: 'lipid-metabolism', name: 'Lipid Metabolism', questions: 70 },
        { id: 'protein-metabolism', name: 'Protein Metabolism', questions: 70 },
        { id: 'integration-metabolism', name: 'Integration of Metabolism', questions: 50 },
        { id: 'molecular-biology', name: 'Molecular Biology', questions: 150 },
        { id: 'clinical-biochemistry', name: 'Clinical Biochemistry', questions: 80 },
        { id: 'nutrition', name: 'Nutrition', questions: 60 },
        { id: 'acid-base-balance', name: 'Acid‑Base Balance', questions: 50 },
        { id: 'biochemical-techniques', name: 'Biochemical Techniques', questions: 50 }
    ],

    // HISTOLOGY - 700 questions, 18 topics
    histology: [
        { id: 'introduction-histology', name: 'Introduction to Histology', questions: 50 },
        { id: 'cell-structure', name: 'Cell Structure', questions: 50 },
        { id: 'epithelial-tissue', name: 'Epithelial Tissue', questions: 60 },
        { id: 'connective-tissue', name: 'Connective Tissue', questions: 60 },
        { id: 'cartilage-bone', name: 'Cartilage & Bone', questions: 50 },
        { id: 'adipose-tissue', name: 'Adipose Tissue', questions: 50 },
        { id: 'blood-hematopoiesis', name: 'Blood & Hematopoiesis', questions: 50 },
        { id: 'muscle-tissue', name: 'Muscle Tissue', questions: 60 },
        { id: 'nervous-tissue', name: 'Nervous Tissue', questions: 60 },
        { id: 'cardiovascular-system', name: 'Cardiovascular System', questions: 50 },
        { id: 'lymphatic-system', name: 'Lymphatic System', questions: 50 },
        { id: 'respiratory-system', name: 'Respiratory System', questions: 50 },
        { id: 'digestive-system', name: 'Digestive System', questions: 50 },
        { id: 'endocrine-glands', name: 'Endocrine Glands', questions: 50 },
        { id: 'urinary-system', name: 'Urinary System', questions: 50 },
        { id: 'reproductive-system-male', name: 'Reproductive System (Male)', questions: 50 },
        { id: 'reproductive-system-female', name: 'Reproductive System (Female)', questions: 50 },
        { id: 'skin-integument', name: 'Skin & Integument', questions: 50 }
    ],

    // EMBRYOLOGY - 690 questions, 16 topics
    embryology: [
        { id: 'introduction-embryology', name: 'Introduction to Embryology', questions: 50 },
        { id: 'gametogenesis', name: 'Gametogenesis', questions: 50 },
        { id: 'fertilization', name: 'Fertilization', questions: 50 },
        { id: 'cleavage-implantation', name: 'Cleavage & Implantation', questions: 50 },
        { id: 'embryogenesis-week1-3', name: 'Embryogenesis (Weeks 1‑3)', questions: 60 },
        { id: 'embryogenesis-week3-8', name: 'Embryogenesis (Weeks 3‑8)', questions: 60 },
        { id: 'fetal-development', name: 'Fetal Development', questions: 50 },
        { id: 'placenta-membranes', name: 'Placenta & Fetal Membranes', questions: 50 },
        { id: 'birth-defects-teratology', name: 'Birth Defects & Teratology', questions: 50 },
        { id: 'cardiovascular-development', name: 'Cardiovascular Development', questions: 60 },
        { id: 'nervous-system-development', name: 'Nervous System Development', questions: 60 },
        { id: 'gastrointestinal-development', name: 'Gastrointestinal Development', questions: 60 },
        { id: 'respiratory-development', name: 'Respiratory Development', questions: 50 },
        { id: 'head-neck-development', name: 'Head & Neck Development', questions: 50 },
        { id: 'urogenital-development', name: 'Urogenital Development', questions: 60 },
        { id: 'limb-development', name: 'Limb Development', questions: 50 }
    ],

    // PATHOLOGY - 1080 questions, 27 topics
    pathology: [
        { id: 'introduction-pathology', name: 'Introduction to Pathology', questions: 50 },
        { id: 'cellular-injury', name: 'Cellular Injury', questions: 80 },
        { id: 'adaptations', name: 'Cellular Adaptations', questions: 50 },
        { id: 'intracellular-accumulations', name: 'Intracellular Accumulations', questions: 50 },
        { id: 'inflammation-acute', name: 'Acute Inflammation', questions: 60 },
        { id: 'inflammation-chronic', name: 'Chronic Inflammation', questions: 60 },
        { id: 'repair-regeneration', name: 'Repair & Regeneration', questions: 60 },
        { id: 'hemodynamic-disorders', name: 'Hemodynamic Disorders', questions: 60 },
        { id: 'thrombosis-embolism', name: 'Thrombosis & Embolism', questions: 50 },
        { id: 'shock', name: 'Shock', questions: 50 },
        { id: 'genetic-disorders', name: 'Genetic Disorders', questions: 60 },
        { id: 'immunopathology', name: 'Immunopathology', questions: 70 },
        { id: 'amyloidosis', name: 'Amyloidosis', questions: 50 },
        { id: 'neoplasia', name: 'Neoplasia', questions: 80 },
        { id: 'infectious-diseases', name: 'Infectious Diseases', questions: 60 },
        { id: 'environmental-nutritional', name: 'Environmental & Nutritional', questions: 50 },
        { id: 'cardiovascular-pathology', name: 'Cardiovascular Pathology', questions: 80 },
        { id: 'respiratory-pathology', name: 'Respiratory Pathology', questions: 70 },
        { id: 'gastrointestinal-pathology', name: 'Gastrointestinal Pathology', questions: 70 },
        { id: 'hepatobiliary-pathology', name: 'Hepatobiliary Pathology', questions: 50 },
        { id: 'renal-pathology', name: 'Renal Pathology', questions: 70 },
        { id: 'endocrine-pathology', name: 'Endocrine Pathology', questions: 60 },
        { id: 'reproductive-pathology-male', name: 'Reproductive Pathology (Male)', questions: 50 },
        { id: 'reproductive-pathology-female', name: 'Reproductive Pathology (Female)', questions: 50 },
        { id: 'nervous-system-pathology', name: 'Nervous System Pathology', questions: 70 },
        { id: 'musculoskeletal-pathology', name: 'Musculoskeletal Pathology', questions: 50 }
    ],

    // PHARMACOLOGY - 690 questions, 20 topics
    pharmacology: [
        { id: 'introduction-pharmacology', name: 'Introduction to Pharmacology', questions: 50 },
        { id: 'pharmacokinetics', name: 'Pharmacokinetics', questions: 60 },
        { id: 'pharmacodynamics', name: 'Pharmacodynamics', questions: 60 },
        { id: 'drug-metabolism', name: 'Drug Metabolism', questions: 50 },
        { id: 'drug-interactions', name: 'Drug Interactions', questions: 50 },
        { id: 'autonomic-nervous-system', name: 'Autonomic Nervous System', questions: 80 },
        { id: 'cholinergic-agents', name: 'Cholinergic Agents', questions: 50 },
        { id: 'adrenergic-agents', name: 'Adrenergic Agents', questions: 50 },
        { id: 'cardiovascular-drugs', name: 'Cardiovascular Drugs', questions: 80 },
        { id: 'renal-drugs', name: 'Renal Drugs', questions: 60 },
        { id: 'respiratory-drugs', name: 'Respiratory Drugs', questions: 50 },
        { id: 'gastrointestinal-drugs', name: 'Gastrointestinal Drugs', questions: 50 },
        { id: 'cns-drugs', name: 'CNS Drugs', questions: 70 },
        { id: 'anesthetic-agents', name: 'Anesthetic Agents', questions: 50 },
        { id: 'analgesic-agents', name: 'Analgesic Agents', questions: 50 },
        { id: 'endocrine-drugs', name: 'Endocrine Drugs', questions: 50 },
        { id: 'chemotherapy', name: 'Chemotherapy', questions: 60 },
        { id: 'antimicrobial-drugs', name: 'Antimicrobial Drugs', questions: 60 },
        { id: 'antifungal-antiviral', name: 'Antifungal & Antiviral', questions: 50 },
        { id: 'toxicology', name: 'Toxicology', questions: 60 }
    ],

    // MICROBIOLOGY - 690 questions, 20 topics
    microbiology: [
        { id: 'introduction-microbiology', name: 'Introduction to Microbiology', questions: 50 },
        { id: 'bacterial-structure', name: 'Bacterial Structure', questions: 50 },
        { id: 'bacterial-physiology', name: 'Bacterial Physiology', questions: 50 },
        { id: 'bacterial-genetics', name: 'Bacterial Genetics', questions: 60 },
        { id: 'sterilization-disinfection', name: 'Sterilization & Disinfection', questions: 50 },
        { id: 'bacteriology', name: 'Bacteriology', questions: 120 },
        { id: 'gram-positive-cocci', name: 'Gram‑Positive Cocci', questions: 50 },
        { id: 'gram-positive-bacilli', name: 'Gram‑Positive Bacilli', questions: 50 },
        { id: 'gram-negative-cocci', name: 'Gram‑Negative Cocci', questions: 50 },
        { id: 'gram-negative-bacilli', name: 'Gram‑Negative Bacilli', questions: 60 },
        { id: 'anaerobic-bacteria', name: 'Anaerobic Bacteria', questions: 50 },
        { id: 'mycobacteria', name: 'Mycobacteria', questions: 50 },
        { id: 'spirochetes', name: 'Spirochetes', questions: 50 },
        { id: 'virology', name: 'Virology', questions: 100 },
        { id: 'mycology', name: 'Mycology', questions: 60 },
        { id: 'parasitology', name: 'Parasitology', questions: 70 },
        { id: 'immunology', name: 'Immunology', questions: 80 },
        { id: 'antimicrobial-therapy', name: 'Antimicrobial Therapy', questions: 70 },
        { id: 'infection-control', name: 'Infection Control', questions: 60 }
    ]
};


// ==================== HELPER: Try multiple paths for JSON ====================
async function fetchWithFallbacks(urls) {
    let lastError = null;
    for (const url of urls) {
        try {
            console.log(`[Questions] Trying: ${url}`);
            const response = await fetch(url);
            if (response.ok) {
                return await response.json();
            } else {
                lastError = new Error(`HTTP ${response.status} for ${url}`);
            }
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error('All fetch attempts failed');
}

async function loadTopicQuestions(subject, topicId) {
    const currentPath = window.location.pathname;
    // Determine possible base paths
    let baseDir = currentPath.substring(0, currentPath.lastIndexOf('/') + 1); // includes final slash

    const possibleUrls = [
        // 1. Absolute from root (local dev, /data/...)
        `/data/questions/${subject}/${topicId}.json`,
        // 2. Relative to current page (if in pages folder, go up one)
        `../data/questions/${subject}/${topicId}.json`,
        // 3. Relative to current page (if in root, data/...)
        `data/questions/${subject}/${topicId}.json`,
        // 4. Using baseDir (GitHub Pages subdirectory)
        baseDir + `data/questions/${subject}/${topicId}.json`,
        // 5. Using baseDir without trailing slash
        baseDir.replace(/\/$/, '') + `/data/questions/${subject}/${topicId}.json`,
        // 6. Using location.origin
        window.location.origin + `/data/questions/${subject}/${topicId}.json`,
        // 7. Using origin + baseDir (if subdir)
        window.location.origin + baseDir + `data/questions/${subject}/${topicId}.json`,
        // 8. Using repo name from path (if GitHub Pages)
        (() => {
            const parts = currentPath.split('/');
            if (parts.length >= 2 && parts[1] !== 'pages') {
                return `/${parts[1]}/data/questions/${subject}/${topicId}.json`;
            }
            return null;
        })(),
        // 9. Another variation
        (() => {
            const parts = currentPath.split('/');
            if (parts.length >= 3 && parts[1] !== 'pages') {
                return `/${parts[1]}/pages/../data/questions/${subject}/${topicId}.json`;
            }
            return null;
        })()
    ].filter(url => url !== null); // remove nulls

    const questions = await fetchWithFallbacks(possibleUrls);
    return questions.map(q => ({
        ...q,
        subject,
        topic: topicId
    }));
}

// ==================== PUBLIC API ====================

export function getSubjectMeta(subjectId) {
    return SUBJECT_META[subjectId] || { name: subjectId, icon: '📚', color: '#888', questions: 0 };
}

export function getTopicsBySubject(subjectId) {
    return TOPICS[subjectId] || [];
}

export async function getQuestionsForExam(config) {
    const { subject, topics: selectedTopics, questionCount } = config;

    if (!subject) throw new Error('Subject missing in exam config');
    if (!selectedTopics || selectedTopics.length === 0) throw new Error('No topics selected');
    if (!questionCount || questionCount < 1) throw new Error('Invalid question count');

    // Check which topics are already cached in IndexedDB
    const cachedTopics = {};
    for (const topic of selectedTopics) {
        const existing = await db.getQuestions({ subject, topic: topic.id });
        if (existing && existing.length > 0) {
            cachedTopics[topic.id] = existing;
        }
    }

    // Load missing topics from JSON
    const loadPromises = selectedTopics.map(async (topic) => {
        if (cachedTopics[topic.id]) return cachedTopics[topic.id];
        const questions = await loadTopicQuestions(subject, topic.id);
        await db.saveQuestions(questions);
        return questions;
    });

    const topicQuestionArrays = await Promise.all(loadPromises);
    const allQuestions = topicQuestionArrays.flat();

    if (allQuestions.length === 0) {
        throw new Error('No questions available for the selected topics');
    }

    // Get seen question IDs per topic
    const seenPerTopic = {};
    for (const topic of selectedTopics) {
        seenPerTopic[topic.id] = await db.getSeenQuestions(subject, topic.id);
    }

    // Separate unseen
    const unseen = allQuestions.filter(q => !seenPerTopic[q.topic]?.has(q.id));

    let finalQuestions = [];

    if (unseen.length >= questionCount) {
        const shuffled = utils.shuffleArray(unseen);
        finalQuestions = shuffled.slice(0, questionCount);
    } else {
        console.log(`[Questions] Not enough unseen (${unseen.length} < ${questionCount}), resetting seen for topics.`);
        for (const topic of selectedTopics) {
            await db.clearSeenQuestions(subject, topic.id);
        }
        const shuffled = utils.shuffleArray(allQuestions);
        finalQuestions = shuffled.slice(0, questionCount);
    }

    // Apply difficulty filter if needed
    if (config.difficulty && config.difficulty !== 'mixed') {
        const diffMap = { easy: 1, medium: 2, hard: 3, expert: 4 };
        const level = diffMap[config.difficulty];
        if (level) {
            finalQuestions = finalQuestions.filter(q => q.difficulty === level);
        }
    }

    return finalQuestions;
}

export async function getQuestionsByIds(ids) {
    const all = await db.getAllQuestions();
    return all.filter(q => ids.includes(q.id));
}
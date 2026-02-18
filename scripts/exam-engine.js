// frontend-user/scripts/exam-engine.js

/**
 * Core Exam Engine
 * Manages exam lifecycle: question selection, answers, navigation,
 * auto-save, results calculation, and records seen questions.
 */

import * as utils from './utils.js';
import * as questions from './questions.js';
import * as db from './db.js';
import * as ui from './ui.js';

// Internal state (not exported)
let examState = {
    config: null,
    questions: [],          // array of question objects
    answers: [],            // array of { selectedOption, timeSpent, flagged }
    currentIndex: 0,
    startTime: null,
    isFinished: false,
    examId: null
};

// ==================== Initialization ====================

/**
 * Create a new exam based on configuration.
 * @param {Object} config - from app.getExamConfig()
 * @returns {Promise<void>}
 */
export async function createExam(config) {
    if (!config) throw new Error('No exam configuration provided');
    examState.config = { ...config };
    examState.startTime = Date.now();
    examState.examId = 'exam_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
    examState.currentIndex = 0;
    examState.isFinished = false;

    // Load questions from questions.js
    const questionList = await questions.getQuestionsForExam(config);
    if (!questionList || questionList.length === 0) {
        throw new Error('No questions available for the selected topics');
    }
    examState.questions = questionList;
    examState.answers = questionList.map(() => ({
        selectedOption: null,
        timeSpent: 0,
        flagged: false
    }));
}

export function startExam() {
    // Nothing extra needed – exam is ready
}

// ==================== Getters ====================

export function getCurrentQuestion() {
    if (examState.isFinished || !examState.questions.length) return null;
    return examState.questions[examState.currentIndex];
}

export function getCurrentAnswer() {
    return examState.answers[examState.currentIndex];
}

export function getSubject() {
    return examState.config?.subject || 'Unknown';
}

export function totalQuestions() {
    return examState.questions.length;
}

export function currentIndex() {
    return examState.currentIndex;
}

export function hasNext() {
    return examState.currentIndex < examState.questions.length - 1;
}

export function hasPrev() {
    return examState.currentIndex > 0;
}

/**
 * Get the state of a question (answered, flagged, visited).
 * @param {number} index
 * @returns {Object}
 */
export function getQuestionState(index) {
    const answer = examState.answers[index];
    return {
        answered: !!answer?.selectedOption,
        flagged: answer?.flagged || false,
        visited: answer?.timeSpent > 0 || index < examState.currentIndex // approximate
    };
}

// ==================== Actions ====================

export function submitAnswer(selectedOption, timeSpent) {
    if (examState.isFinished) return;
    const answer = examState.answers[examState.currentIndex];
    answer.selectedOption = selectedOption;
    answer.timeSpent = timeSpent;
}

export function toggleCurrentFlag() {
    if (examState.isFinished) return false;
    const answer = examState.answers[examState.currentIndex];
    answer.flagged = !answer.flagged;
    return answer.flagged;
}

export function isCurrentQuestionFlagged() {
    return examState.answers[examState.currentIndex]?.flagged || false;
}

export function next() {
    if (examState.isFinished) return false;
    if (hasNext()) {
        examState.currentIndex++;
        return true;
    }
    return false;
}

export function prev() {
    if (examState.isFinished) return false;
    if (hasPrev()) {
        examState.currentIndex--;
        return true;
    }
    return false;
}

export function goTo(index) {
    if (examState.isFinished) return false;
    if (index >= 0 && index < examState.questions.length) {
        examState.currentIndex = index;
        return true;
    }
    return false;
}

// ==================== Auto‑save ====================

export async function autoSave() {
    if (examState.isFinished) return;
    const progress = {
        examId: examState.examId,
        config: examState.config,
        questions: examState.questions.map(q => q.id),
        answers: examState.answers,
        currentIndex: examState.currentIndex,
        startTime: examState.startTime,
        timeSpent: Date.now() - examState.startTime
    };
    await db.saveExamProgress(progress).catch(err => console.warn('Auto-save failed', err));
}

export async function loadSavedExam() {
    const saved = await db.getExamProgress();
    if (!saved) return null;

    // Restore questions from IDs
    const questionList = await questions.getQuestionsByIds(saved.questions);
    if (!questionList || questionList.length === 0) return null;

    examState.examId = saved.examId;
    examState.config = saved.config;
    examState.questions = questionList;
    examState.answers = saved.answers;
    examState.currentIndex = saved.currentIndex;
    examState.startTime = saved.startTime;
    examState.isFinished = false;
    return examState.config;
}

// ==================== Finish & Results ====================

export async function endExam() {
    examState.isFinished = true;
    const totalTime = Date.now() - examState.startTime;

    // Calculate results
    const results = {
        examId: examState.examId,
        subject: examState.config.subject,
        mode: examState.config.mode,
        date: new Date().toISOString(),
        totalQuestions: examState.questions.length,
        correctAnswers: 0,
        scorePercentage: 0,
        timeSpent: totalTime,
        averageTimePerQuestion: totalTime / examState.questions.length / 1000,
        questions: [],
        topics: [],
        weakAreas: []
    };

    const topicMap = {};

    examState.questions.forEach((q, idx) => {
        const answer = examState.answers[idx];
        const isCorrect = answer.selectedOption === q.correct;
        if (isCorrect) results.correctAnswers++;

        const qResult = {
            id: q.id,
            question: q.question,
            options: q.options,
            correctAnswer: q.correct,
            userAnswer: answer.selectedOption,
            timeSpent: answer.timeSpent,
            correct: isCorrect,
            explanation: q.explanation,
            topic: q.topic,
            difficulty: q.difficulty,
            flagged: answer.flagged
        };
        results.questions.push(qResult);

        // Topic statistics
        if (!topicMap[q.topic]) {
            topicMap[q.topic] = { total: 0, correct: 0, totalTime: 0 };
        }
        topicMap[q.topic].total++;
        if (isCorrect) topicMap[q.topic].correct++;
        topicMap[q.topic].totalTime += answer.timeSpent;
    });

    results.scorePercentage = (results.correctAnswers / results.totalQuestions) * 100;

    // Format topic performance
    results.topics = Object.entries(topicMap).map(([topic, data]) => ({
        topic,
        questions: data.total,
        correct: data.correct,
        percentage: (data.correct / data.total) * 100,
        averageTime: data.totalTime / data.total
    }));

    // Identify weak areas (<70%)
    results.weakAreas = results.topics.filter(t => t.percentage < 70).map(t => t.topic);

    // Save to database
    await db.saveExamResult(results);

    // Record seen questions for repetition prevention
    const questionIds = results.questions.map(q => q.id);
    // Group by topic
    const byTopic = {};
    results.questions.forEach(q => {
        if (!byTopic[q.topic]) byTopic[q.topic] = [];
        byTopic[q.topic].push(q.id);
    });
    for (const [topic, ids] of Object.entries(byTopic)) {
        await db.addSeenQuestions(results.subject, ids, topic);
    }

    return results;
}

// ==================== Export ====================

export const examEngine = {
    createExam,
    startExam,
    getCurrentQuestion,
    getCurrentAnswer,
    submitAnswer,
    toggleCurrentFlag,
    isCurrentQuestionFlagged,
    next,
    prev,
    goTo,
    getQuestionState,
    hasNext,
    hasPrev,
    totalQuestions,
    currentIndex,
    getSubject,
    autoSave,
    loadSavedExam,
    endExam
};
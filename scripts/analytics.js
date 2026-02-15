// frontend-user/scripts/analytics.js

/**
 * Performance Analytics Module
 * Calculates exam statistics, subject progress, weak areas, trends, and recommendations.
 * All data is derived from exam results stored in IndexedDB.
 */

import * as utils from './utils.js';
import * as db from './db.js';

// ==================== CONSTANTS ====================

const MASTERY_THRESHOLDS = {
    EXPERT: 90,
    ADVANCED: 80,
    INTERMEDIATE: 70,
    BEGINNER: 60
};

// ==================== SUBJECT PROGRESS ====================

/**
 * Get progress percentage for each subject based on completed exams.
 * @returns {Promise<Object>} e.g., { anatomy: 35, physiology: 42, ... }
 */
export async function getSubjectProgress() {
    try {
        const exams = await db.getAllExamResults();
        if (!exams || exams.length === 0) return {};

        const subjectStats = {};

        exams.forEach(exam => {
            const subject = exam.subject;
            if (!subject) return;

            if (!subjectStats[subject]) {
                subjectStats[subject] = {
                    totalQuestions: 0,
                    correct: 0
                };
            }

            subjectStats[subject].totalQuestions += exam.totalQuestions || 0;
            subjectStats[subject].correct += exam.correctAnswers || 0;
        });

        const progress = {};
        Object.entries(subjectStats).forEach(([subject, stats]) => {
            progress[subject] = Math.round((stats.correct / stats.totalQuestions) * 100) || 0;
        });

        return progress;
    } catch (e) {
        console.warn('getSubjectProgress failed', e);
        return {};
    }
}

// ==================== RECENT TOPICS ====================

/**
 * Get recent topics studied for a subject.
 * @param {string} subjectId
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getRecentTopics(subjectId, limit = 3) {
    try {
        const exams = await db.getAllExamResults();
        if (!exams || exams.length === 0) return [];

        // Filter by subject and sort by date descending
        const subjectExams = exams
            .filter(exam => exam.subject === subjectId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        // Collect unique topics from recent exams
        const topicsMap = new Map();
        subjectExams.forEach(exam => {
            if (exam.topics && Array.isArray(exam.topics)) {
                exam.topics.forEach(topic => {
                    if (!topicsMap.has(topic.id)) {
                        topicsMap.set(topic.id, {
                            subjectId,
                            topicId: topic.id,
                            topicName: topic.name,
                            questions: topic.questions || 0,
                            lastStudied: exam.date
                        });
                    }
                });
            }
        });

        // Convert to array, sort by lastStudied, take limit
        const topics = Array.from(topicsMap.values())
            .sort((a, b) => new Date(b.lastStudied) - new Date(a.lastStudied))
            .slice(0, limit);

        return topics;
    } catch (e) {
        console.warn('getRecentTopics failed', e);
        return [];
    }
}

// ==================== WEAK AREAS ====================

/**
 * Identify weak areas (topics/subjects with score < 70%).
 * @returns {Promise<Array>}
 */
export async function identifyWeakAreas() {
    try {
        const exams = await db.getAllExamResults();
        if (!exams || exams.length === 0) return [];

        const topicStats = {};

        exams.forEach(exam => {
            if (!exam.questions || !Array.isArray(exam.questions)) return;

            exam.questions.forEach(q => {
                const topic = q.topic;
                if (!topic) return;

                if (!topicStats[topic]) {
                    topicStats[topic] = {
                        total: 0,
                        correct: 0
                    };
                }

                topicStats[topic].total++;
                if (q.correct) topicStats[topic].correct++;
            });
        });

        const weakAreas = [];
        Object.entries(topicStats).forEach(([topic, stats]) => {
            const percentage = (stats.correct / stats.total) * 100;
            if (percentage < 70) {
                weakAreas.push({
                    topic,
                    score: percentage,
                    questions: stats.total,
                    priority: percentage < 50 ? 'high' : 'medium'
                });
            }
        });

        // Sort by score ascending (worst first)
        return weakAreas.sort((a, b) => a.score - b.score);
    } catch (e) {
        console.warn('identifyWeakAreas failed', e);
        return [];
    }
}

// ==================== ANALYTICS CALCULATIONS ====================

/**
 * Calculate comprehensive analytics from all exam results.
 * @param {Array} results - exam results array (optional, if not provided, fetches from DB)
 * @returns {Promise<Object>}
 */
export async function calculateAllAnalytics(results = null) {
    try {
        const exams = results || (await db.getAllExamResults()) || [];

        return {
            summary: calculateSummary(exams),
            trends: calculateTrends(exams),
            subjectAnalysis: analyzeSubjects(exams),
            studyPatterns: analyzeStudyPatterns(exams),
            weakAreas: await identifyWeakAreas(),
            recommendations: generateRecommendations(exams)
        };
    } catch (e) {
        console.warn('calculateAllAnalytics failed', e);
        return {
            summary: {},
            trends: [],
            subjectAnalysis: [],
            studyPatterns: {},
            weakAreas: [],
            recommendations: []
        };
    }
}

function calculateSummary(exams) {
    if (!exams.length) {
        return {
            totalExams: 0,
            totalQuestions: 0,
            averageScore: 0,
            totalStudyTime: 0,
            bestScore: 0,
            worstScore: 0
        };
    }

    const totalExams = exams.length;
    const totalQuestions = exams.reduce((sum, e) => sum + (e.totalQuestions || 0), 0);
    const totalCorrect = exams.reduce((sum, e) => sum + (e.correctAnswers || 0), 0);
    const averageScore = totalQuestions ? (totalCorrect / totalQuestions) * 100 : 0;
    const totalStudyTime = exams.reduce((sum, e) => sum + (e.timeSpent || 0), 0) / 60; // minutes
    const scores = exams.map(e => e.scorePercentage || 0);
    const bestScore = Math.max(...scores, 0);
    const worstScore = Math.min(...scores, 0);

    return {
        totalExams,
        totalQuestions,
        averageScore: Math.round(averageScore),
        totalStudyTime: Math.round(totalStudyTime),
        bestScore: Math.round(bestScore),
        worstScore: Math.round(worstScore)
    };
}

function calculateTrends(exams) {
    if (!exams.length) return [];

    // Group by date (YYYY-MM-DD)
    const grouped = {};
    exams.forEach(exam => {
        const date = exam.date ? exam.date.split('T')[0] : 'unknown';
        if (!grouped[date]) {
            grouped[date] = { scores: [], totalQuestions: 0, time: 0 };
        }
        grouped[date].scores.push(exam.scorePercentage || 0);
        grouped[date].totalQuestions += exam.totalQuestions || 0;
        grouped[date].time += exam.timeSpent || 0;
    });

    return Object.entries(grouped)
        .map(([date, data]) => ({
            date,
            score: data.scores.reduce((a, b) => a + b, 0) / data.scores.length,
            questions: data.totalQuestions,
            time: data.time / 60 // minutes
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

function analyzeSubjects(exams) {
    if (!exams.length) return [];

    const subjectData = {};

    exams.forEach(exam => {
        const subject = exam.subject;
        if (!subject) return;

        if (!subjectData[subject]) {
            subjectData[subject] = {
                exams: 0,
                questions: 0,
                correct: 0,
                time: 0
            };
        }

        subjectData[subject].exams++;
        subjectData[subject].questions += exam.totalQuestions || 0;
        subjectData[subject].correct += exam.correctAnswers || 0;
        subjectData[subject].time += exam.timeSpent || 0;
    });

    return Object.entries(subjectData).map(([subject, data]) => {
        const percentage = data.questions ? (data.correct / data.questions) * 100 : 0;
        return {
            subject,
            exams: data.exams,
            questions: data.questions,
            correct: data.correct,
            percentage: Math.round(percentage),
            averageTime: data.questions ? Math.round(data.time / data.questions) : 0,
            mastery: calculateMasteryLevel(percentage)
        };
    });
}

function calculateMasteryLevel(percentage) {
    if (percentage >= MASTERY_THRESHOLDS.EXPERT) return 'expert';
    if (percentage >= MASTERY_THRESHOLDS.ADVANCED) return 'advanced';
    if (percentage >= MASTERY_THRESHOLDS.INTERMEDIATE) return 'intermediate';
    if (percentage >= MASTERY_THRESHOLDS.BEGINNER) return 'beginner';
    return 'needs-work';
}

function analyzeStudyPatterns(exams) {
    if (!exams.length) return {};

    const byDay = {
        Monday: { count: 0, totalScore: 0 },
        Tuesday: { count: 0, totalScore: 0 },
        Wednesday: { count: 0, totalScore: 0 },
        Thursday: { count: 0, totalScore: 0 },
        Friday: { count: 0, totalScore: 0 },
        Saturday: { count: 0, totalScore: 0 },
        Sunday: { count: 0, totalScore: 0 }
    };

    const byHour = Array(24).fill().map(() => ({ count: 0, totalScore: 0 }));

    exams.forEach(exam => {
        if (!exam.date) return;
        const date = new Date(exam.date);
        if (isNaN(date)) return;

        const day = date.toLocaleDateString('en-US', { weekday: 'long' });
        const hour = date.getHours();

        if (byDay[day]) {
            byDay[day].count++;
            byDay[day].totalScore += exam.scorePercentage || 0;
        }

        if (byHour[hour]) {
            byHour[hour].count++;
            byHour[hour].totalScore += exam.scorePercentage || 0;
        }
    });

    let bestDay = null;
    let bestDayScore = 0;
    Object.entries(byDay).forEach(([day, data]) => {
        if (data.count > 0) {
            const avg = data.totalScore / data.count;
            if (avg > bestDayScore) {
                bestDayScore = avg;
                bestDay = day;
            }
        }
    });

    let bestHour = null;
    let bestHourScore = 0;
    byHour.forEach((data, hour) => {
        if (data.count > 0) {
            const avg = data.totalScore / data.count;
            if (avg > bestHourScore) {
                bestHourScore = avg;
                bestHour = hour;
            }
        }
    });

    const totalDays = 30; // Look back 30 days
    const uniqueDays = new Set(exams.map(e => e.date?.split('T')[0])).size;
    const consistency = Math.min(100, (uniqueDays / totalDays) * 100);

    const totalTime = exams.reduce((sum, e) => sum + (e.timeSpent || 0), 0);
    const avgSession = totalTime / exams.length / 60;

    return {
        bestDay,
        bestDayScore: Math.round(bestDayScore),
        bestHour,
        bestHourScore: Math.round(bestHourScore),
        averageSessionTime: Math.round(avgSession),
        consistency: Math.round(consistency),
        streak: calculateStreak(exams)
    };
}

function calculateStreak(exams) {
    if (!exams.length) return 0;

    const dates = exams
        .map(e => e.date?.split('T')[0])
        .filter(d => d)
        .sort((a, b) => new Date(b) - new Date(a));

    if (dates.length === 0) return 0;

    let streak = 1;
    let currentDate = new Date(dates[0]);

    for (let i = 1; i < dates.length; i++) {
        const prevDate = new Date(dates[i - 1]);
        const thisDate = new Date(dates[i]);
        const diffDays = Math.round((prevDate - thisDate) / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            streak++;
        } else if (diffDays > 1) {
            break;
        }
    }

    return streak;
}

function generateRecommendations(exams) {
    const recommendations = [];

    if (!exams.length) {
        recommendations.push({
            type: 'info',
            message: 'Take your first exam to get personalized recommendations!'
        });
        return recommendations;
    }

    const weakAreas = identifyWeakAreasSync(exams);
    if (weakAreas.length > 0) {
        weakAreas.slice(0, 3).forEach(area => {
            recommendations.push({
                type: 'focus_subject',
                subject: area.topic,
                currentScore: Math.round(area.score),
                targetScore: 80,
                priority: area.priority,
                action: `Focus on ${area.topic} – your score is ${Math.round(area.score)}%.`
            });
        });
    }

    const avgTime = exams.reduce((sum, e) => sum + (e.averageTimePerQuestion || 0), 0) / exams.length;
    if (avgTime > 45) {
        recommendations.push({
            type: 'time_management',
            issue: 'Answering questions too slowly',
            current: `${Math.round(avgTime)}s per question`,
            target: '30s',
            priority: 'medium',
            action: 'Practice with timed quizzes focusing on speed.'
        });
    }

    const streak = calculateStreak(exams);
    if (streak < 3) {
        recommendations.push({
            type: 'consistency',
            issue: 'Inconsistent study habits',
            current: `${streak} day streak`,
            target: '7+ days',
            priority: 'medium',
            action: 'Set daily reminder for 20-minute study sessions.'
        });
    }

    return recommendations;
}

function identifyWeakAreasSync(exams) {
    const topicStats = {};

    exams.forEach(exam => {
        if (!exam.questions || !Array.isArray(exam.questions)) return;
        exam.questions.forEach(q => {
            const topic = q.topic;
            if (!topic) return;
            if (!topicStats[topic]) {
                topicStats[topic] = { total: 0, correct: 0 };
            }
            topicStats[topic].total++;
            if (q.correct) topicStats[topic].correct++;
        });
    });

    const weak = [];
    Object.entries(topicStats).forEach(([topic, stats]) => {
        const percentage = (stats.correct / stats.total) * 100;
        if (percentage < 70) {
            weak.push({
                topic,
                score: percentage,
                priority: percentage < 50 ? 'high' : 'medium'
            });
        }
    });

    return weak.sort((a, b) => a.score - b.score);
}

// ==================== EXPORT ====================

export {
    calculateSummary,
    calculateTrends,
    analyzeSubjects,
    analyzeStudyPatterns,
    generateRecommendations,
    calculateStreak
};

// ==================== EXPOSE GLOBALLY ====================

window.analytics = {
    getSubjectProgress,
    getRecentTopics,
    identifyWeakAreas,
    calculateAllAnalytics,
    calculateSummary,
    calculateTrends,
    analyzeSubjects,
    analyzeStudyPatterns,
    generateRecommendations,
    calculateStreak
};
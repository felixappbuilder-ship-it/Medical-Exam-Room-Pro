// scripts/analytics.js

/**
 * Performance Analytics for Medical Exam Room Pro
 * Handles exam results analysis, progress tracking, and study recommendations
 * 
 * Features implemented:
 * - Score calculation & statistics
 * - Time analysis per question/topic
 * - Weak area identification
 * - Progress charts & graphs
 * - Comparison with peers (anonymous)
 * - Study recommendations
 * - Performance predictions
 */

class AnalyticsManager {
    constructor() {
        this.userId = null;
        this.stats = {
            overall: {},
            bySubject: {},
            byTopic: {},
            byDifficulty: {},
            trends: {},
            predictions: {}
        };
        
        this.weakAreas = [];
        this.recommendations = [];
        this.progressData = [];
        
        // Initialize
        this.init();
    }
    
    /**
     * Initialize analytics manager
     */
    async init() {
        // Get user ID from localStorage
        const userData = JSON.parse(localStorage.getItem('userData') || '{}');
        this.userId = userData.id || 'anonymous';
        
        // Load existing analytics
        await this.loadAnalytics();
        
        console.log('Analytics manager initialized');
    }
    
    /**
     * Load analytics data
     */
    async loadAnalytics() {
        try {
            // Load from IndexedDB if available
            if (typeof db !== 'undefined' && db.getAnalytics) {
                const analytics = await db.getAnalytics('performance', null, null, 1000);
                this.processAnalyticsData(analytics);
            }
            
            // Load from localStorage as backup
            const savedStats = localStorage.getItem('analytics_stats');
            if (savedStats) {
                this.stats = JSON.parse(savedStats);
            }
            
            const savedWeakAreas = localStorage.getItem('analytics_weak_areas');
            if (savedWeakAreas) {
                this.weakAreas = JSON.parse(savedWeakAreas);
            }
            
            const savedRecommendations = localStorage.getItem('analytics_recommendations');
            if (savedRecommendations) {
                this.recommendations = JSON.parse(savedRecommendations);
            }
            
        } catch (error) {
            console.error('Error loading analytics:', error);
            this.resetStats();
        }
    }
    
    /**
     * Save analytics data
     */
    async saveAnalytics() {
        try {
            // Save to IndexedDB
            if (typeof db !== 'undefined' && db.saveAnalytics) {
                await db.saveAnalytics({
                    type: 'analytics_summary',
                    timestamp: new Date().toISOString(),
                    userId: this.userId,
                    stats: this.stats,
                    weakAreas: this.weakAreas,
                    recommendations: this.recommendations
                });
            }
            
            // Save to localStorage
            localStorage.setItem('analytics_stats', JSON.stringify(this.stats));
            localStorage.setItem('analytics_weak_areas', JSON.stringify(this.weakAreas));
            localStorage.setItem('analytics_recommendations', JSON.stringify(this.recommendations));
            
        } catch (error) {
            console.error('Error saving analytics:', error);
        }
    }
    
    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            overall: {
                totalExams: 0,
                averageScore: 0,
                bestScore: 0,
                worstScore: 100,
                totalQuestions: 0,
                correctAnswers: 0,
                totalTime: 0,
                averageTimePerQuestion: 0,
                consistency: 0
            },
            bySubject: {},
            byTopic: {},
            byDifficulty: {
                Easy: { total: 0, correct: 0, averageTime: 0 },
                Medium: { total: 0, correct: 0, averageTime: 0 },
                Hard: { total: 0, correct: 0, averageTime: 0 },
                Expert: { total: 0, correct: 0, averageTime: 0 }
            },
            trends: {
                daily: [],
                weekly: [],
                monthly: []
            },
            predictions: {
                nextExamScore: 0,
                studyHoursNeeded: 0,
                readinessScore: 0
            }
        };
        
        this.weakAreas = [];
        this.recommendations = [];
    }
    
    /**
     * Process exam results
     */
    async processExamResults(examResults) {
        if (!examResults || !examResults.detailedResults) {
            console.error('Invalid exam results');
            return;
        }
        
        try {
            // Update overall statistics
            this.updateOverallStats(examResults);
            
            // Update subject statistics
            this.updateSubjectStats(examResults);
            
            // Update topic statistics
            this.updateTopicStats(examResults);
            
            // Update difficulty statistics
            this.updateDifficultyStats(examResults);
            
            // Update trends
            this.updateTrends(examResults);
            
            // Identify weak areas
            await this.identifyWeakAreas(examResults);
            
            // Generate recommendations
            await this.generateRecommendations();
            
            // Make predictions
            this.makePredictions();
            
            // Save updated analytics
            await this.saveAnalytics();
            
            console.log('Exam results processed successfully');
            
        } catch (error) {
            console.error('Error processing exam results:', error);
        }
    }
    
    /**
     * Update overall statistics
     */
    updateOverallStats(examResults) {
        const stats = this.stats.overall;
        
        stats.totalExams = (stats.totalExams || 0) + 1;
        stats.totalQuestions = (stats.totalQuestions || 0) + examResults.totalQuestions;
        stats.correctAnswers = (stats.correctAnswers || 0) + examResults.correctAnswers;
        stats.totalTime = (stats.totalTime || 0) + examResults.totalTime;
        
        // Calculate average score
        const totalScore = (stats.averageScore || 0) * (stats.totalExams - 1) + examResults.score;
        stats.averageScore = Math.round(totalScore / stats.totalExams);
        
        // Update best/worst scores
        if (examResults.score > stats.bestScore) {
            stats.bestScore = examResults.score;
        }
        if (examResults.score < stats.worstScore) {
            stats.worstScore = examResults.score;
        }
        
        // Calculate average time per question
        if (stats.totalQuestions > 0) {
            stats.averageTimePerQuestion = Math.round(stats.totalTime / stats.totalQuestions);
        }
        
        // Calculate consistency (standard deviation of last 10 scores)
        this.calculateConsistency();
    }
    
    /**
     * Update subject statistics
     */
    updateSubjectStats(examResults) {
        const subjectPerformance = examResults.performanceBySubject || {};
        
        Object.keys(subjectPerformance).forEach(subject => {
            if (!this.stats.bySubject[subject]) {
                this.stats.bySubject[subject] = {
                    totalQuestions: 0,
                    correctAnswers: 0,
                    totalTime: 0,
                    averageScore: 0,
                    examsTaken: 0,
                    lastScore: 0,
                    improvement: 0
                };
            }
            
            const subjectStats = this.stats.bySubject[subject];
            const currentPerf = subjectPerformance[subject];
            
            subjectStats.examsTaken = (subjectStats.examsTaken || 0) + 1;
            subjectStats.totalQuestions = (subjectStats.totalQuestions || 0) + currentPerf.total;
            subjectStats.correctAnswers = (subjectStats.correctAnswers || 0) + currentPerf.correct;
            subjectStats.totalTime = (subjectStats.totalTime || 0) + currentPerf.timeSpent;
            
            // Calculate average score
            const totalScore = (subjectStats.averageScore || 0) * (subjectStats.examsTaken - 1) + currentPerf.accuracy;
            subjectStats.averageScore = Math.round(totalScore / subjectStats.examsTaken);
            
            // Calculate improvement
            if (subjectStats.lastScore > 0) {
                subjectStats.improvement = currentPerf.accuracy - subjectStats.lastScore;
            }
            subjectStats.lastScore = currentPerf.accuracy;
        });
    }
    
    /**
     * Update topic statistics
     */
    updateTopicStats(examResults) {
        const topicPerformance = examResults.performanceByTopic || {};
        
        Object.keys(topicPerformance).forEach(topicKey => {
            if (!this.stats.byTopic[topicKey]) {
                const [subject, topic] = topicKey.split(':');
                this.stats.byTopic[topicKey] = {
                    subject: subject,
                    topic: topic,
                    totalQuestions: 0,
                    correctAnswers: 0,
                    totalTime: 0,
                    averageScore: 0,
                    examsTaken: 0,
                    lastScore: 0,
                    improvement: 0
                };
            }
            
            const topicStats = this.stats.byTopic[topicKey];
            const currentPerf = topicPerformance[topicKey];
            
            topicStats.examsTaken = (topicStats.examsTaken || 0) + 1;
            topicStats.totalQuestions = (topicStats.totalQuestions || 0) + currentPerf.total;
            topicStats.correctAnswers = (topicStats.correctAnswers || 0) + currentPerf.correct;
            topicStats.totalTime = (topicStats.totalTime || 0) + currentPerf.timeSpent;
            
            // Calculate average score
            const totalScore = (topicStats.averageScore || 0) * (topicStats.examsTaken - 1) + currentPerf.accuracy;
            topicStats.averageScore = Math.round(totalScore / topicStats.examsTaken);
            
            // Calculate improvement
            if (topicStats.lastScore > 0) {
                topicStats.improvement = currentPerf.accuracy - topicStats.lastScore;
            }
            topicStats.lastScore = currentPerf.accuracy;
        });
    }
    
    /**
     * Update difficulty statistics
     */
    updateDifficultyStats(examResults) {
        const difficultyPerformance = examResults.performanceByDifficulty || {};
        
        Object.keys(difficultyPerformance).forEach(difficulty => {
            if (!this.stats.byDifficulty[difficulty]) {
                this.stats.byDifficulty[difficulty] = {
                    total: 0,
                    correct: 0,
                    averageTime: 0
                };
            }
            
            const diffStats = this.stats.byDifficulty[difficulty];
            const currentPerf = difficultyPerformance[difficulty];
            
            diffStats.total = (diffStats.total || 0) + currentPerf.total;
            diffStats.correct = (diffStats.correct || 0) + currentPerf.correct;
            
            // Calculate average time
            if (currentPerf.total > 0) {
                const totalTime = (diffStats.averageTime || 0) * (diffStats.total - currentPerf.total) + currentPerf.timeSpent;
                diffStats.averageTime = Math.round(totalTime / diffStats.total);
            }
        });
    }
    
    /**
     * Update trends
     */
    updateTrends(examResults) {
        const date = new Date(examResults.endTime || examResults.startTime || Date.now());
        const dayKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        
        // Update daily trend
        let dailyTrend = this.stats.trends.daily.find(t => t.date === dayKey);
        if (!dailyTrend) {
            dailyTrend = {
                date: dayKey,
                exams: 0,
                averageScore: 0,
                totalQuestions: 0,
                totalTime: 0
            };
            this.stats.trends.daily.push(dailyTrend);
        }
        
        dailyTrend.exams++;
        dailyTrend.totalQuestions += examResults.totalQuestions;
        dailyTrend.totalTime += examResults.totalTime;
        
        // Calculate daily average score
        const totalScore = dailyTrend.averageScore * (dailyTrend.exams - 1) + examResults.score;
        dailyTrend.averageScore = Math.round(totalScore / dailyTrend.exams);
        
        // Keep only last 30 days
        if (this.stats.trends.daily.length > 30) {
            this.stats.trends.daily = this.stats.trends.daily.slice(-30);
        }
        
        // Update weekly trend
        this.updateWeeklyTrend(dayKey, examResults);
        
        // Update monthly trend
        this.updateMonthlyTrend(dayKey, examResults);
    }
    
    /**
     * Update weekly trend
     */
    updateWeeklyTrend(dateKey, examResults) {
        const date = new Date(dateKey);
        const year = date.getFullYear();
        const week = this.getWeekNumber(date);
        const weekKey = `${year}-W${week.toString().padStart(2, '0')}`;
        
        let weeklyTrend = this.stats.trends.weekly.find(t => t.week === weekKey);
        if (!weeklyTrend) {
            weeklyTrend = {
                week: weekKey,
                exams: 0,
                averageScore: 0,
                totalQuestions: 0,
                totalTime: 0
            };
            this.stats.trends.weekly.push(weeklyTrend);
        }
        
        weeklyTrend.exams++;
        weeklyTrend.totalQuestions += examResults.totalQuestions;
        weeklyTrend.totalTime += examResults.totalTime;
        
        // Calculate weekly average score
        const totalScore = weeklyTrend.averageScore * (weeklyTrend.exams - 1) + examResults.score;
        weeklyTrend.averageScore = Math.round(totalScore / weeklyTrend.exams);
        
        // Keep only last 12 weeks
        if (this.stats.trends.weekly.length > 12) {
            this.stats.trends.weekly = this.stats.trends.weekly.slice(-12);
        }
    }
    
    /**
     * Update monthly trend
     */
    updateMonthlyTrend(dateKey, examResults) {
        const date = new Date(dateKey);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const monthKey = `${year}-${month.toString().padStart(2, '0')}`;
        
        let monthlyTrend = this.stats.trends.monthly.find(t => t.month === monthKey);
        if (!monthlyTrend) {
            monthlyTrend = {
                month: monthKey,
                exams: 0,
                averageScore: 0,
                totalQuestions: 0,
                totalTime: 0
            };
            this.stats.trends.monthly.push(monthlyTrend);
        }
        
        monthlyTrend.exams++;
        monthlyTrend.totalQuestions += examResults.totalQuestions;
        monthlyTrend.totalTime += examResults.totalTime;
        
        // Calculate monthly average score
        const totalScore = monthlyTrend.averageScore * (monthlyTrend.exams - 1) + examResults.score;
        monthlyTrend.averageScore = Math.round(totalScore / monthlyTrend.exams);
        
        // Keep only last 6 months
        if (this.stats.trends.monthly.length > 6) {
            this.stats.trends.monthly = this.stats.trends.monthly.slice(-6);
        }
    }
    
    /**
     * Get week number
     */
    getWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    }
    
    /**
     * Calculate consistency
     */
    calculateConsistency() {
        try {
            // Get last 10 exam scores
            const lastExams = JSON.parse(localStorage.getItem('previous_exams') || '[]');
            const lastScores = lastExams.slice(-10).map(exam => exam.score || 0);
            
            if (lastScores.length < 2) {
                this.stats.overall.consistency = 100;
                return;
            }
            
            // Calculate standard deviation
            const mean = lastScores.reduce((a, b) => a + b, 0) / lastScores.length;
            const variance = lastScores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / lastScores.length;
            const stdDev = Math.sqrt(variance);
            
            // Convert to consistency score (0-100)
            // Lower std deviation = higher consistency
            const maxStdDev = 50; // Assuming max possible std deviation
            const consistency = Math.max(0, 100 - (stdDev / maxStdDev) * 100);
            
            this.stats.overall.consistency = Math.round(consistency);
            
        } catch (error) {
            console.error('Error calculating consistency:', error);
            this.stats.overall.consistency = 0;
        }
    }
    
    /**
     * Identify weak areas
     */
    async identifyWeakAreas(examResults) {
        // Clear existing weak areas
        this.weakAreas = [];
        
        // Get topic performance from exam results
        const topicPerformance = examResults.performanceByTopic || {};
        
        // Also consider historical data
        const historicalWeakAreas = this.calculateHistoricalWeakAreas();
        
        // Combine current exam weak areas with historical data
        Object.keys(topicPerformance).forEach(topicKey => {
            const perf = topicPerformance[topicKey];
            
            // Consider topic weak if accuracy < 60% or if it has been consistently weak
            if (perf.total >= 3 && perf.accuracy < 60) {
                const [subject, topic] = topicKey.split(':');
                
                // Check if already in weak areas
                const existingIndex = this.weakAreas.findIndex(area => 
                    area.subject === subject && area.topic === topic
                );
                
                if (existingIndex >= 0) {
                    // Update existing weak area
                    const existing = this.weakAreas[existingIndex];
                    existing.currentAccuracy = perf.accuracy;
                    existing.totalQuestions += perf.total;
                    existing.incorrect += (perf.total - perf.correct);
                    
                    // Calculate average accuracy
                    const totalAccuracy = (existing.averageAccuracy * (existing.examsTaken - 1)) + perf.accuracy;
                    existing.averageAccuracy = Math.round(totalAccuracy / existing.examsTaken);
                    existing.examsTaken++;
                    
                } else {
                    // Add new weak area
                    this.weakAreas.push({
                        subject: subject,
                        topic: topic,
                        currentAccuracy: perf.accuracy,
                        averageAccuracy: perf.accuracy,
                        totalQuestions: perf.total,
                        incorrect: perf.total - perf.correct,
                        examsTaken: 1,
                        priority: this.calculateWeakAreaPriority(perf.accuracy, perf.total)
                    });
                }
            }
        });
        
        // Add historical weak areas that weren't in current exam
        historicalWeakAreas.forEach(historical => {
            const exists = this.weakAreas.some(area => 
                area.subject === historical.subject && area.topic === historical.topic
            );
            
            if (!exists) {
                this.weakAreas.push(historical);
            }
        });
        
        // Sort by priority (most critical first)
        this.weakAreas.sort((a, b) => b.priority - a.priority);
        
        // Keep only top 10 weak areas
        this.weakAreas = this.weakAreas.slice(0, 10);
        
        // Save weak areas
        await this.saveAnalytics();
    }
    
    /**
     * Calculate historical weak areas
     */
    calculateHistoricalWeakAreas() {
        const historical = [];
        
        // Analyze topic performance from stats
        Object.keys(this.stats.byTopic).forEach(topicKey => {
            const topicStats = this.stats.byTopic[topicKey];
            
            // Consider historically weak if average accuracy < 65% and at least 10 questions attempted
            if (topicStats.totalQuestions >= 10 && topicStats.averageScore < 65) {
                historical.push({
                    subject: topicStats.subject,
                    topic: topicStats.topic,
                    currentAccuracy: topicStats.lastScore || 0,
                    averageAccuracy: topicStats.averageScore,
                    totalQuestions: topicStats.totalQuestions,
                    incorrect: topicStats.totalQuestions - topicStats.correctAnswers,
                    examsTaken: topicStats.examsTaken,
                    priority: this.calculateWeakAreaPriority(topicStats.averageScore, topicStats.totalQuestions)
                });
            }
        });
        
        return historical;
    }
    
    /**
     * Calculate weak area priority
     */
    calculateWeakAreaPriority(accuracy, questionCount) {
        // Higher priority for lower accuracy and higher question count
        const accuracyWeight = 100 - accuracy; // Inverse of accuracy
        const countWeight = Math.min(questionCount / 20, 1); // Normalize to 0-1
        
        return Math.round((accuracyWeight * 0.7) + (countWeight * 0.3 * 100));
    }
    
    /**
     * Generate study recommendations
     */
    async generateRecommendations() {
        this.recommendations = [];
        
        // Recommendation 1: Focus on weak areas
        if (this.weakAreas.length > 0) {
            this.recommendations.push({
                type: 'weak_areas',
                priority: 'high',
                title: 'Focus on Weak Areas',
                description: `Practice ${this.weakAreas.length} topics where you're struggling the most`,
                action: 'Start focused practice',
                details: this.weakAreas.slice(0, 3).map(area => ({
                    topic: area.topic,
                    subject: area.subject,
                    accuracy: area.currentAccuracy
                }))
            });
        }
        
        // Recommendation 2: Time management
        const timeStats = this.stats.overall;
        if (timeStats.averageTimePerQuestion > 35) {
            this.recommendations.push({
                type: 'time_management',
                priority: 'medium',
                title: 'Improve Time Management',
                description: `Your average time per question is ${timeStats.averageTimePerQuestion}s, aim for 30s`,
                action: 'Practice speed drills',
                details: {
                    currentAverage: timeStats.averageTimePerQuestion,
                    targetAverage: 30,
                    improvementNeeded: timeStats.averageTimePerQuestion - 30
                }
            });
        }
        
        // Recommendation 3: Consistency improvement
        if (this.stats.overall.consistency < 80) {
            this.recommendations.push({
                type: 'consistency',
                priority: 'medium',
                title: 'Improve Consistency',
                description: `Your performance consistency is ${this.stats.overall.consistency}%, aim for 85%+`,
                action: 'Review inconsistent topics',
                details: {
                    currentConsistency: this.stats.overall.consistency,
                    targetConsistency: 85,
                    improvementNeeded: 85 - this.stats.overall.consistency
                }
            });
        }
        
        // Recommendation 4: Difficulty progression
        const diffStats = this.stats.byDifficulty;
        if (diffStats.Hard && diffStats.Hard.total > 0 && diffStats.Hard.correct / diffStats.Hard.total < 0.5) {
            this.recommendations.push({
                type: 'difficulty',
                priority: 'low',
                title: 'Master Hard Questions',
                description: 'You\'re struggling with hard difficulty questions',
                action: 'Practice more hard questions',
                details: {
                    currentAccuracy: Math.round((diffStats.Hard.correct / diffStats.Hard.total) * 100),
                    targetAccuracy: 60,
                    questionsAttempted: diffStats.Hard.total
                }
            });
        }
        
        // Recommendation 5: Regular practice
        const lastExamDate = this.getLastExamDate();
        const daysSinceLastExam = this.getDaysSince(lastExamDate);
        
        if (daysSinceLastExam > 3) {
            this.recommendations.push({
                type: 'frequency',
                priority: 'high',
                title: 'Maintain Regular Practice',
                description: `It's been ${daysSinceLastExam} days since your last exam`,
                action: 'Take a practice exam',
                details: {
                    daysSinceLastExam: daysSinceLastExam,
                    recommendedFrequency: 'Every 1-2 days',
                    suggestedExamCount: Math.min(3, Math.ceil(daysSinceLastExam / 2))
                }
            });
        }
        
        // Recommendation 6: Subject balance
        const subjectImbalance = this.checkSubjectBalance();
        if (subjectImbalance) {
            this.recommendations.push({
                type: 'balance',
                priority: 'medium',
                title: 'Balance Your Study',
                description: `You're focusing heavily on ${subjectImbalance.heavySubject} over ${subjectImbalanced.lightSubject}`,
                action: 'Diversify your study topics',
                details: {
                    heavySubject: subjectImbalance.heavySubject,
                    lightSubject: subjectImbalance.lightSubject,
                    ratio: subjectImbalance.ratio.toFixed(1)
                }
            });
        }
        
        // Save recommendations
        await this.saveAnalytics();
    }
    
    /**
     * Get last exam date
     */
    getLastExamDate() {
        const lastExams = JSON.parse(localStorage.getItem('previous_exams') || '[]');
        if (lastExams.length === 0) {
            return null;
        }
        
        const lastExam = lastExams[lastExams.length - 1];
        return lastExam.date ? new Date(lastExam.date) : new Date();
    }
    
    /**
     * Get days since date
     */
    getDaysSince(date) {
        if (!date) return 999;
        
        const now = new Date();
        const diffTime = Math.abs(now - date);
        return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    }
    
    /**
     * Check subject balance
     */
    checkSubjectBalance() {
        const subjectStats = this.stats.bySubject;
        const subjects = Object.keys(subjectStats);
        
        if (subjects.length < 2) {
            return null;
        }
        
        // Find subject with most and least questions
        let maxSubject = null;
        let minSubject = null;
        let maxQuestions = 0;
        let minQuestions = Infinity;
        
        subjects.forEach(subject => {
            const questions = subjectStats[subject].totalQuestions || 0;
            if (questions > maxQuestions) {
                maxQuestions = questions;
                maxSubject = subject;
            }
            if (questions < minQuestions) {
                minQuestions = questions;
                minSubject = subject;
            }
        });
        
        // Check if imbalance is significant (ratio > 3:1)
        if (maxQuestions > 0 && minQuestions > 0) {
            const ratio = maxQuestions / minQuestions;
            if (ratio > 3) {
                return {
                    heavySubject: maxSubject,
                    lightSubject: minSubject,
                    ratio: ratio
                };
            }
        }
        
        return null;
    }
    
    /**
     * Make performance predictions
     */
    makePredictions() {
        const stats = this.stats.overall;
        const predictions = this.stats.predictions;
        
        // Predict next exam score based on trend
        if (stats.totalExams > 0) {
            // Simple linear regression for last 5 exams
            const lastExams = JSON.parse(localStorage.getItem('previous_exams') || '[]');
            const recentScores = lastExams.slice(-5).map(exam => exam.score || stats.averageScore);
            
            if (recentScores.length >= 2) {
                // Calculate trend
                const x = recentScores.map((_, i) => i);
                const y = recentScores;
                
                const n = x.length;
                const sumX = x.reduce((a, b) => a + b, 0);
                const sumY = y.reduce((a, b) => a + b, 0);
                const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
                const sumX2 = x.reduce((a, b) => a + b * b, 0);
                
                const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
                
                // Predict next score
                const nextX = n;
                const nextScore = (sumY / n) + slope * (nextX - (sumX / n));
                
                predictions.nextExamScore = Math.max(0, Math.min(100, Math.round(nextScore)));
            } else {
                predictions.nextExamScore = stats.averageScore;
            }
        } else {
            predictions.nextExamScore = 65; // Default prediction for new users
        }
        
        // Calculate study hours needed
        const targetScore = 85; // Target score
        const currentScore = stats.averageScore;
        const scoreGap = targetScore - currentScore;
        
        // Estimate hours needed (2 hours per 10 points improvement)
        predictions.studyHoursNeeded = Math.max(0, Math.round((scoreGap / 10) * 2));
        
        // Calculate readiness score (0-100)
        const consistencyScore = stats.consistency || 50;
        const weakAreaScore = Math.max(0, 100 - (this.weakAreas.length * 10));
        const frequencyScore = this.calculateFrequencyScore();
        const balanceScore = this.calculateBalanceScore();
        
        predictions.readinessScore = Math.round(
            (consistencyScore * 0.3) +
            (weakAreaScore * 0.3) +
            (frequencyScore * 0.2) +
            (balanceScore * 0.2)
        );
    }
    
    /**
     * Calculate frequency score
     */
    calculateFrequencyScore() {
        const lastExamDate = this.getLastExamDate();
        const daysSince = this.getDaysSince(lastExamDate);
        
        if (daysSince === 999) {
            return 0; // No exams taken
        }
        
        // Score based on how recently exams were taken
        if (daysSince === 0) return 100; // Today
        if (daysSince === 1) return 90;  // Yesterday
        if (daysSince === 2) return 80;  // 2 days ago
        if (daysSince <= 3) return 70;   // 3 days ago
        if (daysSince <= 7) return 50;   // Within week
        if (daysSince <= 14) return 30;  // Within 2 weeks
        return 10;                        // More than 2 weeks
    }
    
    /**
     * Calculate balance score
     */
    calculateBalanceScore() {
        const subjectStats = this.stats.bySubject;
        const subjects = Object.keys(subjectStats);
        
        if (subjects.length < 2) {
            return 50; // Neutral score for single subject
        }
        
        // Calculate coefficient of variation
        const questionCounts = subjects.map(subject => subjectStats[subject].totalQuestions || 0);
        const mean = questionCounts.reduce((a, b) => a + b, 0) / questionCounts.length;
        const variance = questionCounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / questionCounts.length;
        const stdDev = Math.sqrt(variance);
        const cv = mean > 0 ? (stdDev / mean) : 1;
        
        // Convert to score (lower CV = more balanced = higher score)
        return Math.max(0, Math.round(100 - (cv * 100)));
    }
    
    /**
     * Get overall statistics
     */
    getOverallStats() {
        return {
            ...this.stats.overall,
            weakAreasCount: this.weakAreas.length,
            recommendationsCount: this.recommendations.length
        };
    }
    
    /**
     * Get subject statistics
     */
    getSubjectStats() {
        return Object.keys(this.stats.bySubject).map(subject => ({
            subject: subject,
            ...this.stats.bySubject[subject]
        })).sort((a, b) => b.totalQuestions - a.totalQuestions);
    }
    
    /**
     * Get topic statistics
     */
    getTopicStats() {
        return Object.keys(this.stats.byTopic).map(topicKey => ({
            topicKey: topicKey,
            ...this.stats.byTopic[topicKey]
        })).sort((a, b) => a.averageScore - b.averageScore); // Sort by lowest score first
    }
    
    /**
     * Get difficulty statistics
     */
    getDifficultyStats() {
        return Object.keys(this.stats.byDifficulty).map(difficulty => ({
            difficulty: difficulty,
            ...this.stats.byDifficulty[difficulty],
            accuracy: this.stats.byDifficulty[difficulty].total > 0 ?
                Math.round((this.stats.byDifficulty[difficulty].correct / this.stats.byDifficulty[difficulty].total) * 100) : 0
        }));
    }
    
    /**
     * Get trends
     */
    getTrends(period = 'daily') {
        return this.stats.trends[period] || [];
    }
    
    /**
     * Get weak areas
     */
    getWeakAreas(limit = 10) {
        return this.weakAreas.slice(0, limit);
    }
    
    /**
     * Get recommendations
     */
    getRecommendations(priority = null) {
        if (priority) {
            return this.recommendations.filter(rec => rec.priority === priority);
        }
        return this.recommendations;
    }
    
    /**
     * Get predictions
     */
    getPredictions() {
        return this.stats.predictions;
    }
    
    /**
     * Get progress over time
     */
    getProgressOverTime(days = 30) {
        const dailyTrends = this.stats.trends.daily.slice(-days);
        return dailyTrends.map(trend => ({
            date: trend.date,
            score: trend.averageScore,
            exams: trend.exams,
            questions: trend.totalQuestions
        }));
    }
    
    /**
     * Get study efficiency score
     */
    getStudyEfficiency() {
        const stats = this.stats.overall;
        
        if (stats.totalQuestions === 0 || stats.totalTime === 0) {
            return 0;
        }
        
        // Efficiency = (score / 100) * (1000 / average_time_per_question)
        const score = stats.averageScore / 100;
        const timeEfficiency = 1000 / (stats.averageTimePerQuestion || 30);
        
        return Math.round(score * timeEfficiency);
    }
    
    /**
     * Get exam readiness prediction
     */
    getExamReadiness() {
        const predictions = this.stats.predictions;
        const readiness = predictions.readinessScore || 0;
        
        if (readiness >= 85) return { level: 'high', color: '#4CAF50', text: 'Ready' };
        if (readiness >= 70) return { level: 'medium', color: '#FF9800', text: 'Almost Ready' };
        return { level: 'low', color: '#F44336', text: 'Needs More Practice' };
    }
    
    /**
     * Generate study plan
     */
    generateStudyPlan(days = 7) {
        const plan = [];
        const weakAreas = this.getWeakAreas(5);
        const recommendations = this.getRecommendations('high');
        
        // Day 1: Focus on weakest area
        if (weakAreas.length > 0) {
            plan.push({
                day: 1,
                focus: weakAreas[0].topic,
                subject: weakAreas[0].subject,
                tasks: [
                    'Review concepts for 30 minutes',
                    'Practice 20 questions',
                    'Review incorrect answers'
                ],
                duration: '90 minutes',
                priority: 'high'
            });
        }
        
        // Day 2: Time management practice
        const timeRecommendation = recommendations.find(rec => rec.type === 'time_management');
        if (timeRecommendation) {
            plan.push({
                day: 2,
                focus: 'Time Management',
                subject: 'All',
                tasks: [
                    'Take 10-question speed drill',
                    'Aim for 25 seconds per question',
                    'Review timing patterns'
                ],
                duration: '60 minutes',
                priority: 'medium'
            });
        }
        
        // Day 3: Second weakest area
        if (weakAreas.length > 1) {
            plan.push({
                day: 3,
                focus: weakAreas[1].topic,
                subject: weakAreas[1].subject,
                tasks: [
                    'Review concepts for 20 minutes',
                    'Practice 15 questions',
                    'Focus on accuracy'
                ],
                duration: '75 minutes',
                priority: 'high'
            });
        }
        
        // Day 4: Full practice exam
        plan.push({
            day: 4,
            focus: 'Full Practice Exam',
            subject: 'Mixed',
            tasks: [
                'Take 25-question timed exam',
                'Simulate real exam conditions',
                'Analyze results thoroughly'
            ],
            duration: '120 minutes',
            priority: 'high'
        });
        
        // Day 5: Review and reinforcement
        plan.push({
            day: 5,
            focus: 'Review & Reinforcement',
            subject: 'All',
            tasks: [
                'Review all incorrect questions from past week',
                'Focus on understanding patterns',
                'Update study notes'
            ],
            duration: '60 minutes',
            priority: 'medium'
        });
        
        // Day 6: Subject balance
        const balanceRecommendation = recommendations.find(rec => rec.type === 'balance');
        if (balanceRecommendation) {
            plan.push({
                day: 6,
                focus: 'Subject Balance',
                subject: balanceRecommendation.details.lightSubject,
                tasks: [
                    'Study neglected subject',
                    'Practice 20 questions',
                    'Compare with strong subjects'
                ],
                duration: '75 minutes',
                priority: 'medium'
            });
        }
        
        // Day 7: Mock exam and preparation
        plan.push({
            day: 7,
            focus: 'Final Preparation',
            subject: 'All',
            tasks: [
                'Take 50-question mock exam',
                'Practice exam strategies',
                'Review weak areas one more time'
            ],
            duration: '150 minutes',
            priority: 'high'
        });
        
        return plan;
    }
    
    /**
     * Export analytics data
     */
    exportData() {
        return {
            userId: this.userId,
            timestamp: new Date().toISOString(),
            stats: this.stats,
            weakAreas: this.weakAreas,
            recommendations: this.recommendations,
            progressData: this.getProgressOverTime(30)
        };
    }
    
    /**
     * Import analytics data
     */
    importData(data) {
        if (data.stats) this.stats = data.stats;
        if (data.weakAreas) this.weakAreas = data.weakAreas;
        if (data.recommendations) this.recommendations = data.recommendations;
        
        this.saveAnalytics();
    }
    
    /**
     * Clear analytics data
     */
    clearData() {
        this.resetStats();
        this.weakAreas = [];
        this.recommendations = [];
        
        // Clear from localStorage
        localStorage.removeItem('analytics_stats');
        localStorage.removeItem('analytics_weak_areas');
        localStorage.removeItem('analytics_recommendations');
        
        console.log('Analytics data cleared');
    }
    
    /**
     * Process analytics data from IndexedDB
     */
    processAnalyticsData(analytics) {
        if (!analytics || !Array.isArray(analytics)) return;
        
        analytics.forEach(item => {
            if (item.type === 'analytics_summary' && item.stats) {
                // Merge with current stats
                this.stats = this.mergeStats(this.stats, item.stats);
            }
        });
    }
    
    /**
     * Merge stats objects
     */
    mergeStats(current, incoming) {
        // Simple merge - in production, you'd want more sophisticated merging
        return {
            overall: { ...current.overall, ...incoming.overall },
            bySubject: { ...current.bySubject, ...incoming.bySubject },
            byTopic: { ...current.byTopic, ...incoming.byTopic },
            byDifficulty: { ...current.byDifficulty, ...incoming.byDifficulty },
            trends: {
                daily: [...(current.trends?.daily || []), ...(incoming.trends?.daily || [])],
                weekly: [...(current.trends?.weekly || []), ...(incoming.trends?.weekly || [])],
                monthly: [...(current.trends?.monthly || []), ...(incoming.trends?.monthly || [])]
            },
            predictions: { ...current.predictions, ...incoming.predictions }
        };
    }
}

// Create global instance
const analytics = new AnalyticsManager();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = analytics;
}
/**
 * exam-engine.js – Medical Exam Room Pro
 * Core Exam Logic: question selection, timing, answer tracking, auto‑save, scoring.
 * 
 * Full implementation per blueprint.
 * Integrates with questions.js, db.js, timer.js, utils.js, app.js.
 * No mock data – all operations real.
 * 
 * @module exam-engine
 */

import * as questions from './questions.js';
import * as db from './db.js';
import * as timer from './timer.js';
import * as utils from './utils.js';
import * as app from './app.js';

// ----------------------------------------------------------------------
// PRIVATE STATE (SINGLETON EXAM INSTANCE)
// ----------------------------------------------------------------------
let currentExam = null; // null when no active exam

// ----------------------------------------------------------------------
// CONSTANTS (Blueprint‑aligned)
// ----------------------------------------------------------------------
const DIFFICULTY_LEVELS = {
  1: 'Easy',
  2: 'Medium',
  3: 'Hard',
  4: 'Very Hard',
  5: 'Expert'
};

const DEFAULT_TIME_PER_DIFFICULTY = {
  1: 21, // Easy – 21 seconds
  2: 30, // Medium – 30 seconds
  3: 42, // Hard – 42 seconds
  4: 48, // Very Hard – 48 seconds (blueprint didn't specify, interpolated)
  5: 54  // Expert – 54 seconds
};

const DEFAULT_DIFFICULTY_DISTRIBUTION = {
  1: 0.20, // 20% Easy
  2: 0.30, // 30% Medium
  3: 0.30, // 30% Hard
  4: 0.15, // 15% Very Hard
  5: 0.05  // 5% Expert
};

// ----------------------------------------------------------------------
// EXAM STATE STRUCTURE
// ----------------------------------------------------------------------
/**
 * @typedef {Object} ExamState
 * @property {string} examId - Unique exam identifier
 * @property {Object} config - Original exam configuration
 * @property {string} userId - ID of the user taking the exam
 * @property {Array} questions - Array of question objects (selected, shuffled)
 * @property {number} currentIndex - Index of the current question (0‑based)
 * @property {Array} answers - Array of answer objects per question
 * @property {number} startTime - Timestamp when exam started (ms)
 * @property {number} pausedTime - Timestamp when exam was paused (ms)
 * @property {number} totalPausedDuration - Total ms spent paused
 * @property {boolean} isPaused - Pause state
 * @property {boolean} isFinished - Whether exam has been submitted
 * @property {number} totalTimeAllocated - Total exam time in ms (sum of per‑question limits)
 * @property {Object} timerInstances - Per‑question timer objects (optional)
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} lastSavedAt - ISO timestamp of last auto‑save
 */

/**
 * @typedef {Object} AnswerRecord
 * @property {string} questionId
 * @property {string} selectedOption - 'A', 'B', 'C', 'D', 'E' or null if unanswered
 * @property {number} timeSpent - Seconds spent on this question
 * @property {boolean} flagged
 * @property {boolean} visited
 * @property {boolean} skipped
 */

// ----------------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------------

/**
 * Generates a unique exam ID.
 * @returns {string}
 */
function generateExamId() {
  return `exam_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Selects and shuffles questions based on exam configuration.
 * Implements difficulty balancing, topic coverage, and no repetition.
 * @param {Object} config - Exam configuration
 * @returns {Promise<Array>} Array of question objects
 */
async function selectQuestionsForExam(config) {
  const {
    subject,
    topics = [],
    specificQuestions = null,
    questionCount,
    difficulty = 'mixed',
    difficultyBalance = true,
    selectionMethod = 'random',
    includeAllTopics = true
  } = config;

  let pool = [];

  // 1. Load questions from source
  if (specificQuestions && Array.isArray(specificQuestions) && specificQuestions.length > 0) {
    // Specific question IDs provided (e.g., review incorrect)
    for (const qid of specificQuestions) {
      const q = await questions.getQuestionById(qid);
      if (q) pool.push(q);
    }
  } else if (subject) {
    // Load entire subject or selected topics
    if (topics && topics.length > 0) {
      const topicIds = topics.map(t => typeof t === 'string' ? t : t.id);
      for (const tid of topicIds) {
        const topicQs = await questions.loadQuestions(subject, tid);
        pool.push(...topicQs);
      }
    } else {
      // Load all topics in subject
      pool = await questions.loadQuestions(subject);
    }
  } else {
    throw new Error('Exam configuration must specify subject or specific questions');
  }

  // 2. Apply difficulty filter
  if (difficulty !== 'mixed') {
    let diffLevels = [];
    switch (difficulty) {
      case 'easy': diffLevels = [1]; break;
      case 'medium': diffLevels = [2]; break;
      case 'hard': diffLevels = [3]; break;
      case 'expert': diffLevels = [4,5]; break; // expert includes very hard
      default: diffLevels = [1,2,3,4,5];
    }
    pool = questions.filterByDifficulty(pool, diffLevels);
  }

  // 3. Remove duplicates (in case same question appears in multiple topics – shouldn't happen)
  pool = Array.from(new Map(pool.map(q => [q.id, q])).values());

  // 4. Ensure we have enough questions
  const availableCount = pool.length;
  if (availableCount === 0) {
    throw new Error('No questions available for the selected criteria');
  }
  let targetCount = questionCount || Math.min(availableCount, 50); // default 50 if not set
  if (targetCount > availableCount) {
    console.warn(`Requested ${targetCount} questions but only ${availableCount} available. Using all.`);
    targetCount = availableCount;
  }

  // 5. Difficulty balancing (if enabled and difficulty is mixed)
  let selectedQuestions = [];
  if (difficultyBalance && difficulty === 'mixed' && targetCount < availableCount) {
    // Distribute according to blueprint distribution
    const distribution = { ...DEFAULT_DIFFICULTY_DISTRIBUTION };
    // Adjust distribution for targetCount
    const countsByDifficulty = {};
    for (let d = 1; d <= 5; d++) {
      countsByDifficulty[d] = Math.round(targetCount * (distribution[d] || 0));
    }
    // Adjust rounding errors
    const sum = Object.values(countsByDifficulty).reduce((a,b) => a+b, 0);
    if (sum < targetCount) countsByDifficulty[2] += (targetCount - sum); // add to medium
    if (sum > targetCount) countsByDifficulty[5] -= (sum - targetCount); // remove from expert

    // For each difficulty, pick random questions
    for (let d = 1; d <= 5; d++) {
      const need = countsByDifficulty[d];
      if (need <= 0) continue;
      const candidates = pool.filter(q => q.difficulty === d);
      if (candidates.length === 0) continue;
      const shuffled = utils.shuffleArray([...candidates]);
      selectedQuestions.push(...shuffled.slice(0, need));
    }

    // If we still don't have enough, fill with any difficulty
    if (selectedQuestions.length < targetCount) {
      const remaining = targetCount - selectedQuestions.length;
      const usedIds = new Set(selectedQuestions.map(q => q.id));
      const remainingPool = pool.filter(q => !usedIds.has(q.id));
      const shuffledRemaining = utils.shuffleArray(remainingPool);
      selectedQuestions.push(...shuffledRemaining.slice(0, remaining));
    }
  } else {
    // No balancing: random selection
    selectedQuestions = utils.shuffleArray(pool).slice(0, targetCount);
  }

  // 6. Final shuffle (so order is random)
  selectedQuestions = utils.shuffleArray(selectedQuestions);

  return selectedQuestions;
}

/**
 * Initialises answer array for the selected questions.
 * @param {Array} questions 
 * @returns {Array<AnswerRecord>}
 */
function createAnswerArray(questions) {
  return questions.map(q => ({
    questionId: q.id,
    selectedOption: null,
    timeSpent: 0,
    flagged: false,
    visited: false,
    skipped: false
  }));
}

/**
 * Calculates total allocated time for the exam (ms).
 * @param {Array} questions 
 * @param {Object} config 
 * @returns {number}
 */
function calculateTotalTimeAllocated(questions, config) {
  if (config.timingMode === 'none') {
    return 0; // no time limit
  }
  if (config.timingMode === 'fixed' && config.fixedTimePerQuestion) {
    return questions.length * config.fixedTimePerQuestion * 1000;
  }
  // adaptive: sum per difficulty
  return questions.reduce((sum, q) => {
    const sec = DEFAULT_TIME_PER_DIFFICULTY[q.difficulty] || 30;
    return sum + sec * 1000;
  }, 0);
}

// ----------------------------------------------------------------------
// PUBLIC API – EXAM LIFECYCLE
// ----------------------------------------------------------------------

/**
 * Creates a new exam from configuration.
 * @param {Object} config - Exam configuration (from exam-settings.html / app state)
 * @returns {Promise<Object>} The created exam state
 */
export async function createExam(config) {
  // Guard: if an exam is already in progress, should we discard? We'll discard.
  if (currentExam && !currentExam.isFinished) {
    console.warn('Existing exam in progress – overwriting.');
    await autoSave(); // attempt final save
  }

  const userId = app.getUser()?.id;
  if (!userId) throw new Error('User not authenticated');

  // Select questions
  const questionsArray = await selectQuestionsForExam(config);
  if (questionsArray.length === 0) {
    throw new Error('No questions could be selected');
  }

  const examId = generateExamId();
  const answers = createAnswerArray(questionsArray);
  const totalTimeAllocated = calculateTotalTimeAllocated(questionsArray, config);

  const examState = {
    examId,
    config: { ...config },
    userId,
    questions: questionsArray,
    currentIndex: 0,
    answers,
    startTime: null, // set when startExam() called
    pausedTime: null,
    totalPausedDuration: 0,
    isPaused: false,
    isFinished: false,
    totalTimeAllocated,
    timerInstances: {}, // optional, not stored
    createdAt: new Date().toISOString(),
    lastSavedAt: null
  };

  // Mark first question as visited
  if (examState.answers[0]) examState.answers[0].visited = true;

  currentExam = examState;
  return examState;
}

/**
 * Starts the exam: sets start time, begins timer.
 */
export function startExam() {
  if (!currentExam) throw new Error('No exam created');
  if (currentExam.isFinished) throw new Error('Exam already finished');
  if (currentExam.startTime !== null && !currentExam.isPaused) {
    // Already started and not paused – do nothing
    return;
  }

  const now = Date.now();
  if (currentExam.startTime === null) {
    // First start
    currentExam.startTime = now;
    currentExam.totalPausedDuration = 0;
  } else if (currentExam.isPaused) {
    // Resuming from pause
    currentExam.totalPausedDuration += (now - currentExam.pausedTime);
    currentExam.pausedTime = null;
  }
  currentExam.isPaused = false;
}

/**
 * Pauses the exam.
 */
export function pauseExam() {
  if (!currentExam || currentExam.isFinished) return;
  if (currentExam.isPaused) return;
  currentExam.isPaused = true;
  currentExam.pausedTime = Date.now();
}

/**
 * Resumes a paused exam.
 */
export function resumeExam() {
  if (!currentExam || currentExam.isFinished) return;
  if (!currentExam.isPaused) return;
  startExam(); // reuse start logic for resume
}

/**
 * Ends the exam, calculates results, saves to DB, clears state.
 * @returns {Promise<Object>} Results object
 */
export async function endExam() {
  if (!currentExam) throw new Error('No active exam');
  if (currentExam.isFinished) throw new Error('Exam already finished');

  // Ensure timer is stopped and state is final
  currentExam.isFinished = true;
  currentExam.isPaused = false;

  // Calculate results
  const results = calculateResults(currentExam);

  // Save to IndexedDB
  await db.saveExamResult(results);

  // Delete any auto-saved progress
  await deleteSavedExam();

  // Clear current exam (optional – allow later start)
  const examCopy = { ...currentExam };
  currentExam = null;

  return results;
}

/**
 * Calculates results from exam state.
 * @param {ExamState} exam 
 * @returns {Object} Formatted results object
 */
function calculateResults(exam) {
  const { questions, answers, config, startTime, totalPausedDuration, totalTimeAllocated } = exam;

  let correctCount = 0;
  let totalTimeSpent = 0;
  const questionResults = [];
  const topicMap = {};

  answers.forEach((ans, idx) => {
    const q = questions[idx];
    const isCorrect = ans.selectedOption === q.correct;
    if (isCorrect) correctCount++;
    totalTimeSpent += ans.timeSpent;

    // Topic performance aggregation
    if (!topicMap[q.topic]) {
      topicMap[q.topic] = { correct: 0, total: 0, totalTime: 0 };
    }
    topicMap[q.topic].total++;
    topicMap[q.topic].totalTime += ans.timeSpent;
    if (isCorrect) topicMap[q.topic].correct++;

    questionResults.push({
      ...q,
      userAnswer: ans.selectedOption,
      timeSpent: ans.timeSpent,
      correct: isCorrect,
      flagged: ans.flagged,
      skipped: ans.skipped
    });
  });

  const totalQuestions = questions.length;
  const scorePercentage = (correctCount / totalQuestions) * 100;

  // Topic performance array
  const topicPerformance = Object.entries(topicMap).map(([topic, data]) => ({
    topic,
    questions: data.total,
    correct: data.correct,
    percentage: (data.correct / data.total) * 100,
    averageTime: data.totalTime / data.total
  }));

  // Identify weak areas (<70%)
  const weakAreas = topicPerformance
    .filter(t => t.percentage < 70)
    .map(t => t.topic);

  const timeSpent = startTime ? (Date.now() - startTime - exam.totalPausedDuration) / 1000 : totalTimeSpent;
  const timeAllocated = totalTimeAllocated / 1000; // seconds

  return {
    examId: exam.examId,
    userId: exam.userId,
    subject: config.subject || 'mixed',
    mode: config.mode || 'timed',
    date: new Date().toISOString(),
    totalQuestions,
    correctAnswers: correctCount,
    scorePercentage,
    grade: calculateGrade(scorePercentage),
    timeAllocated,
    timeSpent,
    averageTimePerQuestion: totalQuestions ? totalTimeSpent / totalQuestions : 0,
    questions: questionResults,
    topicPerformance,
    weakAreas,
    config: { ...config }
  };
}

function calculateGrade(percentage) {
  if (percentage >= 80) return 'A';
  if (percentage >= 70) return 'B';
  if (percentage >= 60) return 'C';
  if (percentage >= 50) return 'D';
  return 'F';
}

// ----------------------------------------------------------------------
// SAVE / LOAD (Auto‑save)
// ----------------------------------------------------------------------

/**
 * Saves current exam progress to IndexedDB.
 * @returns {Promise<void>}
 */
export async function autoSave() {
  if (!currentExam || currentExam.isFinished) return;
  currentExam.lastSavedAt = new Date().toISOString();
  // Store in 'exams' store with a special flag or separate store?
  // Blueprint: db.js has saveExamProgress? We didn't implement that. We'll use a dedicated key.
  // We'll store as a special record in 'settings' or create 'examProgress' store? We'll use 'settings' with key `examProgress_${examId}`.
  const key = `examProgress_${currentExam.examId}`;
  await db.saveSetting(key, {
    examState: serializeExamForStorage(currentExam),
    savedAt: currentExam.lastSavedAt
  });
}

/**
 * Loads a saved exam progress from IndexedDB.
 * @returns {Promise<Object|null>} Exam state or null
 */
export async function loadSavedExam() {
  const userId = app.getUser()?.id;
  if (!userId) return null;

  // Find the most recent saved exam for this user (from settings)
  const allSettings = await db.getAllSettings();
  let latest = null;
  let latestTime = 0;
  for (const [key, value] of Object.entries(allSettings)) {
    if (key.startsWith('examProgress_') && value.examState?.userId === userId && !value.examState.isFinished) {
      const t = new Date(value.savedAt || 0).getTime();
      if (t > latestTime) {
        latestTime = t;
        latest = value.examState;
      }
    }
  }
  if (latest) {
    // Deserialize and set as current exam
    currentExam = deserializeExamFromStorage(latest);
    return currentExam;
  }
  return null;
}

/**
 * Deletes saved exam progress.
 * @returns {Promise<void>}
 */
export async function deleteSavedExam() {
  if (!currentExam) return;
  const key = `examProgress_${currentExam.examId}`;
  // We need a deleteSetting method – we'll add one via db.del
  // Since db.del works on settings store if we pass key.
  try {
    await db.del('settings', key);
  } catch (e) {
    // ignore if not found
  }
}

/**
 * Serialises exam state for storage (remove non-serializable fields).
 * @param {ExamState} exam 
 * @returns {Object}
 */
function serializeExamForStorage(exam) {
  const copy = { ...exam };
  delete copy.timerInstances; // not serializable
  return copy;
}

function deserializeExamFromStorage(obj) {
  // Ensure dates are parsed correctly
  const exam = { ...obj };
  exam.timerInstances = {}; // fresh
  return exam;
}

// ----------------------------------------------------------------------
// QUESTION NAVIGATION
// ----------------------------------------------------------------------

/**
 * Gets the current question object.
 * @returns {Object}
 */
export function getCurrentQuestion() {
  if (!currentExam) throw new Error('No active exam');
  return currentExam.questions[currentExam.currentIndex];
}

/**
 * Gets the next question and advances index.
 * @returns {Object|null} Next question or null if at end
 */
export function getNextQuestion() {
  if (!currentExam) throw new Error('No active exam');
  if (currentExam.currentIndex + 1 < currentExam.questions.length) {
    currentExam.currentIndex++;
    // Mark as visited
    if (currentExam.answers[currentExam.currentIndex]) {
      currentExam.answers[currentExam.currentIndex].visited = true;
    }
    return currentExam.questions[currentExam.currentIndex];
  }
  return null;
}

/**
 * Gets the previous question and moves index back.
 * @returns {Object|null} Previous question or null if at start
 */
export function getPreviousQuestion() {
  if (!currentExam) throw new Error('No active exam');
  if (currentExam.currentIndex > 0) {
    currentExam.currentIndex--;
    // Mark as visited
    if (currentExam.answers[currentExam.currentIndex]) {
      currentExam.answers[currentExam.currentIndex].visited = true;
    }
    return currentExam.questions[currentExam.currentIndex];
  }
  return null;
}

/**
 * Skips the current question (marks as skipped, advances).
 */
export function skipQuestion() {
  if (!currentExam) throw new Error('No active exam');
  const idx = currentExam.currentIndex;
  if (currentExam.answers[idx]) {
    currentExam.answers[idx].skipped = true;
  }
  getNextQuestion();
}

/**
 * Jumps to a specific question index.
 * @param {number} index 
 */
export function goTo(index) {
  if (!currentExam) throw new Error('No active exam');
  if (index >= 0 && index < currentExam.questions.length) {
    currentExam.currentIndex = index;
    currentExam.answers[index].visited = true;
  }
}

/**
 * Checks if there is a next question.
 * @returns {boolean}
 */
export function hasNext() {
  return currentExam ? currentExam.currentIndex + 1 < currentExam.questions.length : false;
}

/**
 * Checks if there is a previous question.
 * @returns {boolean}
 */
export function hasPrev() {
  return currentExam ? currentExam.currentIndex > 0 : false;
}

// ----------------------------------------------------------------------
// ANSWER HANDLING
// ----------------------------------------------------------------------

/**
 * Submits an answer for the current question.
 * @param {string} answer - Selected option letter (A, B, C, D, E)
 * @param {number} timeSpent - Seconds spent on this question
 */
export function submitAnswer(answer, timeSpent) {
  if (!currentExam) throw new Error('No active exam');
  const idx = currentExam.currentIndex;
  if (!currentExam.answers[idx]) return;
  currentExam.answers[idx].selectedOption = answer;
  currentExam.answers[idx].timeSpent = timeSpent;
  // Mark as answered (implicitly visited)
  currentExam.answers[idx].visited = true;
}

/**
 * Changes an answer for a given question.
 * @param {string} questionId 
 * @param {string} newAnswer 
 */
export function changeAnswer(questionId, newAnswer) {
  if (!currentExam) throw new Error('No active exam');
  const idx = currentExam.questions.findIndex(q => q.id === questionId);
  if (idx !== -1) {
    currentExam.answers[idx].selectedOption = newAnswer;
  }
}

/**
 * Clears an answer for a question.
 * @param {string} questionId 
 */
export function clearAnswer(questionId) {
  if (!currentExam) throw new Error('No active exam');
  const idx = currentExam.questions.findIndex(q => q.id === questionId);
  if (idx !== -1) {
    currentExam.answers[idx].selectedOption = null;
  }
}

/**
 * Flags/unflags the current question.
 * @param {boolean} [flag] - Optional flag state, otherwise toggles
 */
export function flagQuestion(flag) {
  if (!currentExam) throw new Error('No active exam');
  const idx = currentExam.currentIndex;
  if (currentExam.answers[idx]) {
    if (flag === undefined) {
      currentExam.answers[idx].flagged = !currentExam.answers[idx].flagged;
    } else {
      currentExam.answers[idx].flagged = flag;
    }
  }
}

/**
 * Toggles flag on current question.
 * @returns {boolean} New flag state
 */
export function toggleCurrentFlag() {
  if (!currentExam) throw new Error('No active exam');
  const idx = currentExam.currentIndex;
  if (currentExam.answers[idx]) {
    currentExam.answers[idx].flagged = !currentExam.answers[idx].flagged;
    return currentExam.answers[idx].flagged;
  }
  return false;
}

/**
 * Gets the current answer for the current question.
 * @returns {Object|null}
 */
export function getCurrentAnswer() {
  if (!currentExam) return null;
  return currentExam.answers[currentExam.currentIndex] || null;
}

// ----------------------------------------------------------------------
// PROGRESS & STATE QUERIES
// ----------------------------------------------------------------------

/**
 * Gets current exam progress.
 * @returns {Object}
 */
export function getExamProgress() {
  if (!currentExam) return null;
  const total = currentExam.questions.length;
  const answered = currentExam.answers.filter(a => a.selectedOption !== null).length;
  const flagged = currentExam.answers.filter(a => a.flagged).length;
  const visited = currentExam.answers.filter(a => a.visited).length;
  const timeRemaining = getTimeRemaining();
  return {
    total,
    answered,
    flagged,
    visited,
    currentIndex: currentExam.currentIndex,
    timeRemaining,
    percentComplete: total ? (answered / total) * 100 : 0
  };
}

/**
 * Gets time remaining in seconds.
 * @returns {number} Seconds remaining, or Infinity if no timer.
 */
export function getTimeRemaining() {
  if (!currentExam) return 0;
  if (currentExam.config.timingMode === 'none' || currentExam.totalTimeAllocated === 0) {
    return Infinity;
  }
  if (!currentExam.startTime) {
    return currentExam.totalTimeAllocated / 1000;
  }
  const elapsed = Date.now() - currentExam.startTime - currentExam.totalPausedDuration;
  const remaining = (currentExam.totalTimeAllocated - elapsed) / 1000;
  return Math.max(0, remaining);
}

/**
 * Gets number of answered questions.
 * @returns {number}
 */
export function getAnsweredCount() {
  if (!currentExam) return 0;
  return currentExam.answers.filter(a => a.selectedOption !== null).length;
}

/**
 * Gets state of a specific question by index.
 * @param {number} index 
 * @returns {Object}
 */
export function getQuestionState(index) {
  if (!currentExam) return { answered: false, flagged: false, visited: false, skipped: false };
  const ans = currentExam.answers[index];
  return {
    answered: ans?.selectedOption !== null,
    flagged: ans?.flagged || false,
    visited: ans?.visited || false,
    skipped: ans?.skipped || false
  };
}

// ----------------------------------------------------------------------
// GETTERS (for exam-room)
// ----------------------------------------------------------------------

/**
 * Gets the current exam configuration.
 * @returns {Object}
 */
export function getConfig() {
  return currentExam?.config || null;
}

/**
 * Gets the exam ID.
 * @returns {string}
 */
export function getExamId() {
  return currentExam?.examId || null;
}

/**
 * Gets the subject of the exam.
 * @returns {string}
 */
export function getSubject() {
  return currentExam?.config?.subject || 'General';
}

/**
 * Gets the difficulty of the current question (1-5).
 * @returns {number}
 */
export function getCurrentQuestionDifficulty() {
  const q = getCurrentQuestion();
  return q?.difficulty || 3;
}

/**
 * Gets the time limit for the current question (seconds).
 * @returns {number}
 */
export function getCurrentQuestionTimeLimit() {
  const q = getCurrentQuestion();
  if (!q) return 30;
  if (currentExam.config.timingMode === 'fixed' && currentExam.config.fixedTimePerQuestion) {
    return currentExam.config.fixedTimePerQuestion;
  }
  return DEFAULT_TIME_PER_DIFFICULTY[q.difficulty] || 30;
}

/**
 * Returns whether the exam is currently paused.
 * @returns {boolean}
 */
export function isPaused() {
  return currentExam?.isPaused || false;
}

/**
 * Returns whether the exam is finished.
 * @returns {boolean}
 */
export function isFinished() {
  return currentExam?.isFinished || false;
}

// ----------------------------------------------------------------------
// EXPOSE GLOBALLY FOR DEBUG (optional)
// ----------------------------------------------------------------------
if (typeof window !== 'undefined') {
  window.examEngine = {
    createExam,
    startExam,
    pauseExam,
    resumeExam,
    endExam,
    loadSavedExam,
    autoSave,
    deleteSavedExam,
    getCurrentQuestion,
    getNextQuestion,
    getPreviousQuestion,
    skipQuestion,
    flagQuestion,
    toggleCurrentFlag,
    submitAnswer,
    changeAnswer,
    clearAnswer,
    getExamProgress,
    getTimeRemaining,
    getAnsweredCount,
    getQuestionState,
    hasNext,
    hasPrev,
    goTo,
    getConfig,
    getExamId,
    getSubject,
    getCurrentQuestionDifficulty,
    getCurrentQuestionTimeLimit,
    isPaused,
    isFinished,
    getCurrentAnswer
  };
}
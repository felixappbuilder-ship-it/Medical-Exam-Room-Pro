"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { z } from "zod";

// Environment variables (set in Convex dashboard)
const AI_API_KEY = process.env.AI_API_KEY!;
const AI_MODEL = process.env.AI_MODEL || "gpt-4";

// Helper to call OpenAI API
async function callOpenAI(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  temperature = 0.7,
  maxTokens = 1000
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// -----------------------------------------------------------------------------
// Ask AI a medical question
// -----------------------------------------------------------------------------
export const askAI = action({
  args: {
    question: v.string(),
    context: v.optional(v.string()), // e.g., weak areas, subject context
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    // Optionally fetch user's weak areas from analytics to include in context
    let weakAreas: string[] = [];
    if (!args.context) {
      try {
        const weak = await ctx.runQuery(internal.analytics.getWeakAreas, {
          threshold: 70,
        });
        weakAreas = weak.map((w: any) => w.topic);
      } catch (e) {
        // Ignore if analytics fails
      }
    }

    const systemPrompt = `You are a medical tutor for Kenyan medical students. Provide accurate, concise answers with references to standard textbooks where possible. Format your response with clear sections if needed.`;
    const userPrompt = args.context
      ? `Context: ${args.context}\n\nQuestion: ${args.question}`
      : weakAreas.length > 0
      ? `User's weak areas: ${weakAreas.join(", ")}. Question: ${args.question}`
      : args.question;

    const reply = await callOpenAI([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    // Extract references (simple placeholder; could be enhanced with structured parsing)
    const references: Array<{ book: string; page?: number }> = [];
    // For now, return empty references

    return {
      reply,
      references,
    };
  },
});

// -----------------------------------------------------------------------------
// Upload and process a file (image/PDF) – extract text or summarize
// -----------------------------------------------------------------------------
export const uploadFile = action({
  args: {
    file: v.any(), // File object from client
    fileName: v.string(),
    fileType: v.string(), // e.g., "image/jpeg", "application/pdf"
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    // Store the file in Convex storage
    const storageId = await ctx.storage.store(args.file);

    // Get a URL for the file (optional, for later reference)
    const fileUrl = await ctx.storage.getUrl(storageId);
    if (!fileUrl) throw new ConvexError("Failed to get file URL");

    // Determine how to process based on file type
    let extractedText = "";
    let summary = "";

    if (args.fileType.startsWith("image/")) {
      // For images, we could use a vision model, but for simplicity, we'll return a note that image was uploaded
      extractedText = "Image uploaded. To extract text, use a dedicated OCR action.";
      summary = "Image file received.";
    } else if (args.fileType === "application/pdf") {
      // For PDFs, we could use a PDF parsing library, but that would be complex in serverless.
      // Placeholder: we'll note that PDF processing is not implemented yet.
      extractedText = "PDF uploaded. Text extraction not yet implemented.";
      summary = "PDF file received.";
    } else {
      extractedText = "Unsupported file type.";
      summary = "File uploaded but not processed.";
    }

    return {
      storageId,
      fileName: args.fileName,
      fileUrl,
      summary,
      content: extractedText,
    };
  },
});

// -----------------------------------------------------------------------------
// Summarize text
// -----------------------------------------------------------------------------
export const summarizeText = action({
  args: {
    text: v.string(),
    length: v.optional(v.string()), // "short", "medium", "long"
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const lengthInstruction = args.length || "medium";
    const lengthMap = {
      short: "a brief paragraph",
      medium: "a few paragraphs",
      long: "a detailed summary",
    };

    const prompt = `Summarize the following text in ${lengthMap[lengthInstruction as keyof typeof lengthMap] || lengthMap.medium}:\n\n${args.text}`;

    const summary = await callOpenAI([
      { role: "system", content: "You are a helpful assistant that summarizes text accurately." },
      { role: "user", content: prompt },
    ]);

    return { summary };
  },
});

// -----------------------------------------------------------------------------
// Generate flashcards from text
// -----------------------------------------------------------------------------
export const generateFlashcards = action({
  args: {
    text: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const flashcardCount = args.count || 10;

    const prompt = `Based on the following text, generate ${flashcardCount} flashcards. Each flashcard should have a "front" (question or term) and "back" (answer or definition). Return the result as a JSON array of objects with keys "front" and "back". Do not include any other text.\n\nText:\n${args.text}`;

    const response = await callOpenAI([
      { role: "system", content: "You are a helpful assistant that creates flashcards for medical students." },
      { role: "user", content: prompt },
    ]);

    try {
      // Attempt to parse JSON response
      const flashcards = JSON.parse(response);
      if (Array.isArray(flashcards) && flashcards.every(f => "front" in f && "back" in f)) {
        return flashcards;
      } else {
        throw new Error("Invalid flashcard format");
      }
    } catch (e) {
      // Fallback: return raw text as a single flashcard
      return [{ front: "Generated content", back: response }];
    }
  },
});

// -----------------------------------------------------------------------------
// Generate practice questions from text
// -----------------------------------------------------------------------------
export const generateQuestions = action({
  args: {
    text: v.string(),
    count: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const questionCount = args.count || 5;

    const prompt = `Based on the following text, generate ${questionCount} multiple-choice practice questions. Each question should have a "question" (the question text), "options" (an array of 4 strings, labeled A through D), "answer" (the correct option letter, e.g., "A"), and "explanation" (a brief explanation). Return the result as a JSON array of objects with keys "question", "options", "answer", "explanation". Do not include any other text.\n\nText:\n${args.text}`;

    const response = await callOpenAI([
      { role: "system", content: "You are a helpful assistant that creates medical practice questions." },
      { role: "user", content: prompt },
    ]);

    try {
      const questions = JSON.parse(response);
      if (Array.isArray(questions) && questions.every(q => "question" in q && "options" in q && "answer" in q && "explanation" in q)) {
        return questions;
      } else {
        throw new Error("Invalid question format");
      }
    } catch (e) {
      // Fallback: return one simple question
      return [{
        question: "Generated question could not be parsed",
        options: ["A. Try again", "B. Contact support", "C. Ignore", "D. None"],
        answer: "D",
        explanation: "The AI response was not in the expected format. Please try again with different text."
      }];
    }
  },
});

// -----------------------------------------------------------------------------
// Generate study plan based on weak topics
// -----------------------------------------------------------------------------
export const getStudyPlan = action({
  args: {
    weakTopics: v.array(v.string()),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const planDays = args.days || 7;

    const prompt = `Create a ${planDays}-day study plan for a medical student focusing on the following weak topics: ${args.weakTopics.join(", ")}. For each day, provide a list of tasks (e.g., review topic, practice questions, etc.). Return the result as a JSON array of objects with keys "day" (number) and "tasks" (array of strings). Do not include any other text.`;

    const response = await callOpenAI([
      { role: "system", content: "You are a helpful medical education advisor." },
      { role: "user", content: prompt },
    ]);

    try {
      const plan = JSON.parse(response);
      if (Array.isArray(plan) && plan.every(p => "day" in p && "tasks" in p)) {
        return plan;
      } else {
        throw new Error("Invalid plan format");
      }
    } catch (e) {
      // Fallback: return a simple plan
      return Array.from({ length: planDays }, (_, i) => ({
        day: i + 1,
        tasks: ["Review weak topics", "Practice 20 questions", "Review explanations"],
      }));
    }
  },
});

// -----------------------------------------------------------------------------
// Generate mnemonics for medical terms
// -----------------------------------------------------------------------------
export const getMnemonics = action({
  args: {
    terms: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Not authenticated");

    const prompt = `Create a memorable mnemonic for each of the following medical terms. For each term, provide a short, easy-to-remember mnemonic that helps recall the term's meaning or details. Return the result as a JSON array of objects with keys "term" and "mnemonic". Do not include any other text.\n\nTerms: ${args.terms.join(", ")}`;

    const response = await callOpenAI([
      { role: "system", content: "You are a creative medical educator specializing in mnemonics." },
      { role: "user", content: prompt },
    ]);

    try {
      const mnemonics = JSON.parse(response);
      if (Array.isArray(mnemonics) && mnemonics.every(m => "term" in m && "mnemonic" in m)) {
        return mnemonics;
      } else {
        throw new Error("Invalid mnemonic format");
      }
    } catch (e) {
      // Fallback: return simple mnemonics
      return args.terms.map(term => ({
        term,
        mnemonic: `Create your own mnemonic for ${term}`,
      }));
    }
  },
});
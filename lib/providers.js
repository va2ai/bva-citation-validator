/**
 * Multi-provider LLM abstraction.
 *
 * Provides a unified interface for calling Claude (Anthropic) and Gemini (Google)
 * models. Each provider returns the same shape: { text, usage }.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

const PROVIDERS = {
  // Anthropic models
  "claude-sonnet-4-6": { provider: "anthropic", model: "claude-sonnet-4-6" },
  "claude-haiku-4-5-20251001": { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  "claude-opus-4-6": { provider: "anthropic", model: "claude-opus-4-6" },
  "claude-sonnet-4-5": { provider: "anthropic", model: "claude-sonnet-4-5" },
  // Google models
  "gemini-2.0-flash": { provider: "google", model: "gemini-2.0-flash" },
  "gemini-2.5-flash": { provider: "google", model: "gemini-2.5-flash-preview-05-20" },
};

export const MODEL_LIST = Object.keys(PROVIDERS);

export function getProviderInfo(modelId) {
  return PROVIDERS[modelId] || { provider: "anthropic", model: modelId };
}

// ---------------------------------------------------------------------------
// Singleton clients
// ---------------------------------------------------------------------------

let _anthropic;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

let _google;
function getGoogle() {
  if (!_google) {
    const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY required for Gemini models");
    _google = new GoogleGenerativeAI(key);
  }
  return _google;
}

// ---------------------------------------------------------------------------
// Unified generate function
// ---------------------------------------------------------------------------

/**
 * Generate a response using any supported model.
 *
 * @param {object} options
 * @param {string} options.model - Model ID (e.g. "claude-sonnet-4-6", "gemini-2.0-flash")
 * @param {string} options.system - System prompt
 * @param {string} options.userMessage - User message content
 * @param {number} [options.maxTokens=2048] - Max output tokens
 * @returns {Promise<{text: string, usage: {input_tokens: number, output_tokens: number}, model: string}>}
 */
export async function generate(options) {
  const { model, system, userMessage, maxTokens = 2048 } = options;
  const info = getProviderInfo(model);

  if (info.provider === "google") {
    return generateGoogle(info.model, system, userMessage, maxTokens);
  }
  return generateAnthropic(info.model, system, userMessage, maxTokens);
}

async function generateAnthropic(model, system, userMessage, maxTokens) {
  const client = getAnthropic();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userMessage }],
  });

  return {
    text: response.content[0].text,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
    model: response.model,
  };
}

async function generateGoogle(model, system, userMessage, maxTokens) {
  const ai = getGoogle();
  const genModel = ai.getGenerativeModel({
    model,
    systemInstruction: system,
    generationConfig: { maxOutputTokens: maxTokens },
  });

  const result = await genModel.generateContent(userMessage);
  const response = result.response;
  const text = response.text() || "";
  const usage = response.usageMetadata || {};

  return {
    text,
    usage: {
      input_tokens: usage.promptTokenCount || 0,
      output_tokens: usage.candidatesTokenCount || 0,
    },
    model,
  };
}

/**
 * Get the Anthropic client (for structured output calls that need it directly).
 */
export { getAnthropic };

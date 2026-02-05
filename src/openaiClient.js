import OpenAI from "openai";

let cachedClient = null;

export function getOpenAIClient() {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in environment.");
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}


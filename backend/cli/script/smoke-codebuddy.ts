#!/usr/bin/env bun
/**
 * Smoke-test CodeBuddy provider wiring: stream + non-stream aggregation.
 * Usage: bun run script/smoke-codebuddy.ts
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, streamText } from "ai"
import { codebuddyBaseURL, codebuddyFetch } from "../src/provider/codebuddy-fetch"

const apiKey = process.env.CODEBUDDY_API_KEY
if (!apiKey) {
  console.error("CODEBUDDY_API_KEY is not set")
  process.exit(1)
}

const baseURL = codebuddyBaseURL()
console.log("baseURL:", baseURL)

const provider = createOpenAICompatible({
  name: "codebuddy",
  apiKey,
  baseURL,
  fetch: codebuddyFetch as typeof fetch,
})

const model = provider.chatModel("glm-5.2")

console.log("\n--- streamText ---")
const streamed = streamText({
  model,
  prompt: "Reply with exactly one word: pong",
  maxOutputTokens: 32,
})
let text = ""
for await (const part of streamed.textStream) text += part
console.log("stream result:", JSON.stringify(text))

console.log("\n--- generateText (forces non-stream client → aggregated) ---")
const generated = await generateText({
  model,
  prompt: "Reply with exactly one word: pong",
  maxOutputTokens: 32,
})
console.log("generate result:", JSON.stringify(generated.text))

if (!/pong/i.test(text) || !/pong/i.test(generated.text)) {
  console.error("FAIL: expected pong in both responses")
  process.exit(1)
}
console.log("\nOK: CodeBuddy provider smoke test passed")

#!/usr/bin/env bun
/**
 * Smoke-test Qoder provider via AI SDK (Bun).
 * Usage: QODER_API_KEY=pt-... bun run script/smoke-qoder.ts
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateText, streamText } from "ai"
import { qoderBaseURL, qoderFetch, qoderResolveSession, qoderMode } from "../src/provider/qoder"

const apiKey = process.env.QODER_API_KEY || process.env.QODER_PAT || process.env.QODER_PERSONAL_ACCESS_TOKEN
if (!apiKey) {
  console.error("QODER_API_KEY is not set")
  process.exit(1)
}

const mode = qoderMode()
const baseURL = qoderBaseURL()
console.log("mode:", mode)
console.log("baseURL:", baseURL)

const session = await qoderResolveSession(apiKey, mode)
console.log("exchange OK:", session.userID)

const provider = createOpenAICompatible({
  name: "qoder",
  apiKey,
  baseURL,
  fetch: qoderFetch as typeof fetch,
})

const modelID = process.env.QODER_SMOKE_MODEL || "qwen3.8-max"
const model = provider.chatModel(modelID)

async function run() {
  console.log("\n--- generateText ---")
  try {
    const generated = await generateText({
      model,
      prompt: "Reply with exactly one word: pong",
      maxOutputTokens: 32,
    })
    console.log("generate result:", JSON.stringify(generated.text))
    if (!generated.text) throw new Error("empty text")
    console.log("\nOK: Qoder provider smoke test passed")
    return
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log("generate error:", message.slice(0, 500))
    if (message.includes("112") || message.includes("pricingUrl") || message.includes("402")) {
      console.log("\nOK: Qoder protocol verified (quota/pricing). Top up at https://qoder.com/pricing")
      return
    }
    throw err
  }
}

await run()

console.log("\n--- streamText ---")
try {
  const streamed = streamText({
    model,
    prompt: "Reply with exactly one word: pong",
    maxOutputTokens: 32,
  })
  let text = ""
  for await (const part of streamed.textStream) text += part
  console.log("stream result:", JSON.stringify(text))
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  console.log("stream error:", message.slice(0, 300))
  if (!(message.includes("112") || message.includes("pricingUrl") || message.includes("402"))) throw err
}

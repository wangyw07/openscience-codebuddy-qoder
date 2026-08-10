#!/usr/bin/env bun
/**
 * Protocol smoke for Qoder (no AI SDK dependency).
 * Usage: QODER_API_KEY=pt-... bun run script/smoke-qoder-protocol.ts
 */
import { qoderBaseURL, qoderFetch, qoderMode, qoderResolveSession } from "../src/provider/qoder"

const apiKey = process.env.QODER_API_KEY || process.env.QODER_PAT || process.env.QODER_PERSONAL_ACCESS_TOKEN
if (!apiKey) {
  console.error("QODER_API_KEY is not set")
  process.exit(1)
}

const mode = qoderMode()
console.log("mode:", mode)
console.log("baseURL:", qoderBaseURL())

const session = await qoderResolveSession(apiKey, mode)
console.log("exchange OK:", session.userID, session.email)

const model = process.env.QODER_SMOKE_MODEL || "qwen3.8-max"
const res = await qoderFetch(`${qoderBaseURL()}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model,
    messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
    max_tokens: 32,
    stream: false,
  }),
})

const text = await res.text()
console.log("status:", res.status)
console.log("body:", text.slice(0, 800))

if (res.ok) {
  const json = JSON.parse(text)
  const content = json.choices?.[0]?.message?.content || ""
  console.log("content:", JSON.stringify(content))
  if (!content) {
    console.error("FAIL: empty completion")
    process.exit(1)
  }
  console.log("\nOK: Qoder completion succeeded")
  process.exit(0)
}

if (res.status === 402 || text.includes('"code":"112"') || text.includes("pricingUrl")) {
  console.log("\nOK: Qoder protocol verified (quota/pricing). Top up https://qoder.com/pricing")
  process.exit(0)
}

console.error("FAIL: unexpected response")
process.exit(1)

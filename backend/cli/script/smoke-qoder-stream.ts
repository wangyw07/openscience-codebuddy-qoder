#!/usr/bin/env bun
import { qoderBaseURL, qoderFetch, qoderResolveSession } from "../src/provider/qoder"

const apiKey = process.env.QODER_API_KEY!
await qoderResolveSession(apiKey)
const res = await qoderFetch(`${qoderBaseURL()}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: "qwen3.8-max",
    messages: [{ role: "user", content: "Reply with exactly one word: pong" }],
    max_tokens: 32,
    stream: true,
  }),
})
console.log("stream status", res.status, res.headers.get("content-type"))
const text = await res.text()
console.log(text.slice(0, 600))
console.log("has DONE", text.includes("[DONE]"))
console.log("has pong", /pong/i.test(text))
if (!/pong/i.test(text) && !text.includes("112") && !text.includes("pricingUrl")) process.exit(1)
console.log("OK stream path")

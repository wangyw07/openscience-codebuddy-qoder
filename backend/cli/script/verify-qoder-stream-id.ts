#!/usr/bin/env bun
/**
 * Verify Qoder public model ids + that stream mode yields early chunks
 * (cancel after first content — Cosy can keep the socket open after tokens).
 */
import { qoderBaseURL, qoderFetch, qoderModelKey, qoderPublicModelId } from "../src/provider/qoder"
import { qoderDefaultModels, qoderModelsDevProvider } from "../src/provider/qoder/defaults"

const failures: string[] = []

const catalog = qoderModelsDevProvider()
for (const [key, model] of Object.entries(catalog.models)) {
  if (model.id !== key) failures.push(`catalog id mismatch ${key} => ${model.id}`)
}
for (const [key, model] of Object.entries(qoderDefaultModels())) {
  if ("id" in model) failures.push(`defaults still has Cosy id on ${key}`)
}
for (const [friendly, cosy] of [
  ["qwen3.8-max", "qmodel_38max"],
  ["qwen3.7-plus", "qmodel"],
  ["deepseek-v4-pro", "dmodel"],
] as const) {
  if (qoderModelKey(friendly) !== cosy) failures.push(`qoderModelKey(${friendly})`)
  if (qoderPublicModelId(cosy) !== friendly) failures.push(`qoderPublicModelId(${cosy})`)
}
console.log("catalog OK")

const key =
  process.env.QODER_API_KEY || process.env.QODER_PAT || process.env.QODER_PERSONAL_ACCESS_TOKEN
if (!key) {
  console.log("SKIP live (no key)")
} else {
  // Non-stream: public model id in completion
  {
    const res = await qoderFetch(`${qoderBaseURL()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-v4-pro",
        stream: false,
        max_tokens: 24,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      }),
    })
    const text = await res.text()
    console.log("nonstream", res.status, text.slice(0, 160).replace(/\s+/g, " "))
    if (!res.ok) failures.push(`nonstream HTTP ${res.status}`)
    if (!/"model"\s*:\s*"deepseek-v4-pro"/.test(text)) failures.push("nonstream missing public model id")
    if (/"model"\s*:\s*"dmodel"/.test(text)) failures.push("nonstream leaked Cosy id")
  }

  // Stream: first chunk must arrive before the full generation finishes
  {
    const started = Date.now()
    const ac = new AbortController()
    const kill = setTimeout(() => ac.abort(), 30_000)
    const res = await qoderFetch(`${qoderBaseURL()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: ac.signal,
      body: JSON.stringify({
        model: "qwen3.7-plus",
        stream: true,
        max_tokens: 48,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
      }),
    })
    const headerMs = Date.now() - started
    if (!res.ok || !res.body) {
      failures.push(`stream HTTP ${res.status}`)
    } else {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let firstMs = 0
      let buf = ""
      let chunks = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!firstMs) firstMs = Date.now() - started
          chunks++
          buf += decoder.decode(value, { stream: true })
          // Enough to prove incremental SSE delivery
          if (chunks >= 2 || buf.includes("content") || buf.includes("[DONE]")) break
        }
      } finally {
        clearTimeout(kill)
        try {
          await reader.cancel()
        } catch {}
        ac.abort()
      }
      console.log(
        JSON.stringify({
          headerMs,
          firstMs,
          chunks,
          hasPublic: /qwen3\.7-plus/.test(buf),
          hasCosy: /"model"\s*:\s*"qmodel"/.test(buf),
          preview: buf.slice(0, 140).replace(/\s+/g, " "),
        }),
      )
      if (chunks < 1) failures.push("no stream chunks")
      if (!firstMs) failures.push("no first stream byte")
      // Old buffered adapter returned the body only after Cosy finished (seconds later).
      // New adapter should surface SSE shortly after headers.
      if (firstMs > headerMs + 2000) failures.push(`first chunk too late after headers: ${firstMs - headerMs}ms`)
      if (!/qwen3\.7-plus/.test(buf)) failures.push("stream missing public model id")
      if (/"model"\s*:\s*"qmodel"/.test(buf)) failures.push("stream leaked Cosy id")
    }
  }
}

if (failures.length) {
  console.error("FAILURES")
  for (const f of failures) console.error("-", f)
  process.exit(1)
}
console.log("ALL CHECKS PASSED")

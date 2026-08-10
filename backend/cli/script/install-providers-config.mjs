#!/usr/bin/env node
/**
 * Merge full CodeBuddy + Qoder catalogs into ~/.config/openscience/openscience.json
 * without wiping unrelated keys.
 */
import fs from "fs"
import path from "path"
import os from "os"
import { createRequire } from "module"
import { pathToFileURL } from "url"

const require = createRequire(import.meta.url)

// Load defaults via bun-friendly dynamic import when run under bun; for node,
// duplicate the catalog inline (same as bundled defaults).
const codebuddyModels = {
  auto: { name: "Auto", tool_call: true, temperature: true, limit: { context: 200000, output: 8192 } },
  hy3: {
    name: "Hy3",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 200000, output: 8192 },
  },
  "glm-5.2": {
    name: "GLM-5.2",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 200000, output: 8192 },
  },
  "glm-5.1": { name: "GLM-5.1", tool_call: true, temperature: true, limit: { context: 200000, output: 8192 } },
  "glm-5v-turbo": {
    name: "GLM-5v-Turbo",
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
  },
  "kimi-k3": {
    name: "Kimi-K3",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 200000, output: 8192 },
  },
  "kimi-k2.7": {
    name: "Kimi-K2.7-Code",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 200000, output: 8192 },
  },
  "kimi-k2.6": {
    name: "Kimi-K2.6",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 200000, output: 8192 },
  },
  "minimax-m3": {
    name: "MiniMax-M3",
    tool_call: true,
    temperature: true,
    limit: { context: 200000, output: 8192 },
  },
  "deepseek-v4-pro": {
    name: "DeepSeek-V4-Pro",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 200000, output: 8192 },
  },
  "deepseek-v4-flash": {
    name: "DeepSeek-V4-Flash",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 200000, output: 8192 },
  },
}

const qoderModels = {
  auto: {
    name: "Auto",
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
  },
  ultimate: {
    name: "Ultimate",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 8192 },
  },
  performance: {
    name: "Performance",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 8192 },
  },
  efficient: {
    name: "Efficient",
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
  },
  lite: {
    name: "Lite",
    tool_call: true,
    temperature: true,
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
  },
  cantus: {
    name: "Cantus",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
  },
  "qwen3.8-max": {
    name: "Qwen3.8-Max",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
  },
  "qwen3.7-max": {
    name: "Qwen3.7-Max",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 8192 },
  },
  "qwen3.7-plus": {
    name: "Qwen3.7-Plus",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 1000000, output: 8192 },
  },
  "kimi-k3": {
    name: "Kimi-K3",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 200000, output: 8192 },
  },
  "kimi-k2.7": {
    name: "Kimi-K2.7-Code",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 256000, output: 8192 },
  },
  "glm-5.2": {
    name: "GLM-5.2",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 8192 },
  },
  "deepseek-v4-pro": {
    name: "DeepSeek-V4-Pro",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 1000000, output: 8192 },
  },
  "deepseek-v4-flash": {
    name: "DeepSeek-V4-Flash",
    tool_call: true,
    temperature: true,
    limit: { context: 1000000, output: 8192 },
  },
  "minimax-m3": {
    name: "MiniMax-M3",
    tool_call: true,
    temperature: true,
    limit: { context: 1000000, output: 8192 },
  },
}

const cfgDir = path.join(os.homedir(), ".config", "openscience")
fs.mkdirSync(cfgDir, { recursive: true })
const existingJson = path.join(cfgDir, "openscience.json")
let existing = {}
try {
  existing = JSON.parse(fs.readFileSync(existingJson, "utf8"))
} catch {}

const enabled = new Set([...(existing.enabled_providers ?? []), "codebuddy", "qoder"])
const config = {
  ...existing,
  $schema: existing.$schema ?? "https://syntheticsciences.ai/config.json",
  billing: existing.billing ?? { llm: "byok" },
  enabled_providers: [...enabled],
  provider: {
    ...(existing.provider ?? {}),
    codebuddy: {
      name: "CodeBuddy",
      npm: "@ai-sdk/openai-compatible",
      env: ["CODEBUDDY_API_KEY"],
      api: "https://www.codebuddy.cn/v2",
      options: {
        baseURL: "https://www.codebuddy.cn/v2",
        apiKey: "{env:CODEBUDDY_API_KEY}",
      },
      models: codebuddyModels,
    },
    qoder: {
      name: "Qoder",
      npm: "@ai-sdk/openai-compatible",
      env: ["QODER_API_KEY", "QODER_PAT", "QODER_PERSONAL_ACCESS_TOKEN"],
      api: "http://qoder.openscience.local/v1",
      options: {
        baseURL: "http://qoder.openscience.local/v1",
        apiKey: "{env:QODER_API_KEY}",
      },
      models: qoderModels,
    },
  },
}

fs.writeFileSync(existingJson, JSON.stringify(config, null, 2) + "\n")
console.log("wrote", existingJson)
console.log(
  "codebuddy",
  Object.keys(codebuddyModels).length,
  "qoder",
  Object.keys(qoderModels).length,
  "enabled",
  config.enabled_providers.join(","),
)

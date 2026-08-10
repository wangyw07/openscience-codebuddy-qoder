import fs from "fs"
import path from "path"
import os from "os"

const cfgDir = path.join(os.homedir(), ".config", "openscience")
fs.mkdirSync(cfgDir, { recursive: true })

const existingJson = path.join(cfgDir, "openscience.json")
let existing = {}
try {
  existing = JSON.parse(fs.readFileSync(existingJson, "utf8"))
} catch {}

const qoderModels = {
  auto: {
    name: "Qoder Auto",
    tool_call: true,
    temperature: true,
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
  "qwen3.7-plus": {
    name: "Qwen3.7-Plus",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 1000000, output: 8192 },
  },
  "deepseek-v4-flash": {
    name: "DeepSeek V4 Flash",
    tool_call: true,
    temperature: true,
    limit: { context: 1000000, output: 8192 },
  },
  "glm-5.2": {
    name: "GLM-5.2",
    tool_call: true,
    temperature: true,
    reasoning: true,
    interleaved: { field: "reasoning_content" },
    limit: { context: 1000000, output: 8192 },
  },
}

const enabled = new Set([...(existing.enabled_providers ?? []), "qoder"])
const config = {
  ...existing,
  $schema: existing.$schema ?? "https://syntheticsciences.ai/config.json",
  billing: existing.billing ?? { llm: "byok" },
  enabled_providers: [...enabled],
  provider: {
    ...(existing.provider ?? {}),
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

if (!config.model) config.model = "qoder/qwen3.8-max"
if (!config.small_model) config.small_model = "qoder/deepseek-v4-flash"

fs.writeFileSync(existingJson, JSON.stringify(config, null, 2) + "\n")
console.log("wrote", existingJson)
console.log("Set QODER_API_KEY=pt-... then restart openscience")

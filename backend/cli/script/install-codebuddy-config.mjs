import fs from "fs"
import path from "path"
import os from "os"

const cfgDir = path.join(os.homedir(), ".config", "openscience")
fs.mkdirSync(cfgDir, { recursive: true })

const existingJson = path.join(cfgDir, "openscience.json")
let skills
try {
  skills = JSON.parse(fs.readFileSync(existingJson, "utf8")).skills
} catch {}

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

const config = {
  $schema: "https://syntheticsciences.ai/config.json",
  model: "codebuddy/glm-5.2",
  small_model: "codebuddy/deepseek-v4-flash",
  enabled_providers: ["codebuddy"],
  billing: { llm: "byok" },
  provider: {
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
  },
}
if (skills) config.skills = skills

fs.writeFileSync(existingJson, JSON.stringify(config, null, 2) + "\n")
console.log("wrote", existingJson)

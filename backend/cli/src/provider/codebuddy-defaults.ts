/** Default CodeBuddy catalog aligned with CodeBuddy built-in models UI. */
export function codebuddyDefaultModels() {
  const base = {
    tool_call: true,
    temperature: true,
    limit: { context: 200000, output: 8192 },
    cost: { input: 0, output: 0 },
    modalities: { input: ["text"], output: ["text"] },
  }
  const reasoning = {
    reasoning: true,
    interleaved: { field: "reasoning_content" },
  }
  return {
    auto: { name: "Auto", ...base },
    hy3: { name: "Hy3", ...base, ...reasoning },
    "glm-5.2": { name: "GLM-5.2", ...base, ...reasoning },
    "glm-5.1": { name: "GLM-5.1", ...base },
    "glm-5v-turbo": {
      name: "GLM-5v-Turbo",
      ...base,
      attachment: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    },
    "kimi-k3": { name: "Kimi-K3", ...base, ...reasoning },
    "kimi-k2.7": { name: "Kimi-K2.7-Code", ...base, ...reasoning },
    "kimi-k2.6": { name: "Kimi-K2.6", ...base, ...reasoning },
    "minimax-m3": { name: "MiniMax-M3", ...base },
    "deepseek-v4-pro": { name: "DeepSeek-V4-Pro", ...base, ...reasoning },
    "deepseek-v4-flash": { name: "DeepSeek-V4-Flash", ...base, ...reasoning },
  }
}

export function codebuddyModelsDevProvider() {
  const models = codebuddyDefaultModels()
  return {
    id: "codebuddy",
    name: "CodeBuddy",
    env: ["CODEBUDDY_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://www.codebuddy.cn/v2",
    models: Object.fromEntries(
      Object.entries(models).map(([modelID, model]) => [
        modelID,
        {
          id: modelID,
          name: model.name,
          family: "codebuddy",
          release_date: "2026-01-01",
          attachment: "attachment" in model ? !!model.attachment : false,
          reasoning: "reasoning" in model ? !!model.reasoning : false,
          tool_call: model.tool_call,
          temperature: model.temperature,
          interleaved: "interleaved" in model ? model.interleaved : undefined,
          cost: model.cost,
          limit: model.limit,
          modalities: model.modalities,
          options: {},
        },
      ]),
    ),
  }
}

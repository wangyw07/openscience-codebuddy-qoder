/** Default Qoder catalog (config-only; not in models.dev).
 *
 * Catalog keys / api ids use the friendly selector ids (qwen3.8-max, …).
 * Cosy gateway keys (qmodel_38max, …) are mapped only in qoderModelKey().
 */
export function qoderDefaultModels() {
  const base = {
    tool_call: true,
    temperature: true,
    limit: { context: 200000, output: 8192 },
    cost: { input: 0, output: 0 },
    modalities: { input: ["text"], output: ["text"] },
  }
  const vision = {
    attachment: true,
    modalities: { input: ["text", "image"], output: ["text"] },
  }
  const reasoning = {
    reasoning: true,
    interleaved: { field: "reasoning_content" },
  }
  return {
    // Tier models (Qoder model selector)
    auto: { name: "Auto", ...base, ...vision },
    ultimate: {
      name: "Ultimate",
      ...base,
      ...vision,
      ...reasoning,
      limit: { context: 1000000, output: 8192 },
    },
    performance: {
      name: "Performance",
      ...base,
      ...vision,
      ...reasoning,
      limit: { context: 1000000, output: 8192 },
    },
    efficient: { name: "Efficient", ...base, ...vision },
    lite: { name: "Lite", ...base, ...vision },
    // Named models — ids match UI selector keys exactly
    cantus: {
      name: "Cantus",
      ...base,
      ...vision,
      ...reasoning,
    },
    "qwen3.8-max": {
      name: "Qwen3.8-Max",
      ...base,
      ...vision,
      ...reasoning,
    },
    "qwen3.7-max": {
      name: "Qwen3.7-Max",
      ...base,
      ...vision,
      ...reasoning,
      limit: { context: 1000000, output: 8192 },
    },
    "qwen3.7-plus": {
      name: "Qwen3.7-Plus",
      ...base,
      ...reasoning,
      limit: { context: 1000000, output: 8192 },
    },
    "kimi-k3": {
      name: "Kimi-K3",
      ...base,
      ...vision,
      ...reasoning,
    },
    "kimi-k2.7": {
      name: "Kimi-K2.7-Code",
      ...base,
      ...vision,
      ...reasoning,
      limit: { context: 256000, output: 8192 },
    },
    "glm-5.2": {
      name: "GLM-5.2",
      ...base,
      ...vision,
      ...reasoning,
      limit: { context: 1000000, output: 8192 },
    },
    "deepseek-v4-pro": {
      name: "DeepSeek-V4-Pro",
      ...base,
      ...reasoning,
      limit: { context: 1000000, output: 8192 },
    },
    "deepseek-v4-flash": {
      name: "DeepSeek-V4-Flash",
      ...base,
      limit: { context: 1000000, output: 8192 },
    },
    "minimax-m3": {
      name: "MiniMax-M3",
      ...base,
      limit: { context: 1000000, output: 8192 },
    },
  }
}

export function qoderModelsDevProvider() {
  const models = qoderDefaultModels()
  return {
    id: "qoder",
    name: "Qoder",
    env: ["QODER_API_KEY", "QODER_PAT", "QODER_PERSONAL_ACCESS_TOKEN"],
    npm: "@ai-sdk/openai-compatible",
    api: "http://qoder.openscience.local/v1",
    models: Object.fromEntries(
      Object.entries(models).map(([modelID, model]) => [
        modelID,
        {
          id: modelID,
          name: model.name,
          family: "qoder",
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

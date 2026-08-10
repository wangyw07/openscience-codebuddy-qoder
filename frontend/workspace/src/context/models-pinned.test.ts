import { describe, expect, test } from "bun:test"
import { DEFAULT_PINNED_MODELS, togglePinned } from "./models"

const model = (modelID: string, providerID = "anthropic") => ({ modelID, providerID })

describe("pinned models", () => {
  test("starts with the requested flagship trio", () => {
    expect(DEFAULT_PINNED_MODELS).toEqual([
      model("glm-5.2", "codebuddy"),
      model("deepseek-v4-pro", "codebuddy"),
      model("kimi-k2.7", "codebuddy"),
    ])
  })

  test("pins and unpins a model without duplicating it", () => {
    const pinned = togglePinned([], model("claude-opus-4-8"))
    expect(pinned).toEqual({
      models: [model("claude-opus-4-8")],
      pinned: true,
      limited: false,
    })

    expect(togglePinned(pinned.models, model("claude-opus-4-8"))).toEqual({
      models: [],
      pinned: false,
      limited: false,
    })
  })

  test("keeps the quick selector capped at three models", () => {
    const current = [model("claude-opus-4-8"), model("gpt-5-5", "openai"), model("gpt-5-5", "openai-codex")]
    expect(togglePinned(current, model("gemini-3-6-flash", "google"))).toEqual({
      models: current,
      pinned: false,
      limited: true,
    })
  })
})

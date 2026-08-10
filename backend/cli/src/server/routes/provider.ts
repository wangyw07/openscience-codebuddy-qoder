import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: Provider.Info.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const allProviders = await ModelsDev.get()
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        for (const [key, value] of Object.entries(allProviders)) {
          if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
            filteredProviders[key] = value
          }
        }

        const connected = await Provider.list()
        const providers = Object.assign(
          mapValues(filteredProviders, (x) => Provider.fromModelsDevProvider(x)),
          connected,
        )

        // Config-only providers (e.g. CodeBuddy, Qoder) are not in models.dev. Surface
        // them in `all` even before a credential is present so the UI tab exists
        // and Manage Models can show the catalog.
        for (const [providerID, provider] of Object.entries(config.provider ?? {})) {
          if (disabled.has(providerID)) continue
          if (enabled && !enabled.has(providerID)) continue
          if (providers[providerID]) continue
          if (!provider.models || Object.keys(provider.models).length === 0) continue
          providers[providerID] = Provider.fromModelsDevProvider({
            id: providerID,
            name: provider.name ?? providerID,
            env: provider.env ?? [],
            npm: provider.npm ?? "@ai-sdk/openai-compatible",
            api: typeof provider.api === "string" ? provider.api : provider.options?.baseURL,
            models: mapValues(provider.models, (model, modelID) => ({
              id: model.id ?? modelID,
              name: model.name ?? modelID,
              family: model.family ?? "",
              release_date: model.release_date ?? "2026-01-01",
              attachment: model.attachment ?? false,
              reasoning: model.reasoning ?? false,
              tool_call: model.tool_call ?? true,
              temperature: model.temperature ?? true,
              interleaved: model.interleaved,
              cost: model.cost ?? { input: 0, output: 0 },
              limit: model.limit ?? { context: 128000, output: 8192 },
              modalities: model.modalities ?? { input: ["text"], output: ["text"] },
              status: model.status,
              options: model.options ?? {},
            })),
          } as ModelsDev.Provider)
        }
        if (!providers.qoder && !(disabled.has("qoder") || (enabled && !enabled.has("qoder")))) {
          const { qoderModelsDevProvider } = await import("../../provider/qoder")
          providers.qoder = Provider.fromModelsDevProvider(qoderModelsDevProvider() as ModelsDev.Provider)
        }
        if (!providers.codebuddy && !(disabled.has("codebuddy") || (enabled && !enabled.has("codebuddy")))) {
          const { codebuddyModelsDevProvider } = await import("../../provider/codebuddy-defaults")
          providers.codebuddy = Provider.fromModelsDevProvider(codebuddyModelsDevProvider() as ModelsDev.Provider)
        }

        // Merge bundled catalogs so a partial openscience.json still surfaces
        // the full CodeBuddy / Qoder picker lists.
        for (const [providerID, load] of [
          ["qoder", async () => (await import("../../provider/qoder")).qoderModelsDevProvider()],
          ["codebuddy", async () => (await import("../../provider/codebuddy-defaults")).codebuddyModelsDevProvider()],
        ] as const) {
          if (!providers[providerID]) continue
          if (disabled.has(providerID)) continue
          if (enabled && !enabled.has(providerID)) continue
          const seed = Provider.fromModelsDevProvider((await load()) as ModelsDev.Provider)
          for (const [modelID, model] of Object.entries(seed.models)) {
            if (!providers[providerID].models[modelID]) providers[providerID].models[modelID] = model
          }
        }

        const redacted = Object.values(providers).map(Provider.redact)
        return c.json({
          all: redacted,
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0]?.id ?? ""),
          connected: Object.keys(connected),
        })
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method } = c.req.valid("json")
        try {
          const result = await ProviderAuth.authorize({
            providerID,
            method,
          })
          return c.json(result)
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          return c.json({ error: message }, { status: 400 })
        }
      },
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: z.string().meta({ description: "Provider ID" }),
        }),
      ),
      validator(
        "json",
        z.object({
          method: z.number().meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
        })
        return c.json(true)
      },
    ),
)

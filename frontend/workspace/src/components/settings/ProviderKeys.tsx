import { For, Show, createMemo, createSignal } from "solid-js"
import { Button } from "@synsci/ui/button"
import { StatusDot } from "@/atlas/shared/StatusDot"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useProviders } from "@/hooks/use-providers"
import { MODEL_PROVIDERS, MODEL_PROVIDER_LABELS, modelProvider } from "./model-providers"
import { credentialChange } from "./credential-change"

export function ProviderKeys(props: { onError?: (error: string | undefined) => void }) {
  const sdk = useGlobalSDK()
  const sync = useGlobalSync()
  const providers = useProviders()
  const [provider, setProvider] = createSignal<string>(MODEL_PROVIDERS[0].id)
  const [key, setKey] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  // Only keys saved through this panel (Auth.set → source "api"). A provider
  // pre-wired from openscience.json/.env is a real credential too, but an
  // unremovable "config"/"environment" row here reads as "you already set
  // this" to someone who never touched Settings — this list should be
  // exactly what "remove" can actually remove.
  const connected = createMemo(() =>
    providers
      .connected()
      .filter((item) => MODEL_PROVIDERS.some((provider) => provider.id === item.id))
      .filter((item) => item.source === "api"),
  )

  const save = async () => {
    const value = key().trim()
    if (!value || saving()) return
    setSaving(true)
    props.onError?.(undefined)
    // Don't wait on the disposed event to come back round the event stream —
    // if it is missed the key is saved but never appears, which reads as a
    // failed save. A refresh that fails outright is not a failed save either:
    // the input has already been cleared by then, so reporting it as one puts
    // an error banner over an empty field for a key that is on disk.
    const outcome = await credentialChange({
      write: async () => {
        await sdk.client.auth.set({ providerID: provider(), auth: { type: "api", key: value } })
        setKey("")
        await sdk.client.global.dispose()
      },
      refresh: () => sync.refreshProviders(),
      done: "Key saved",
    })
    setSaving(false)
    props.onError?.(outcome.notice)
  }

  const remove = async (providerID: string) => {
    if (!window.confirm(`Remove the ${MODEL_PROVIDER_LABELS[providerID] ?? providerID} key from this machine?`)) return
    props.onError?.(undefined)
    const outcome = await credentialChange({
      write: async () => {
        await sdk.client.auth.remove({ providerID })
        await sdk.client.global.dispose()
      },
      refresh: () => sync.refreshProviders(),
      done: "Key removed",
    })
    props.onError?.(outcome.notice)
  }

  return (
    <div class="flex flex-col gap-3">
      <form
        class="grid grid-cols-1 gap-2 rounded-[4px] border border-border-weak-base bg-surface-base/40 p-4 sm:grid-cols-[180px_1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label class="flex flex-col gap-1.5">
          <span class="text-12-medium text-text-weak">Provider</span>
          <select
            value={provider()}
            onChange={(event) => setProvider(event.currentTarget.value)}
            class="h-8 rounded-[4px] border border-border-weak-base bg-surface-base px-2.5 text-13-regular text-text-strong outline-none focus:border-border-strong-base"
          >
            <For each={MODEL_PROVIDERS}>{(provider) => <option value={provider.id}>{provider.label}</option>}</For>
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1.5">
          <span class="text-12-medium text-text-weak">API key</span>
          <input
            type="password"
            autocomplete="off"
            spellcheck={false}
            value={key()}
            onInput={(event) => setKey(event.currentTarget.value)}
            placeholder={modelProvider(provider()).placeholder}
            class="h-8 rounded-[4px] border border-border-weak-base bg-surface-base px-2.5 font-mono text-13-regular text-text-strong outline-none placeholder:text-text-weak focus:border-border-strong-base"
          />
        </label>
        <Button type="submit" size="small" variant="primary" disabled={saving() || !key().trim()}>
          {saving() ? "saving…" : "save key"}
        </Button>
      </form>

      <Show when={connected().length > 0}>
        <div class="overflow-hidden rounded-[4px] border border-border-weak-base bg-surface-base/40">
          <For each={connected()}>
            {(item) => (
              <div class="flex items-center justify-between gap-3 border-b border-border-weak-base px-4 py-3 last:border-none">
                <div class="flex min-w-0 items-center gap-2.5">
                  <StatusDot status="active" />
                  <span class="truncate text-13-medium text-text-strong">
                    {MODEL_PROVIDER_LABELS[item.id] ?? item.id}
                  </span>
                  <span
                    class="flex-shrink-0 rounded-[4px] border border-border-weak-base px-1.5 py-0.5 text-11-regular text-text-weak"
                    title="API key stored in the owner-only OpenScience auth file, not the system keychain"
                  >
                    local file
                  </span>
                </div>
                <Button size="small" variant="secondary" onClick={() => void remove(item.id)}>
                  remove
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

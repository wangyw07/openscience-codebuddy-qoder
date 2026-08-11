import { Server } from "../../server/server"
import { OpenScience } from "../../openscience"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { openUrl } from "../../util/open-url"
import { probeProtectedFolderAccess } from "../../file/protected-folder-access"

async function announceFdaIfNeeded() {
  const result = await probeProtectedFolderAccess()
  if (!result.blocked) return
  UI.empty()
  UI.println(UI.Style.TEXT_WARNING_BOLD + "  ⚠  Project folder access is blocked", UI.Style.TEXT_NORMAL)
  UI.empty()
  UI.println(
    UI.Style.TEXT_NORMAL,
    "  macOS is blocking OpenScience from listing ~/Desktop, ~/Documents and ~/Downloads.",
  )
  UI.println(UI.Style.TEXT_NORMAL, "  Grant access to the terminal or app that launches OpenScience.")
  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + "  Grant access:", UI.Style.TEXT_NORMAL)
  UI.println(UI.Style.TEXT_NORMAL, "    1. Open System Settings → Privacy & Security → Full Disk Access")
  UI.println(UI.Style.TEXT_NORMAL, "    2. Enable the terminal or desktop app you used to launch OpenScience")
  UI.println(UI.Style.TEXT_NORMAL, "    3. If you launch the binary directly, run `which openscience` to locate it")
  UI.println(UI.Style.TEXT_NORMAL, "    4. Quit (Ctrl+C), grant access, then relaunch `openscience web`")
  UI.empty()
}

export const WebCommand = cmd({
  // Default command: bare `openscience` and `openscience web` both open the
  // workspace in the browser. An optional [project] path runs it in that dir.
  command: ["web", "$0 [project]"],
  builder: (yargs) =>
    withNetworkOptions(yargs).positional("project", {
      type: "string",
      describe: "directory to open the workspace in",
    }),
  describe: "open the OpenScience workspace in your browser",
  handler: async (args) => {
    if (args.project) {
      try {
        process.chdir(args.project as string)
      } catch {
        UI.error(`Cannot open ${args.project}: no such directory`)
        process.exit(1)
      }
    }
    const opts = await resolveNetworkOptions(args)

    // No onboarding wizard and no startup banner here — keys are always
    // added from the workspace's own Settings → Provider keys panel, so the
    // CLI prompt asking "how do you want to power the models?" never applies
    // to this deployment. `openscience init` still runs it on request.

    // Run the dashboard sync BEFORE starting the server — and without
    // the 5s race timeout the global middleware uses. The model picker
    // and provider whitelist live in ~/.config/openscience/openscience-synced.json;
    // Config.state() reads that file once on first request and caches
    // for the process lifetime. If we start the HTTP server first, the
    // browser can race the sync and the picker shows the previous run's
    // catalogue. Doing it here, await-ed, guarantees the next browser
    // request sees the freshly-synced whitelist. Kept silent (errors aside):
    // this repeats on every `bun dev` restart and isn't news to report.
    const authed = await OpenScience.isAuthenticated()
    if (authed) {
      // Sync managed config before binding so the browser's first request sees
      // the fresh provider whitelist. But cap the wait: syncServices() has no
      // internal timeout, so a slow/unresponsive backend would otherwise hang
      // the launch forever (the server never binds). If the sync outlasts the
      // cap, bind anyway and let it finish in the background — the global
      // middleware also syncs per-request as a backstop.
      const SYNC_BUDGET_MS = 6000
      const synced = OpenScience.syncServices().catch(() => null)
      await Promise.race([synced, new Promise((r) => setTimeout(r, SYNC_BUDGET_MS))])
    }

    const server = Server.listen(opts)

    const base = `http://localhost:${server.port}`
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, base)

    openUrl(base)

    // macOS-only: warn when the host explicitly denies protected-folder
    // access. System Settings opens only after a deliberate UI action.
    await announceFdaIfNeeded()

    // Wait for a termination signal. Without an explicit handler Bun keeps
    // the process alive (the catch-all promise never resolves) and Ctrl+C
    // is ignored.
    await new Promise<void>((resolve) => {
      const stop = () => resolve()
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
    })
    // Hard-exit on Ctrl+C. Force-close active connections first, but never let
    // a stalled server.stop() (long-lived `/event` SSE streams) or an in-flight
    // background config sync (a pending fetch keeps Bun's loop alive) block the
    // exit — a watchdog forces it, and process.exit ignores dangling sockets.
    const watchdog = setTimeout(() => process.exit(0), 2000)
    watchdog.unref?.()
    try {
      await server.stop(true)
    } catch {
      // ignore — exiting regardless
    }
    process.exit(0)
  },
})

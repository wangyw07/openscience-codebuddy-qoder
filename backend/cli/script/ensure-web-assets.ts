#!/usr/bin/env bun

/**
 * Fresh clones have no frontend/workspace/dist and no gitignored
 * assets.generated.ts — without them `bun dev` serves 404 for /.
 * Build + regenerate once when either is missing.
 */
import fs from "fs"
import path from "path"
import { $ } from "bun"
import { fileURLToPath } from "url"

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const root = path.resolve(cli, "../..")
const dist = path.join(root, "frontend/workspace/dist/index.html")
const manifest = path.join(cli, "src/web/assets.generated.ts")

if (fs.existsSync(dist) && fs.existsSync(manifest)) process.exit(0)

// Quiet by default — this only prints when the one-time build actually
// fails, so `bun dev` doesn't dump the full Vite chunk manifest on every
// fresh clone. Re-run without `.quiet()` (or check the thrown output) to
// debug a failure.
const build = await $`bun run build`.cwd(path.join(root, "frontend/workspace")).quiet().nothrow()
if (build.exitCode !== 0) {
  console.error(build.stdout.toString())
  console.error(build.stderr.toString())
  process.exit(build.exitCode ?? 1)
}
const generate = await $`bun run script/generate-web-assets.ts`.cwd(cli).quiet().nothrow()
if (generate.exitCode !== 0) {
  console.error(generate.stdout.toString())
  console.error(generate.stderr.toString())
  process.exit(generate.exitCode ?? 1)
}

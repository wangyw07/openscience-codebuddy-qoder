import { EventEmitter } from "events"

export const GlobalBus = new EventEmitter<{
  event: [
    {
      directory?: string
      payload: any
    },
  ]
}>()
// Every open browser tab (SSE stream) and every live project instance holds
// its own listener here for the process lifetime — normal multi-tab,
// multi-project use legitimately exceeds Node's conservative default of 10
// and was tripping MaxListenersExceededWarning on plain startup noise, not an
// actual leak (each subscriber above already pairs its `.on` with an `.off`
// on disposal/disconnect).
GlobalBus.setMaxListeners(0)

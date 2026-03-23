// core/state.ts - Helpers for reading and writing session-state.json
import { getDataDir } from './env.ts'

export const getStateFile = () => `${getDataDir()}/session-state.json`

export async function loadPersistedState(): Promise<any> {
  const stateFile = getStateFile()
  try {
    const text = await Deno.readTextFile(stateFile)
    return JSON.parse(text)
  } catch (err) {
    if (err?.name === 'NotFound' || err?.code === 'ENOENT') {
      return { movieIndex: {} }
    }
    return { movieIndex: {} }
  }
}

export async function savePersistedState(state: any): Promise<void> {
  const dataDir = getDataDir()
  const stateFile = getStateFile()
  await Deno.mkdir(dataDir, { recursive: true }).catch(() => {})
  const tmp = `${stateFile}.tmp.${Date.now()}`
  try {
    await Deno.writeTextFile(tmp, JSON.stringify(state, null, 2))
    await Deno.rename(tmp, stateFile)
  } catch (err) {
    await Deno.remove(tmp).catch(() => {})
    throw err
  }
}

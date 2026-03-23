// infra/http/audit.ts - Append-only audit log writer
import type { CompatRequest } from './compat-request.ts'
import { getDataDir } from '../../core/env.ts'

const getAuditLogFile = () => `${getDataDir()}/audit.log`

export async function appendAuditLog(
  event: string,
  req: CompatRequest,
  details: Record<string, unknown> = {}
): Promise<void> {
  const dataDir = getDataDir()
  await Deno.mkdir(dataDir, { recursive: true }).catch(() => {})
  const ip = String(
    (req?.conn?.remoteAddr as Deno.NetAddr | undefined)?.hostname || 'unknown'
  )
  const entry = {
    ts: new Date().toISOString(),
    event,
    ip,
    method: String(req?.method || ''),
    path: (() => {
      try {
        return new URL(req?.url || '', 'http://local').pathname
      } catch {
        return ''
      }
    })(),
    ...details,
  }
  await Deno.writeTextFile(getAuditLogFile(), `${JSON.stringify(entry)}\n`, {
    append: true,
  }).catch(() => {})
}

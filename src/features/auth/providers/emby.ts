// src/features/auth/providers/emby.ts
// Authenticate a user against a locally-configured Emby server.
// Mirrors the Jellyfin provider — both servers share the same auth endpoint shape.

import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../../../infra/http/fetch-with-timeout.ts'

export interface EmbyUserInfo {
  id: string
  username: string
  avatarUrl: string
}

const DEVICE_ID = 'comparr-auth'
const DEVICE_NAME = 'Comparr'
const CLIENT_NAME = 'Comparr'
const VERSION = '1.0.0'

function authHeader(): string {
  return (
    `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", ` +
    `DeviceId="${DEVICE_ID}", Version="${VERSION}"`
  )
}

/**
 * Authenticate a user by proxying their credentials to the Emby server.
 * Returns user info on success; throws on bad credentials or server error.
 */
export async function authenticateEmbyUser(
  embyUrl: string,
  username: string,
  password: string
): Promise<EmbyUserInfo> {
  const url = `${embyUrl}/Users/AuthenticateByName`

  let res: Response
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Authorization': authHeader(),
      },
      body: JSON.stringify({ Username: username, Pw: password }),
    })
  } catch (err) {
    log.error(`[emby-auth] Network error: ${err}`)
    throw new Error('Could not reach your Emby server. Please try again.')
  }

  if (res.status === 401) {
    throw new Error('Invalid Emby username or password.')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn(`[emby-auth] Auth failed: ${res.status} ${body}`)
    throw new Error('Emby authentication failed. Please try again.')
  }

  const data = await res.json()
  const user = data.User ?? {}
  const userId = String(user.Id ?? '')
  const userName = String(user.Name ?? username)

  const avatarUrl = userId
    ? `${embyUrl}/Users/${userId}/Images/Primary?maxHeight=100&quality=90`
    : ''

  return { id: userId, username: userName, avatarUrl }
}

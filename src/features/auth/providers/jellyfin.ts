// src/features/auth/providers/jellyfin.ts
// Authenticate a user against a locally-configured Jellyfin server.
// The user's credentials are proxied to Jellyfin; Comparr never stores them.

import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../../../infra/http/fetch-with-timeout.ts'

export interface JellyfinUserInfo {
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
 * Authenticate a user by proxying their credentials to the Jellyfin server.
 * Returns user info on success; throws on bad credentials or server error.
 */
export async function authenticateJellyfinUser(
  jellyfinUrl: string,
  username: string,
  password: string
): Promise<JellyfinUserInfo> {
  const url = `${jellyfinUrl}/Users/AuthenticateByName`

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
    log.error(`[jellyfin-auth] Network error: ${err}`)
    throw new Error('Could not reach your Jellyfin server. Please try again.')
  }

  if (res.status === 401) {
    throw new Error('Invalid Jellyfin username or password.')
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    log.warn(`[jellyfin-auth] Auth failed: ${res.status} ${body}`)
    throw new Error('Jellyfin authentication failed. Please try again.')
  }

  const data = await res.json()
  const user = data.User ?? {}
  const userId = String(user.Id ?? '')
  const userName = String(user.Name ?? username)

  // Jellyfin doesn't return avatar URLs directly in auth; we construct the path
  const avatarUrl = userId
    ? `${jellyfinUrl}/Users/${userId}/Images/Primary?maxHeight=100&quality=90`
    : ''

  return { id: userId, username: userName, avatarUrl }
}

#!/usr/bin/env node
const { spawnSync } = require('child_process')

function runDenoLint() {
  const args = process.argv.slice(2)
  const denoArgs = ['lint', '--unstable', 'src', ...args]

  const result = spawnSync('deno', denoArgs, {
    stdio: 'inherit',
  })

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.warn(
        'Skipping "deno lint" because no deno binary was found in PATH.\n' +
          'Install Deno locally to enable this lint. See https://deno.land/manual/getting_started/installation.'
      )
      return 0
    }
    throw result.error
  }

  return result.status ?? 1
}

try {
  const status = runDenoLint()
  process.exit(status)
} catch (error) {
  console.error(error)
  process.exit(1)
}

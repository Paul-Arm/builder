import { spawnSync } from 'node:child_process'

const composeArgs = process.argv.slice(2)
if (!composeArgs.length) {
  console.error('Usage: node scripts/compose.mjs <docker compose args>')
  process.exit(1)
}

const contexts = dockerContexts()
const failures = []

for (const context of contexts) {
  const args = [
    ...(context ? ['--context', context] : []),
    'compose',
    ...composeArgs
  ]
  const result = spawnSync('docker', args, {
    cwd: process.cwd(),
    encoding: 'utf8'
  })

  if (result.status === 0) {
    write(result.stdout)
    write(result.stderr, true)
    process.exit(0)
  }

  failures.push({
    context: context || 'default',
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status
  })
}

for (const failure of failures) {
  console.error(`docker compose failed for context "${failure.context}" with exit code ${failure.status ?? 'unknown'}`)
  write(failure.stdout)
  write(failure.stderr, true)
}

process.exit(1)

function dockerContexts() {
  const configured = process.env.BUILDER_DOCKER_CONTEXT?.trim()
  const candidates = [
    configured || '',
    '',
    process.platform === 'win32' ? 'desktop-linux' : ''
  ].filter((value, index, values) => value || index === values.indexOf(value))

  return Array.from(new Set(candidates))
}

function write(value, error = false) {
  if (!value) {
    return
  }

  const stream = error ? process.stderr : process.stdout
  stream.write(value)
}

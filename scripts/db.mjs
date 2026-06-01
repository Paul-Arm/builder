import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import ts from 'typescript'
import { Surreal } from 'surrealdb'

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)))
const envPath = join(rootDir, '.env')
const schemaPath = join(rootDir, 'surreal', 'schema.surql')

loadDotEnv(envPath)

const projectStorePath = process.env.BUILDER_PROJECT_STORE_PATH
  || join(rootDir, '.data', 'projects.json')
const overlayUid = 'manual-project-overlay'
const baseTables = ['entity', 'relation', 'deployment', 'collector', 'insight']

const command = process.argv[2] || 'status'

try {
  switch (command) {
    case 'wait':
      await waitForDatabase()
      break
    case 'schema':
      await withDatabase(async (db) => {
        await applySchema(db)
      })
      break
    case 'seed':
      await withDatabase(async (db) => {
        await seedInventory(db)
      })
      break
    case 'migrate-local':
      await withDatabase(async (db) => {
        await migrateLocalProjectOverlay(db)
      })
      break
    case 'reset':
      await withDatabase(async (db) => {
        await applySchema(db)
        await seedInventory(db)
        await migrateLocalProjectOverlay(db)
      })
      break
    case 'status':
      await withDatabase(async (db) => {
        await printStatus(db)
      })
      break
    default:
      throw new Error(`Unknown db command "${command}"`)
  }
} catch (error) {
  console.error(errorMessage(error))
  process.exitCode = 1
}

async function waitForDatabase() {
  const startedAt = Date.now()
  const timeoutMs = numberFromEnv('BUILDER_DB_WAIT_MS', 30_000)
  let lastError = ''

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await withDatabase(async (db) => {
        await db.query('RETURN true;').collect()
      })
      console.log('SurrealDB is ready.')
      return
    } catch (error) {
      lastError = errorMessage(error)
      await sleep(1_000)
    }
  }

  throw new Error(`SurrealDB did not become ready within ${timeoutMs}ms. Last error: ${lastError}`)
}

async function withDatabase(fn) {
  const config = surrealConfigFromEnv()
  if (!config.url) {
    throw new Error('SURREALDB_URL is required. Copy .env.example to .env first.')
  }

  const db = new Surreal()
  try {
    await db.connect(config.url, {
      authentication: config.username && config.password
        ? {
            username: config.username,
            password: config.password
          }
        : undefined
    })
    await db.use({
      namespace: config.namespace,
      database: config.database
    })
    return await fn(db)
  } finally {
    await closeQuietly(db)
  }
}

async function applySchema(db) {
  const schema = readFileSync(schemaPath, 'utf8')
  await db.query(schema).collect()
  console.log('SurrealDB schema applied.')
}

async function seedInventory(db) {
  const { createSeedInventory } = await loadSeedInventoryModule()
  const inventory = createSeedInventory()

  for (const table of baseTables) {
    await db.query(`DELETE ${table};`).collect()
  }

  await createRows(db, 'entity', inventory.entities)
  await createRows(db, 'relation', inventory.relations)
  await createRows(db, 'deployment', inventory.deployments)
  await createRows(db, 'collector', inventory.collectors)
  await createRows(db, 'insight', inventory.insights)

  console.log(`Seeded ${inventory.entities.length} entities and ${inventory.relations.length} relations.`)
}

async function createRows(db, table, rows) {
  for (const row of rows) {
    await db.query(`CREATE ${table} CONTENT $row;`, {
      row: toDatabaseRow(row)
    }).collect()
  }
}

async function migrateLocalProjectOverlay(db) {
  const store = readProjectStoreFile()

  await db.query(`
    DEFINE TABLE IF NOT EXISTS project_overlay SCHEMALESS;
    DEFINE INDEX IF NOT EXISTS project_overlay_uid ON project_overlay FIELDS uid UNIQUE;
    DELETE project_overlay WHERE uid = $uid;
    CREATE project_overlay CONTENT $record;
  `, {
    uid: overlayUid,
    record: {
      uid: overlayUid,
      version: 1,
      entities: store.entities,
      relations: store.relations,
      updatedAt: new Date().toISOString()
    }
  }).collect()

  console.log(`Migrated local project overlay: ${store.entities.length} entities, ${store.relations.length} relations.`)
}

async function printStatus(db) {
  const [entities, relations, deployments, collectors, insights, overlays, secrets] = await db
    .query(`
      SELECT count() AS count FROM entity GROUP ALL;
      SELECT count() AS count FROM relation GROUP ALL;
      SELECT count() AS count FROM deployment GROUP ALL;
      SELECT count() AS count FROM collector GROUP ALL;
      SELECT count() AS count FROM insight GROUP ALL;
      SELECT count() AS count FROM project_overlay GROUP ALL;
      SELECT count() AS count FROM provider_secret GROUP ALL;
    `)
    .json()
    .collect()

  console.table({
    entity: countFromQuery(entities),
    relation: countFromQuery(relations),
    deployment: countFromQuery(deployments),
    collector: countFromQuery(collectors),
    insight: countFromQuery(insights),
    project_overlay: countFromQuery(overlays),
    provider_secret: countFromQuery(secrets)
  })
}

async function loadSeedInventoryModule() {
  const sourcePath = join(rootDir, 'server', 'utils', 'seed-inventory.ts')
  const cachePath = join(rootDir, '.data', '.cache', 'seed-inventory.mjs')
  const source = readFileSync(sourcePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false
    }
  }).outputText

  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, output, 'utf8')
  return import(`${pathToFileURL(cachePath).href}?t=${Date.now()}`)
}

function readProjectStoreFile() {
  if (!existsSync(projectStorePath)) {
    return {
      version: 1,
      entities: [],
      relations: []
    }
  }

  const parsed = JSON.parse(readFileSync(projectStorePath, 'utf8'))
  return {
    version: 1,
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    relations: Array.isArray(parsed.relations) ? parsed.relations : []
  }
}

function toDatabaseRow(row) {
  const { id, ...rest } = row
  return {
    uid: id,
    ...rest
  }
}

function countFromQuery(rows) {
  return Array.isArray(rows) && rows[0] && typeof rows[0].count === 'number'
    ? rows[0].count
    : 0
}

function surrealConfigFromEnv() {
  return {
    url: process.env.SURREALDB_URL || '',
    namespace: process.env.SURREALDB_NAMESPACE || 'builder',
    database: process.env.SURREALDB_DATABASE || 'inventory',
    username: process.env.SURREALDB_USERNAME || '',
    password: process.env.SURREALDB_PASSWORD || ''
  }
}

async function closeQuietly(db) {
  try {
    if (db.isConnected) {
      await db.close()
    }
  } catch {
    // Ignore shutdown errors in setup scripts.
  }
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) {
    return
  }

  const raw = readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      continue
    }

    const key = trimmed.slice(0, separator).trim()
    const value = unquote(trimmed.slice(separator + 1).trim())
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

function numberFromEnv(key, fallback) {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function errorMessage(error) {
  if (error && typeof error === 'object') {
    if ('message' in error && typeof error.message === 'string') {
      return error.message
    }

    if ('statusMessage' in error && typeof error.statusMessage === 'string') {
      return error.statusMessage
    }
  }

  return String(error)
}

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createError } from 'h3'
import { Surreal } from 'surrealdb'

type SecretSource = 'database' | 'file' | 'env' | 'missing'

interface SecretRecord {
  uid: string
  providerId: string
  key: string
  salt: string
  iv: string
  tag: string
  ciphertext: string
  fingerprint: string
  createdAt: string
  updatedAt: string
}

interface SecretStoreFile {
  version: 2
  records: Record<string, SecretRecord>
}

interface StoredSecretRecord {
  record: SecretRecord
  source: Extract<SecretSource, 'database' | 'file'>
}

interface SurrealConfig {
  url: string
  namespace: string
  database: string
  username: string
  password: string
}

export interface SecretStatus {
  configured: boolean
  source: SecretSource
  storeReady: boolean
  fingerprint?: string
  updatedAt?: string
}

const fileStorePath = process.env.BUILDER_SECRET_STORE_PATH
  || join(process.cwd(), '.data', 'secrets.enc.json')
const localKeyPath = process.env.BUILDER_SECRET_KEY_PATH
  || join(process.cwd(), '.data', 'secrets.key')
const databaseTimeoutMs = numberFromEnv('BUILDER_SECRET_DB_TIMEOUT_MS', 650)
const databaseBackoffMs = numberFromEnv('BUILDER_SECRET_DB_BACKOFF_MS', 30_000)

let databaseUnavailableUntil = 0

export function isSecretStoreReady() {
  return true
}

export async function providerSecretStatus(providerId: string, key: string): Promise<SecretStatus> {
  await ensureMasterSecret()
  const stored = await readStoredSecretRecord(providerId, key)

  return {
    configured: Boolean(stored),
    source: stored?.source || 'missing',
    storeReady: true,
    fingerprint: stored?.record.fingerprint,
    updatedAt: stored?.record.updatedAt
  }
}

export async function getProviderSecret(providerId: string, key: string) {
  const stored = await readStoredSecretRecord(providerId, key)
  if (!stored) {
    return undefined
  }

  return decryptSecret(stored.record)
}

export async function setProviderSecret(providerId: string, key: string, value: string) {
  const trimmedValue = value.trim()
  if (!trimmedValue) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Secret value is required'
    })
  }

  const id = recordId(providerId, key)
  const now = new Date().toISOString()
  const existing = await readStoredSecretRecord(providerId, key)
  const encrypted = await encryptSecret(trimmedValue)
  const record: SecretRecord = {
    uid: id,
    providerId,
    key,
    ...encrypted,
    fingerprint: fingerprintSecret(trimmedValue),
    createdAt: existing?.record.createdAt || now,
    updatedAt: now
  }

  const source = await writeStoredSecretRecord(record)

  return {
    configured: true,
    source,
    storeReady: true,
    fingerprint: record.fingerprint,
    updatedAt: record.updatedAt
  } satisfies SecretStatus
}

export async function deleteProviderSecret(providerId: string, key: string) {
  const id = recordId(providerId, key)

  await Promise.all([
    deleteDatabaseSecretRecord(id),
    deleteFileSecretRecord(id)
  ])
}

async function readStoredSecretRecord(providerId: string, key: string): Promise<StoredSecretRecord | undefined> {
  const id = recordId(providerId, key)
  const databaseRecord = await readDatabaseSecretRecord(id)
  if (databaseRecord) {
    return {
      record: databaseRecord,
      source: 'database'
    }
  }

  const fileRecord = await readFileSecretRecord(id)
  if (fileRecord) {
    return {
      record: fileRecord,
      source: 'file'
    }
  }

  return undefined
}

async function writeStoredSecretRecord(record: SecretRecord): Promise<Extract<SecretSource, 'database' | 'file'>> {
  if (await writeDatabaseSecretRecord(record)) {
    await deleteFileSecretRecord(record.uid)
    return 'database'
  }

  await writeFileSecretRecord(record)
  return 'file'
}

async function readDatabaseSecretRecord(uid: string) {
  const config = surrealConfigFromEnv()
  if (!config.url || !canUseDatabase()) {
    return undefined
  }

  const db = new Surreal()
  try {
    await withTimeout(connectSecretDatabase(db, config), databaseTimeoutMs, 'Secret database connect timed out')
    const [records] = await withTimeout(db
      .query<[SecretRecord[]]>(
        'SELECT * FROM provider_secret WHERE uid = $uid LIMIT 1;',
        { uid }
      )
      .json()
      .collect(), databaseTimeoutMs, 'Secret database read timed out')
    await closeQuietly(db)
    return normalizeDatabaseRecord(records?.[0])
  } catch (error) {
    markDatabaseUnavailable()
    await closeQuietly(db)
    console.warn('[secret-store] Database read failed, falling back to encrypted file store:', error)
    return undefined
  }
}

async function writeDatabaseSecretRecord(record: SecretRecord) {
  const config = surrealConfigFromEnv()
  if (!config.url || !canUseDatabase()) {
    return false
  }

  const db = new Surreal()
  try {
    await withTimeout(connectSecretDatabase(db, config), databaseTimeoutMs, 'Secret database connect timed out')
    await withTimeout(db
      .query(
        `
          DEFINE TABLE IF NOT EXISTS provider_secret SCHEMALESS;
          DEFINE INDEX IF NOT EXISTS provider_secret_uid ON provider_secret FIELDS uid UNIQUE;
          DELETE provider_secret WHERE uid = $uid;
          CREATE provider_secret CONTENT $record;
        `,
        {
          uid: record.uid,
          record
        }
      )
      .collect(), databaseTimeoutMs, 'Secret database write timed out')
    await closeQuietly(db)
    return true
  } catch (error) {
    markDatabaseUnavailable()
    await closeQuietly(db)
    console.warn('[secret-store] Database write failed, falling back to encrypted file store:', error)
    return false
  }
}

async function deleteDatabaseSecretRecord(uid: string) {
  const config = surrealConfigFromEnv()
  if (!config.url || !canUseDatabase()) {
    return
  }

  const db = new Surreal()
  try {
    await withTimeout(connectSecretDatabase(db, config), databaseTimeoutMs, 'Secret database connect timed out')
    await withTimeout(db
      .query('DELETE provider_secret WHERE uid = $uid;', { uid })
      .collect(), databaseTimeoutMs, 'Secret database delete timed out')
    await closeQuietly(db)
  } catch (error) {
    markDatabaseUnavailable()
    await closeQuietly(db)
    console.warn('[secret-store] Database delete failed:', error)
  }
}

async function connectSecretDatabase(db: Surreal, config: SurrealConfig) {
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
}

async function readFileSecretRecord(uid: string) {
  const store = await readFileStore()
  return store.records[uid]
}

async function writeFileSecretRecord(record: SecretRecord) {
  const store = await readFileStore()
  store.records[record.uid] = record
  await writeFileStore(store)
}

async function deleteFileSecretRecord(uid: string) {
  const store = await readFileStore()
  delete store.records[uid]
  await writeFileStore(store)
}

async function readFileStore(): Promise<SecretStoreFile> {
  try {
    const raw = await readFile(fileStorePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<SecretStoreFile>
    return {
      version: 2,
      records: parsed.records || {}
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        version: 2,
        records: {}
      }
    }

    throw error
  }
}

async function writeFileStore(store: SecretStoreFile) {
  await mkdir(dirname(fileStorePath), { recursive: true })
  const tmpPath = `${fileStorePath}.${process.pid}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(tmpPath, fileStorePath)
}

async function encryptSecret(value: string) {
  const salt = randomBytes(16).toString('base64')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(salt), iv)
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final()
  ])

  return {
    salt,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  }
}

async function decryptSecret(record: SecretRecord) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    await deriveKey(record.salt),
    Buffer.from(record.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'))

  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

async function deriveKey(salt: string) {
  return scryptSync(await ensureMasterSecret(), Buffer.from(salt, 'base64'), 32)
}

async function ensureMasterSecret() {
  const envSecret = process.env.BUILDER_SECRET_KEY || process.env.BUILDER_SECRET_STORE_KEY
  if (envSecret) {
    return envSecret
  }

  try {
    return (await readFile(localKeyPath, 'utf8')).trim()
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }

  const generatedSecret = randomBytes(32).toString('base64')
  await mkdir(dirname(localKeyPath), { recursive: true })
  await writeFile(localKeyPath, `${generatedSecret}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  return generatedSecret
}

async function closeQuietly(db: Surreal) {
  try {
    if (db.isConnected) {
      await db.close()
    }
  } catch {
    // Nothing useful to do during fallback.
  }
}

function surrealConfigFromEnv(): SurrealConfig {
  return {
    url: process.env.SURREALDB_URL || '',
    namespace: process.env.SURREALDB_NAMESPACE || 'builder',
    database: process.env.SURREALDB_DATABASE || 'inventory',
    username: process.env.SURREALDB_USERNAME || '',
    password: process.env.SURREALDB_PASSWORD || ''
  }
}

function normalizeDatabaseRecord(record?: SecretRecord) {
  if (!record) {
    return undefined
  }

  return {
    uid: record.uid,
    providerId: record.providerId,
    key: record.key,
    salt: record.salt,
    iv: record.iv,
    tag: record.tag,
    ciphertext: record.ciphertext,
    fingerprint: record.fingerprint,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  } satisfies SecretRecord
}

function canUseDatabase() {
  return Date.now() >= databaseUnavailableUntil
}

function markDatabaseUnavailable() {
  databaseUnavailableUntil = Date.now() + databaseBackoffMs
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

function recordId(providerId: string, key: string) {
  return `${providerId}:${key}`
}

function fingerprintSecret(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}

function numberFromEnv(key: string, fallback: number) {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

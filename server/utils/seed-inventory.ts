import type { InventoryDataset } from '~~/types/inventory'

type Entity = InventoryDataset['entities'][number]
type Relation = InventoryDataset['relations'][number]
type Deployment = InventoryDataset['deployments'][number]
type Collector = InventoryDataset['collectors'][number]
type Insight = InventoryDataset['insights'][number]

export function createSeedInventory(): InventoryDataset {
  const generatedAt = new Date().toISOString()
  const base = {
    confidence: 1,
    lastSeen: generatedAt
  }

  const entities: Entity[] = [
    {
      ...base,
      id: 'project:builder',
      kind: 'project',
      name: 'Builder',
      provider: 'builder',
      platform: 'control-plane',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'This Builder app: Nuxt UI, Nitro API, provider runtime, local Docker/Portainer management, SurrealDB inventory, and Grafana observability.',
      tags: ['self', 'platform', 'inventory', 'docker-management'],
      metadata: {
        editable: true,
        environments: 'local'
      }
    },
    {
      ...base,
      id: 'repo:builder-local',
      kind: 'repo',
      name: 'C:\\Users\\paulp\\Documents\\builder',
      provider: 'local-folder',
      platform: 'workspace',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Local Builder workspace folder used by Codex and npm scripts.',
      tags: ['source', 'local-folder', 'workspace'],
      externalId: 'file:C:\\Users\\paulp\\Documents\\builder',
      metadata: {
        default_branch: 'master',
        branches: 'master',
        remote: 'github.com/Paul-Arm/builder',
        htmlUrl: 'https://github.com/Paul-Arm/builder',
        paths: 'app,server,providers,types,scripts,surreal,observability'
      }
    },
    {
      ...base,
      id: 'pipeline:builder-local-setup',
      kind: 'pipeline',
      name: 'Builder local setup',
      provider: 'npm',
      platform: 'powershell-node',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Versioned setup flow: scripts/setup.ps1, Docker Compose stack, database seed, and typecheck.',
      tags: ['setup', 'typecheck', 'docker-compose'],
      metadata: {
        setup: 'scripts/setup.ps1',
        dev: 'npm run dev',
        stack: 'npm run stack:up'
      }
    },
    {
      ...base,
      id: 'service:builder-web',
      kind: 'service',
      name: 'Builder web app',
      provider: 'builder',
      platform: 'nuxt',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Nuxt 4 app shell and Vue UI for graph, projects, providers, targets, IaC, and Grafana.',
      tags: ['nuxt', 'vue', 'ui'],
      metadata: {
        sourcePath: 'app',
        localUrl: 'http://127.0.0.1:3000'
      }
    },
    {
      ...base,
      id: 'service:builder-api',
      kind: 'service',
      name: 'Builder Nitro API',
      provider: 'builder',
      platform: 'nitro',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Nitro server routes for inventory, projects, providers, observability, and IaC state.',
      tags: ['nitro', 'api', 'inventory'],
      metadata: {
        sourcePath: 'server'
      }
    },
    {
      ...base,
      id: 'service:builder-provider-runtime',
      kind: 'service',
      name: 'Provider runtime',
      provider: 'builder',
      platform: 'plugin-runtime',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Provider registry and plugins for GitHub, local folders, Docker CLI, Portainer, and Grafana Stack.',
      tags: ['providers', 'plugins', 'actions'],
      metadata: {
        sourcePath: 'providers,server/providers'
      }
    },
    {
      ...base,
      id: 'service:builder-database',
      kind: 'service',
      name: 'Builder database',
      provider: 'surrealdb',
      platform: 'surrealdb',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Local SurrealDB service for normalized inventory, project overlay, observability settings, and provider secrets.',
      tags: ['database', 'surrealdb', 'stateful']
    },
    {
      ...base,
      id: 'service:builder-observability',
      kind: 'service',
      name: 'Builder observability',
      provider: 'grafana-stack',
      platform: 'grafana-loki-tempo-prometheus-alloy',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Local Grafana, Loki, Tempo, Prometheus, and Alloy stack for Builder logs, traces, metrics, and Docker logs.',
      tags: ['grafana', 'logs', 'metrics', 'traces']
    },
    {
      ...base,
      id: 'service:builder-docker-manager',
      kind: 'service',
      name: 'Docker manager',
      provider: 'portainer',
      platform: 'portainer-ce',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Portainer CE management surface for local Docker/OrbStack containers, volumes, networks, images, and stacks.',
      tags: ['portainer', 'docker', 'management'],
      metadata: {
        localUrl: 'http://localhost:9000'
      }
    },
    {
      ...base,
      id: 'host:local-workstation',
      kind: 'host',
      name: 'Local Windows workstation',
      provider: 'local',
      platform: 'windows',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Current development host running Codex, Nuxt dev server, Docker Desktop/OrbStack-compatible contexts, and the Builder workspace.',
      tags: ['local', 'windows', 'development']
    },
    {
      ...base,
      id: 'runtime:builder-nuxt-dev',
      kind: 'runtime',
      name: 'Nuxt dev server',
      provider: 'node',
      platform: 'nuxt-dev',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Local npm run dev process serving Builder on port 3000.',
      tags: ['node', 'nuxt', 'dev-server'],
      metadata: {
        command: 'npm run dev',
        port: 3000
      }
    },
    {
      ...base,
      id: 'runtime:builder-docker',
      kind: 'runtime',
      name: 'Local Docker runtime',
      provider: 'docker-cli',
      platform: 'docker-compatible',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Docker-compatible runtime used by Builder Compose services and Portainer.',
      tags: ['docker', 'orbstack-compatible', 'compose']
    },
    container('builder-surrealdb', 'surrealdb/surrealdb:v2', '8000'),
    container('builder-portainer', 'portainer/portainer-ce:2.39.1', '9000,9443'),
    container('builder-grafana', 'grafana/grafana-oss:latest', '3300'),
    container('builder-loki', 'grafana/loki:latest', '3100'),
    container('builder-tempo', 'grafana/tempo:latest', '3200'),
    container('builder-prometheus', 'prom/prometheus:latest', '9090'),
    container('builder-alloy', 'grafana/alloy:latest', '12345,4317,4318'),
    {
      ...base,
      id: 'database:builder-surrealdb',
      kind: 'database',
      name: 'builder.inventory',
      provider: 'surrealdb',
      platform: 'surrealdb',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'SurrealDB namespace/database used by Builder for inventory and provider state.',
      tags: ['surrealdb', 'inventory'],
      metadata: {
        namespace: 'builder',
        database: 'inventory',
        url: 'http://127.0.0.1:8000'
      }
    },
    {
      ...base,
      id: 'secret_store:builder-provider-secrets',
      kind: 'secret_store',
      name: 'Builder provider secrets',
      provider: 'builder',
      platform: 'surrealdb-or-local-file',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Encrypted provider secret store for GitHub and Grafana tokens.',
      tags: ['secrets', 'providers', 'encrypted'],
      metadata: {
        fallbackPath: '.data/secrets.enc.json'
      }
    },
    {
      ...base,
      id: 'storage:builder-docker-volumes',
      kind: 'storage',
      name: 'Builder Docker volumes',
      provider: 'docker',
      platform: 'named-volumes',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Docker named volumes for SurrealDB, Portainer, Grafana, Loki, Tempo, Prometheus, and Alloy.',
      tags: ['docker-volume', 'state']
    },
    {
      ...base,
      id: 'domain:builder-localhost',
      kind: 'domain',
      name: '127.0.0.1:3000',
      provider: 'local',
      platform: 'http',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Local browser entrypoint for the Builder UI.',
      tags: ['localhost', 'dev']
    },
    {
      ...base,
      id: 'external_service:builder-github',
      kind: 'external_service',
      name: 'GitHub / Paul-Arm',
      provider: 'github',
      platform: 'github-api',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'GitHub provider connection used to discover repositories, branches, workflows, and Pages.',
      tags: ['github', 'provider-api']
    },
    {
      ...base,
      id: 'external_service:builder-grafana-ui',
      kind: 'external_service',
      name: 'Grafana UI',
      provider: 'grafana-stack',
      platform: 'grafana',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'Builder dashboard surface for logs, traces, metrics, and provider/DB health.',
      tags: ['grafana', 'dashboard'],
      metadata: {
        localUrl: 'http://localhost:3300'
      }
    },
    {
      ...base,
      id: 'external_service:builder-portainer-ui',
      kind: 'external_service',
      name: 'Portainer UI',
      provider: 'portainer',
      platform: 'portainer-ce',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: 'External manager UI linked from the Docker provider panel.',
      tags: ['portainer', 'dashboard'],
      metadata: {
        localUrl: 'http://localhost:9000'
      }
    }
  ]

  const relations: Relation[] = [
    ...entities
      .filter((entity) => entity.id !== 'project:builder')
      .map((entity) => relation('project:builder', entity.id, 'owns', 'builder-seed')),
    relation('repo:builder-local', 'service:builder-web', 'contains', 'local-folder'),
    relation('repo:builder-local', 'service:builder-api', 'contains', 'local-folder'),
    relation('repo:builder-local', 'service:builder-provider-runtime', 'contains', 'local-folder'),
    relation('pipeline:builder-local-setup', 'service:builder-web', 'deployed_as', 'npm'),
    relation('pipeline:builder-local-setup', 'service:builder-api', 'deployed_as', 'npm'),
    relation('pipeline:builder-local-setup', 'service:builder-provider-runtime', 'deployed_as', 'npm'),
    relation('service:builder-web', 'runtime:builder-nuxt-dev', 'runs_on', 'node'),
    relation('service:builder-api', 'runtime:builder-nuxt-dev', 'runs_on', 'node'),
    relation('service:builder-provider-runtime', 'runtime:builder-nuxt-dev', 'runs_on', 'node'),
    relation('runtime:builder-nuxt-dev', 'host:local-workstation', 'runs_on', 'local'),
    relation('runtime:builder-docker', 'host:local-workstation', 'runs_on', 'docker'),
    relation('service:builder-web', 'service:builder-api', 'uses', 'http'),
    relation('service:builder-api', 'database:builder-surrealdb', 'uses', 'surrealdb'),
    relation('service:builder-api', 'secret_store:builder-provider-secrets', 'secured_by', 'builder'),
    relation('service:builder-api', 'external_service:builder-grafana-ui', 'uses', 'grafana'),
    relation('service:builder-provider-runtime', 'runtime:builder-docker', 'uses', 'docker-cli'),
    relation('service:builder-provider-runtime', 'external_service:builder-github', 'uses', 'github'),
    relation('service:builder-provider-runtime', 'external_service:builder-portainer-ui', 'uses', 'portainer'),
    relation('service:builder-database', 'container:builder-surrealdb', 'deployed_as', 'docker-compose'),
    relation('service:builder-database', 'database:builder-surrealdb', 'uses', 'surrealdb'),
    relation('service:builder-database', 'storage:builder-docker-volumes', 'uses', 'docker-volume'),
    relation('service:builder-docker-manager', 'container:builder-portainer', 'deployed_as', 'docker-compose'),
    relation('service:builder-docker-manager', 'runtime:builder-docker', 'runs_on', 'docker-compose'),
    relation('service:builder-docker-manager', 'external_service:builder-portainer-ui', 'exposed_by', 'http'),
    relation('service:builder-docker-manager', 'storage:builder-docker-volumes', 'uses', 'docker-volume'),
    relation('service:builder-observability', 'container:builder-grafana', 'deployed_as', 'docker-compose'),
    relation('service:builder-observability', 'container:builder-loki', 'deployed_as', 'docker-compose'),
    relation('service:builder-observability', 'container:builder-tempo', 'deployed_as', 'docker-compose'),
    relation('service:builder-observability', 'container:builder-prometheus', 'deployed_as', 'docker-compose'),
    relation('service:builder-observability', 'container:builder-alloy', 'deployed_as', 'docker-compose'),
    relation('service:builder-observability', 'external_service:builder-grafana-ui', 'exposed_by', 'http'),
    relation('service:builder-observability', 'storage:builder-docker-volumes', 'uses', 'docker-volume'),
    ...entities
      .filter((entity) => entity.kind === 'container')
      .map((entity) => relation(entity.id, 'runtime:builder-docker', 'runs_on', 'docker')),
    relation('database:builder-surrealdb', 'container:builder-surrealdb', 'managed_by', 'docker-compose'),
    relation('secret_store:builder-provider-secrets', 'database:builder-surrealdb', 'managed_by', 'surrealdb'),
    relation('domain:builder-localhost', 'service:builder-web', 'exposed_by', 'localhost')
  ]

  const deployments: Deployment[] = [
    deployment('builder-web-local', 'service:builder-web', 'runtime:builder-nuxt-dev', '0.1.0', 'npm run dev'),
    deployment('builder-api-local', 'service:builder-api', 'runtime:builder-nuxt-dev', '0.1.0', 'npm run dev'),
    deployment('builder-provider-runtime-local', 'service:builder-provider-runtime', 'runtime:builder-nuxt-dev', '0.1.0', 'provider registry'),
    deployment('builder-database-local', 'service:builder-database', 'container:builder-surrealdb', 'surrealdb:v2', 'docker compose'),
    deployment('builder-docker-manager-local', 'service:builder-docker-manager', 'container:builder-portainer', 'portainer-ce:2.39.1', 'docker compose'),
    deployment('builder-observability-local', 'service:builder-observability', 'container:builder-grafana', 'grafana stack', 'docker compose')
  ]

  const collectors: Collector[] = [
    {
      id: 'collector:local-folder:builder',
      name: 'Builder workspace',
      kind: 'git',
      target: 'C:\\Users\\paulp\\Documents\\builder',
      status: 'connected',
      mode: 'read_only',
      lastRun: generatedAt,
      summary: 'Local source tree for app, server, providers, observability, scripts, and schema.'
    },
    {
      id: 'collector:github:builder',
      name: 'GitHub / Paul-Arm',
      kind: 'git',
      target: 'Paul-Arm/builder',
      status: 'connected',
      mode: 'read_only',
      lastRun: generatedAt,
      summary: 'Remote repository, branches, and provider metadata.'
    },
    {
      id: 'collector:docker-cli:local',
      name: 'Docker CLI / local',
      kind: 'docker',
      target: 'local-docker',
      status: 'connected',
      mode: 'write_capable',
      lastRun: generatedAt,
      summary: 'Builder Compose containers plus local Docker lifecycle actions.'
    },
    {
      id: 'collector:grafana-stack:local',
      name: 'Grafana Stack',
      kind: 'cloud',
      target: 'localhost',
      status: 'connected',
      mode: 'read_only',
      lastRun: generatedAt,
      summary: 'Grafana, Loki, Tempo, Prometheus, and Alloy for Builder observability.'
    }
  ]

  const insights: Insight[] = [
    {
      id: 'insight:builder-self-map',
      severity: 'info',
      title: 'Builder is mapped as the only default project',
      entityId: 'project:builder',
      description: 'Seed inventory now reflects this local Builder app instead of demo checkout, portal, or analytics projects.'
    },
    {
      id: 'insight:portainer-manager',
      severity: 'info',
      title: 'Docker management is delegated to Portainer',
      entityId: 'service:builder-docker-manager',
      description: 'Builder keeps graph, status, metrics, and quick actions while Portainer owns the deep Docker management UI.'
    }
  ]

  return {
    generatedAt,
    mode: 'mixed',
    source: 'seed',
    entities,
    relations,
    deployments,
    collectors,
    insights
  }

  function container(name: string, image: string, ports: string): Entity {
    const composeService = name.replace(/^builder-/, '')

    return {
      ...base,
      id: `container:${name}`,
      kind: 'container',
      name,
      provider: 'docker-cli',
      platform: 'docker-compose',
      environment: 'local',
      owner: 'Paul',
      health: 'healthy',
      description: `Docker Compose container for the ${composeService} service.`,
      tags: ['docker', 'compose', `service:${composeService}`],
      metadata: {
        image,
        composeProject: 'builder',
        composeService,
        ports
      }
    }
  }

  function deployment(
    id: string,
    serviceId: string,
    targetId: string,
    version: string,
    actor: string
  ): Deployment {
    return {
      id: `deployment:${id}`,
      projectId: 'project:builder',
      serviceId,
      environment: 'local',
      targetId,
      version,
      status: 'active',
      branch: 'master',
      sourcePath: serviceSourcePath(serviceId),
      commit: 'local',
      actor,
      deployedAt: generatedAt,
      source: actor
    }
  }
}

function relation(from: string, to: string, type: Relation['type'], source: string): Relation {
  return {
    id: `relation:${from}:${type}:${to}`,
    from,
    to,
    type,
    source,
    confidence: 1
  }
}

function serviceSourcePath(serviceId: string) {
  const paths: Record<string, string> = {
    'service:builder-web': 'app',
    'service:builder-api': 'server',
    'service:builder-provider-runtime': 'providers,server/providers',
    'service:builder-database': 'surreal,scripts',
    'service:builder-observability': 'observability',
    'service:builder-docker-manager': 'docker-compose.yml,providers/docker-cli'
  }

  return paths[serviceId] || '.'
}

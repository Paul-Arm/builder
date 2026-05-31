import type { InventoryDataset } from '~~/types/inventory'

export function createSeedInventory(): InventoryDataset {
  const generatedAt = new Date().toISOString()

  return {
    generatedAt,
    mode: 'mixed',
    source: 'seed',
    entities: [
      {
        id: 'project:checkout',
        kind: 'project',
        name: 'Checkout',
        provider: 'internal',
        platform: 'product',
        owner: 'Payments',
        health: 'healthy',
        description: 'Customer checkout and order orchestration.',
        tags: ['tier-1', 'payments'],
        confidence: 0.96,
        lastSeen: generatedAt
      },
      {
        id: 'project:analytics',
        kind: 'project',
        name: 'Analytics',
        provider: 'internal',
        platform: 'data-product',
        owner: 'Data',
        health: 'degraded',
        description: 'Event ingestion and reporting pipeline.',
        tags: ['batch', 'events'],
        confidence: 0.9,
        lastSeen: generatedAt
      },
      {
        id: 'project:builder',
        kind: 'project',
        name: 'Builder',
        provider: 'internal',
        platform: 'platform-app',
        owner: 'Platform',
        health: 'healthy',
        description: 'Environment graph and deployment inventory.',
        tags: ['platform', 'deployment-management'],
        confidence: 1,
        lastSeen: generatedAt
      },
      {
        id: 'project:portal',
        kind: 'project',
        name: 'Customer Portal',
        provider: 'internal',
        platform: 'product',
        owner: 'Experience',
        health: 'healthy',
        description: 'Customer self-service portal sharing checkout data resources.',
        tags: ['customer-facing', 'shared-resources'],
        confidence: 0.91,
        lastSeen: generatedAt
      },
      {
        id: 'service:checkout-api',
        kind: 'service',
        name: 'checkout-api',
        provider: 'internal',
        platform: 'node',
        owner: 'Payments',
        health: 'healthy',
        tags: ['http', 'api'],
        confidence: 0.94,
        lastSeen: generatedAt,
        metadata: {
          sourcePath: 'apps/backend',
          component: 'backend'
        }
      },
      {
        id: 'service:billing-worker',
        kind: 'service',
        name: 'billing-worker',
        provider: 'internal',
        platform: 'node',
        owner: 'Payments',
        health: 'healthy',
        tags: ['worker', 'queue'],
        confidence: 0.88,
        lastSeen: generatedAt,
        metadata: {
          sourcePath: 'workers/billing',
          component: 'worker'
        }
      },
      {
        id: 'service:analytics-ingest',
        kind: 'service',
        name: 'analytics-ingest',
        provider: 'internal',
        platform: 'go',
        owner: 'Data',
        health: 'degraded',
        tags: ['events', 'ingest'],
        confidence: 0.87,
        lastSeen: generatedAt
      },
      {
        id: 'service:portal-web',
        kind: 'service',
        name: 'portal-web',
        provider: 'internal',
        platform: 'nuxt',
        owner: 'Experience',
        health: 'healthy',
        tags: ['http', 'frontend'],
        confidence: 0.88,
        lastSeen: generatedAt,
        metadata: {
          sourcePath: 'apps/frontend',
          component: 'frontend'
        }
      },
      {
        id: 'service:builder-ui',
        kind: 'service',
        name: 'builder-ui',
        provider: 'internal',
        platform: 'nuxt',
        owner: 'Platform',
        health: 'healthy',
        tags: ['ui', 'inventory'],
        confidence: 1,
        lastSeen: generatedAt
      },
      {
        id: 'repo:commerce-platform',
        kind: 'repo',
        name: 'github.com/acme/commerce-platform',
        provider: 'github',
        platform: 'monorepo',
        owner: 'Product Engineering',
        health: 'healthy',
        tags: ['source', 'monorepo'],
        confidence: 1,
        lastSeen: generatedAt,
        metadata: {
          default_branch: 'main',
          branches: 'main, staging, local-lab',
          services: 'checkout-api, billing-worker, portal-web',
          paths: 'apps/backend, workers/billing, apps/frontend'
        }
      },
      {
        id: 'repo:builder',
        kind: 'repo',
        name: 'github.com/acme/builder',
        provider: 'github',
        platform: 'git',
        owner: 'Platform',
        health: 'healthy',
        tags: ['source'],
        confidence: 1,
        lastSeen: generatedAt,
        metadata: {
          default_branch: 'main',
          branches: 'main, local',
          services: 'builder-ui',
          paths: 'app'
        }
      },
      {
        id: 'cluster:prod-eu',
        kind: 'cluster',
        name: 'k8s-prod-eu',
        provider: 'aws',
        platform: 'eks',
        environment: 'prod',
        region: 'eu-central-1',
        account: 'prod-main',
        owner: 'Platform',
        health: 'healthy',
        tags: ['kubernetes', 'prod'],
        externalId: 'arn:aws:eks:eu-central-1:111111111111:cluster/prod-eu',
        confidence: 0.96,
        lastSeen: generatedAt
      },
      {
        id: 'host:mac-mini-01',
        kind: 'host',
        name: 'mac-mini-01',
        provider: 'local',
        platform: 'macos',
        environment: 'local',
        region: 'office',
        owner: 'Platform',
        health: 'healthy',
        description: 'Local Mac mini target for Docker, OrbStack, and Bash collectors.',
        tags: ['mac-mini', 'edge', 'local-hardware'],
        confidence: 1,
        lastSeen: generatedAt,
        metadata: {
          cpu: 'Apple Silicon',
          memory_gb: 32,
          write_access: false
        }
      },
      {
        id: 'runtime:orbstack:mac-mini-01',
        kind: 'runtime',
        name: 'OrbStack',
        provider: 'orbstack',
        platform: 'docker-compatible',
        environment: 'local',
        owner: 'Platform',
        health: 'healthy',
        tags: ['docker', 'compose'],
        confidence: 0.92,
        lastSeen: generatedAt
      },
      {
        id: 'container:checkout-api-local',
        kind: 'container',
        name: 'checkout-api-local',
        provider: 'local',
        platform: 'docker',
        environment: 'local',
        owner: 'Payments',
        health: 'healthy',
        tags: ['compose', 'port:3001'],
        confidence: 0.9,
        lastSeen: generatedAt,
        metadata: {
          image: 'ghcr.io/acme/checkout-api:1.14.2',
          ports: '3001:3000'
        }
      },
      {
        id: 'container:postgres-local',
        kind: 'container',
        name: 'postgres-local',
        provider: 'local',
        platform: 'docker',
        environment: 'local',
        owner: 'Platform',
        health: 'healthy',
        tags: ['compose', 'stateful'],
        confidence: 0.9,
        lastSeen: generatedAt,
        metadata: {
          image: 'postgres:16',
          volume: 'orders-pgdata'
        }
      },
      {
        id: 'database:orders-prod',
        kind: 'database',
        name: 'orders-prod',
        provider: 'aws',
        platform: 'rds-postgres',
        environment: 'prod',
        region: 'eu-central-1',
        account: 'prod-main',
        owner: 'Payments',
        health: 'healthy',
        tags: ['postgres', 'pii'],
        confidence: 0.98,
        lastSeen: generatedAt
      },
      {
        id: 'database:orders-local',
        kind: 'database',
        name: 'orders-local',
        provider: 'local',
        platform: 'postgres',
        environment: 'local',
        owner: 'Platform',
        health: 'healthy',
        tags: ['postgres', 'compose'],
        confidence: 0.9,
        lastSeen: generatedAt
      },
      {
        id: 'storage:invoice-uploads',
        kind: 'storage',
        name: 'invoice-uploads',
        provider: 'aws',
        platform: 's3',
        environment: 'prod',
        region: 'eu-central-1',
        owner: 'Payments',
        health: 'healthy',
        tags: ['object-storage'],
        confidence: 0.95,
        lastSeen: generatedAt
      },
      {
        id: 'queue:billing-events',
        kind: 'queue',
        name: 'billing-events',
        provider: 'aws',
        platform: 'sqs',
        environment: 'prod',
        region: 'eu-central-1',
        owner: 'Payments',
        health: 'healthy',
        tags: ['events'],
        confidence: 0.93,
        lastSeen: generatedAt
      },
      {
        id: 'domain:checkout',
        kind: 'domain',
        name: 'checkout.example.com',
        provider: 'cloudflare',
        platform: 'dns',
        environment: 'prod',
        owner: 'Payments',
        health: 'healthy',
        tags: ['public'],
        confidence: 0.91,
        lastSeen: generatedAt
      },
      {
        id: 'domain:portal',
        kind: 'domain',
        name: 'portal.example.com',
        provider: 'cloudflare',
        platform: 'dns',
        environment: 'prod',
        owner: 'Experience',
        health: 'healthy',
        tags: ['public'],
        confidence: 0.9,
        lastSeen: generatedAt
      },
      {
        id: 'secret:vault-prod',
        kind: 'secret_store',
        name: 'vault-prod',
        provider: 'hashicorp',
        platform: 'vault',
        environment: 'prod',
        owner: 'Security',
        health: 'healthy',
        tags: ['secrets'],
        confidence: 0.89,
        lastSeen: generatedAt
      }
    ],
    relations: [
      relation('host:mac-mini-01', 'runtime:orbstack:mac-mini-01', 'runs_on', 'orbstack'),
      relation('project:checkout', 'service:checkout-api', 'owns', 'catalog'),
      relation('project:checkout', 'service:billing-worker', 'owns', 'catalog'),
      relation('project:analytics', 'service:analytics-ingest', 'owns', 'catalog'),
      relation('project:builder', 'service:builder-ui', 'owns', 'catalog'),
      relation('project:portal', 'service:portal-web', 'owns', 'catalog'),
      relation('repo:commerce-platform', 'service:checkout-api', 'contains', 'github'),
      relation('repo:commerce-platform', 'service:billing-worker', 'contains', 'github'),
      relation('repo:commerce-platform', 'service:portal-web', 'contains', 'github'),
      relation('repo:builder', 'service:builder-ui', 'contains', 'github'),
      relation('service:checkout-api', 'cluster:prod-eu', 'runs_on', 'kubernetes'),
      relation('service:billing-worker', 'cluster:prod-eu', 'runs_on', 'kubernetes'),
      relation('service:analytics-ingest', 'cluster:prod-eu', 'runs_on', 'kubernetes'),
      relation('service:portal-web', 'cluster:prod-eu', 'runs_on', 'kubernetes'),
      relation('service:builder-ui', 'runtime:orbstack:mac-mini-01', 'runs_on', 'orbstack'),
      relation('container:checkout-api-local', 'runtime:orbstack:mac-mini-01', 'runs_on', 'docker'),
      relation('container:postgres-local', 'runtime:orbstack:mac-mini-01', 'runs_on', 'docker'),
      relation('service:checkout-api', 'container:checkout-api-local', 'deployed_as', 'docker'),
      relation('container:postgres-local', 'database:orders-local', 'managed_by', 'docker'),
      relation('service:checkout-api', 'database:orders-prod', 'uses', 'terraform'),
      relation('service:portal-web', 'database:orders-prod', 'uses', 'terraform'),
      relation('service:checkout-api', 'database:orders-local', 'uses', 'docker-compose'),
      relation('service:checkout-api', 'storage:invoice-uploads', 'uses', 'terraform'),
      relation('service:portal-web', 'storage:invoice-uploads', 'uses', 'terraform'),
      relation('service:checkout-api', 'queue:billing-events', 'publishes', 'opentelemetry'),
      relation('service:billing-worker', 'queue:billing-events', 'subscribes', 'opentelemetry'),
      relation('service:analytics-ingest', 'queue:billing-events', 'subscribes', 'opentelemetry'),
      relation('domain:checkout', 'service:checkout-api', 'exposed_by', 'cloudflare'),
      relation('domain:portal', 'service:portal-web', 'exposed_by', 'cloudflare'),
      relation('service:checkout-api', 'secret:vault-prod', 'secured_by', 'vault')
    ],
    deployments: [
      {
        id: 'deployment:checkout-api-prod',
        projectId: 'project:checkout',
        serviceId: 'service:checkout-api',
        environment: 'prod',
        targetId: 'cluster:prod-eu',
        version: '1.14.2',
        status: 'active',
        branch: 'main',
        sourcePath: 'apps/backend',
        commit: '9b7c2af',
        actor: 'github-actions',
        deployedAt: '2026-05-31T12:42:00.000+02:00',
        source: 'github-actions'
      },
      {
        id: 'deployment:checkout-api-dev',
        projectId: 'project:checkout',
        serviceId: 'service:checkout-api',
        environment: 'dev',
        targetId: 'container:checkout-api-local',
        version: '1.15.0-dev',
        status: 'active',
        branch: 'develop',
        sourcePath: 'apps/backend',
        commit: 'd14f0c8',
        actor: 'local-agent',
        deployedAt: '2026-05-31T16:05:00.000+02:00',
        source: 'orbstack'
      },
      {
        id: 'deployment:checkout-api-feature-abc',
        projectId: 'project:checkout',
        serviceId: 'service:checkout-api',
        environment: 'feature-abc',
        targetId: 'container:checkout-api-local',
        version: 'pr-148',
        status: 'rolling',
        branch: 'feature-abc',
        sourcePath: 'apps/backend',
        commit: '71feabc',
        actor: 'local-agent',
        deployedAt: '2026-05-31T16:18:00.000+02:00',
        source: 'orbstack'
      },
      {
        id: 'deployment:billing-worker-prod',
        projectId: 'project:checkout',
        serviceId: 'service:billing-worker',
        environment: 'prod',
        targetId: 'cluster:prod-eu',
        version: '1.14.0',
        status: 'active',
        branch: 'main',
        sourcePath: 'workers/billing',
        commit: '80c1ab2',
        actor: 'github-actions',
        deployedAt: '2026-05-30T19:15:00.000+02:00',
        source: 'github-actions'
      },
      {
        id: 'deployment:analytics-prod',
        projectId: 'project:analytics',
        serviceId: 'service:analytics-ingest',
        environment: 'prod',
        targetId: 'cluster:prod-eu',
        version: '0.22.7',
        status: 'rolling',
        branch: 'main',
        sourcePath: 'pipelines/analytics',
        commit: '31f0ada',
        actor: 'argo-cd',
        deployedAt: '2026-05-31T10:05:00.000+02:00',
        source: 'argocd'
      },
      {
        id: 'deployment:portal-prod',
        projectId: 'project:portal',
        serviceId: 'service:portal-web',
        environment: 'prod',
        targetId: 'cluster:prod-eu',
        version: '2.8.1',
        status: 'active',
        branch: 'staging',
        sourcePath: 'apps/frontend',
        commit: '2db57bf',
        actor: 'github-actions',
        deployedAt: '2026-05-31T11:22:00.000+02:00',
        source: 'github-actions'
      },
      {
        id: 'deployment:portal-dev',
        projectId: 'project:portal',
        serviceId: 'service:portal-web',
        environment: 'dev',
        targetId: 'runtime:orbstack:mac-mini-01',
        version: '2.9.0-dev',
        status: 'active',
        branch: 'develop',
        sourcePath: 'apps/frontend',
        commit: 'f01a4d2',
        actor: 'local-agent',
        deployedAt: '2026-05-31T16:12:00.000+02:00',
        source: 'orbstack'
      },
      {
        id: 'deployment:portal-feature-abc',
        projectId: 'project:portal',
        serviceId: 'service:portal-web',
        environment: 'feature-abc',
        targetId: 'runtime:orbstack:mac-mini-01',
        version: 'pr-148',
        status: 'active',
        branch: 'feature-abc',
        sourcePath: 'apps/frontend',
        commit: '71feabc',
        actor: 'local-agent',
        deployedAt: '2026-05-31T16:21:00.000+02:00',
        source: 'orbstack'
      },
      {
        id: 'deployment:builder-local',
        projectId: 'project:builder',
        serviceId: 'service:builder-ui',
        environment: 'local',
        targetId: 'runtime:orbstack:mac-mini-01',
        version: '0.1.0',
        status: 'active',
        branch: 'local',
        sourcePath: 'app',
        commit: 'local',
        actor: 'local-agent',
        deployedAt: '2026-05-31T15:58:00.000+02:00',
        source: 'orbstack'
      }
    ],
    collectors: [
      {
        id: 'collector:orbstack:mac-mini-01',
        name: 'OrbStack / Docker',
        kind: 'orbstack',
        target: 'mac-mini-01',
        status: 'connected',
        mode: 'write_capable',
        lastRun: generatedAt,
        summary: '2 containers, 1 runtime, 1 local database'
      },
      {
        id: 'collector:bash:mac-mini-01',
        name: 'Bash JSON Collectors',
        kind: 'bash',
        target: 'mac-mini-01',
        status: 'disabled',
        mode: 'write_capable',
        summary: 'Plugin contract ready'
      },
      {
        id: 'collector:terraform:prod',
        name: 'Terraform State',
        kind: 'terraform',
        target: 'prod-main',
        status: 'connected',
        mode: 'write_capable',
        lastRun: generatedAt,
        summary: 'RDS, S3, SQS, EKS, DNS resources'
      },
      {
        id: 'collector:kubernetes:prod-eu',
        name: 'Kubernetes',
        kind: 'kubernetes',
        target: 'k8s-prod-eu',
        status: 'connected',
        mode: 'write_capable',
        lastRun: generatedAt,
        summary: '3 services, 1 rolling deployment'
      },
      {
        id: 'collector:git:github',
        name: 'GitHub',
        kind: 'git',
        target: 'acme',
        status: 'connected',
        mode: 'write_capable',
        lastRun: generatedAt,
        summary: 'Monorepos, branches, commits, deployment actors'
      }
    ],
    insights: [
      {
        id: 'insight:analytics-rolling',
        severity: 'warning',
        title: 'Analytics rollout still in progress',
        entityId: 'project:analytics',
        description: 'analytics-ingest is rolling while downstream reports still depend on billing-events.'
      },
      {
        id: 'insight:local-actions',
        severity: 'info',
        title: 'Local agent can manage deployments',
        entityId: 'host:mac-mini-01',
        description: 'Docker and OrbStack lifecycle actions are available through provider action plans.'
      }
    ]
  }
}

function relation(
  from: string,
  to: string,
  type: InventoryDataset['relations'][number]['type'],
  source: string
): InventoryDataset['relations'][number] {
  return {
    id: `relation:${from}:${type}:${to}`,
    from,
    to,
    type,
    source,
    confidence: source === 'opentelemetry' ? 0.82 : 0.92
  }
}

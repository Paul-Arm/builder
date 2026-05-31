# Provider Plugin Architecture

## Ziel

Builder soll viele verschiedene Schnittstellen einbinden koennen, ohne Docker, OrbStack, Kubernetes, GitHub, Terraform, Grafana oder spaetere Anbieter im Core hart zu codieren. Der Core kennt nur den Plugin-Vertrag. Anbieter liefern Provider-Plugins.

Der erste praktische Use Case ist ein lokales Docker/OrbStack-Setup auf einem Mac mini. Spaeter soll derselbe Provider ueber SSH, Agent oder Remote Docker Context gegen andere Geraete laufen.

## Begriffe

- **Provider**: Plugin-Paket mit Manifest, Capabilities und Implementierung.
- **Target**: konkretes Ziel, z.B. `mac-mini-01`, `aws-prod`, `k8s-prod-eu`.
- **Collector Instance**: konfigurierte Verbindung zwischen Provider und Target.
- **Observation**: roher Fakt aus einem Provider, auditierbar und provider-spezifisch.
- **Normalized Graph**: stabile Builder-Entities und Relations fuer UI, Suche und Actions.
- **Action Plan**: sicherer, pruefbarer Plan fuer Start/Stop/Restart/Create.

## Provider Rollen

Ein Provider kann eine oder mehrere Rollen haben:

- `inventory.provider`: findet Ressourcen, Deployments, Services, Relations.
- `deployment.provider`: listet und verwaltet Deployments.
- `observability.provider`: liefert Logs, Traces, Metrics und Dashboard Links.

Beispiele:

- Docker/OrbStack: `inventory.provider`, `deployment.provider`
- Kubernetes: `inventory.provider`, `deployment.provider`, optional `observability.provider`
- Grafana Stack: `observability.provider`
- GitHub: `inventory.provider`, spaeter `deployment.provider` fuer Actions/Workflows
- Terraform: `inventory.provider`, spaeter `deployment.provider` fuer Plan/Apply
- Bash: Escape-Hatch fuer lokale Spezialfaelle

## Manifest

```ts
interface ProviderManifest {
  id: string
  displayName: string
  version: string
  types: string[]
  roles: string[]
  capabilities: string[]
  addOptions: ProviderAddOption[]
  ui?: ProviderUiExtension
  configSchema?: unknown
  secretSchema?: unknown
}

interface ProviderAddOption {
  id: string
  label: string
  description: string
  type: string
  capability: string
  configSchema?: unknown
}

interface ProviderUiExtension {
  component: string
  surfaces: Array<'provider.panel' | 'add.option.panel'>
}
```

Capabilities sind Strings, keine Core-Enums:

```txt
inventory.discover
inventory.observe
deployments.list
deployments.start
deployments.stop
deployments.restart
deployments.create
logs.query
logs.tail
traces.query
metrics.query
dashboards.link
```

Types sind ebenfalls Strings und duerfen mehrfach gesetzt werden. Sie ordnen Provider fachlich ein, ohne den Core auf feste Anbieter zu begrenzen:

```txt
source.repo
source.folder
ci.workflow
hosting.pages
runtime.container
deployment.lifecycle
observability.logs
observability.traces
```

Beispiele:

```txt
github:
  source.repo
  ci.workflow
  hosting.pages

local-folder:
  source.folder
  workspace.local

docker-cli:
  runtime.container
  deployment.lifecycle
```

`addOptions` kommen ebenfalls aus dem Provider. Die UI zeigt dadurch nur das an, was der ausgewaehlte Provider wirklich erzeugen kann, z.B. `Repository`, `Workspace folder`, `Docker context` oder `Compose app`. Der Core muss dafuer keine GitHub-, Local-Folder- oder Docker-spezifischen Optionen kennen.

`ui` ist optional. Der Core rendert nur einen `ProviderExtensionHost`; dieser loest `ui.component` gegen eine registrierte Vue-Komponente auf. Damit kann ein Provider spaeter eigene Panels fuer Setup, Preview, Mapping oder Actions mitbringen. Provider ohne eigene UI fallen auf das generische Manifest-Panel zurueck.

Startpunkt:

```txt
local-folder:
  ui.component: local-folder-panel
  surfaces:
    provider.panel
    add.option.panel
```

## Provider Package Layout

Provider-spezifischer Server-Code und UI liegen zusammen unter `providers/<provider-name>`:

```txt
providers/
  github/
    server.ts
    ProviderPanel.vue
    types.ts
  local-folder/
    server.ts
    ProviderPanel.vue
    types.ts
  docker-cli/
    server.ts
```

Der Core behaelt nur Registry und Host:

```txt
server/providers/registry.ts
server/providers/types.ts
app/components/provider-ui/ProviderExtensionHost.vue
```

## Secrets

Provider-Secrets werden nicht im Manifest, Runtime-Snapshot oder UI-State gespeichert. Fuer lokale Entwicklung gibt es einen verschluesselten Store:

```txt
.data/secrets.enc.json
```

Der Store ist in `.gitignore` abgedeckt und wird mit AES-256-GCM verschluesselt. Der Master-Key kommt ausschliesslich aus `BUILDER_SECRET_KEY`. Ohne diesen Key koennen Provider Secrets aus Env lesen, aber keine neuen Secrets ueber die UI speichern.

## GitHub Provider

Der GitHub Provider nutzt die GitHub REST API mit `Accept: application/vnd.github+json` und `X-GitHub-Api-Version`. Fuer den ersten read-only Sync werden diese Rechte erwartet:

```txt
Fine-grained PAT:
  Metadata: read
  Actions: read
```

Der Provider liest:

- `GET /user` zur Token-Pruefung.
- `GET /user/repos` fuer Repositories, auf die der Token Zugriff hat.
- `GET /repos/{owner}/{repo}/branches` fuer Branches.
- `GET /repos/{owner}/{repo}/actions/workflows` fuer Workflows.

Tokens werden nur als `Authorization: Bearer <token>` an GitHub gesendet, nie in Observations oder API-Antworten zurueckgegeben. Die UI zeigt nur Quelle, Fingerprint und Status.

## Deployment Management

Deployment Provider liefern eine einheitliche Oberflaeche:

```ts
interface DeploymentProvider {
  listDeployments(ctx): Promise<DeploymentRef[]>
  planAction(ctx, request): Promise<ActionPlan>
  executeAction?(ctx, plan): Promise<ActionResult>
}
```

Der Core fuehrt keine Start/Stop-Aktion blind aus:

1. UI fordert `start`, `stop` oder `restart` an.
2. Provider erzeugt einen `ActionPlan`.
3. UI zeigt Ziel, Kommando, Risiko und Modus.
4. Spaeter: User bestaetigt.
5. Provider fuehrt aus und ein neuer Sync aktualisiert den Graph.

## Grafana Stack

Logs, Traces und Metrics gehoeren in einen separaten Observability Provider:

```txt
grafana-stack
  roles:
    observability.provider
  capabilities:
    logs.query
    logs.tail
    traces.query
    metrics.query
    dashboards.link
```

Deployment Provider und Observability Provider treffen sich ueber stabile Labels:

```ts
{
  project: 'checkout',
  service: 'checkout-api',
  environment: 'local',
  deploymentId: 'deployment:checkout-api-dev',
  targetId: 'device:mac-mini-01'
}
```

## Docker/OrbStack auf Mac mini

Der Provider nutzt lokal oder remote die Docker CLI:

```txt
docker --context orbstack ps --all --format "{{json .}}"
docker --context orbstack start <container>
docker --context orbstack stop <container>
docker --context orbstack restart <container>
```

Fuer lokale Tests kann der Provider ohne festen Context laufen und den aktiven Docker Context verwenden. Fuer den Mac mini wird spaeter `dockerContext: "orbstack"` oder ein SSH/Agent Target gesetzt.

Empfohlene Labels fuer gute Zuordnung:

```yaml
services:
  checkout-api:
    labels:
      builder.project: checkout
      builder.service: checkout-api
      builder.environment: local
      builder.uses: database:orders-local
```

Ohne Labels kann der Provider raten, aber mit niedrigerer `confidence`.

## Naechste Umsetzung

1. Shared Provider Types.
2. Provider Registry im Server.
3. Erster `docker-cli` Provider mit `deployments.list` und Action Plans fuer Start/Stop/Restart.
4. API Endpoint `/api/providers/runtime`.
5. Provider-Seite als Konsole fuer Provider, Collector-Instanzen, Deployments und Action Plan Preview.
6. Targets-Seite fuer konkrete Runtime-Scope-Details wie Geraete, Docker Daemons, Cluster und Cloud Accounts.
7. Spaeter: SSH/Agent Transport und Grafana Provider.

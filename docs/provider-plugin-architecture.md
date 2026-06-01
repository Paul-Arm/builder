# Provider Plugin Architecture

## Ziel

Builder soll viele verschiedene Schnittstellen einbinden koennen, ohne Docker, OrbStack, Kubernetes, GitHub, Terraform, Grafana oder spaetere Anbieter im Core hart zu codieren. Der Core kennt nur den Plugin-Vertrag. Anbieter liefern Provider-Plugins.

Der erste praktische Use Case ist ein lokales Docker/OrbStack-Setup auf einem Mac mini. Spaeter soll derselbe Provider ueber SSH, Agent oder Remote Docker Context gegen andere Geraete laufen.

## Begriffe

- **Provider**: Plugin-Paket mit Manifest, Capabilities und Implementierung.
- **Connection**: wiederverwendbare Zugangskonfiguration, z.B. SSH zu `mac-mini-01`, GitHub Token, Azure ARM Credential, Postgres Login, Proxy oder Jump Host.
- **Target**: konkret adressierbarer Scope ueber eine Connection, z.B. `docker-daemon:mac-mini-01`, `github:ich/mein-repo`, `azure-postgres-server:pg-1`, `k8s:prod-eu`.
- **Collector Instance**: konfigurierte Ausfuehrung eines Providers gegen ein Target, optional ueber eine Connection.
- **Observation**: roher Fakt aus einem Provider, auditierbar und provider-spezifisch.
- **Normalized Graph**: stabile Builder-Entities und Relations fuer UI, Suche und Actions.
- **Action Plan**: sicherer, pruefbarer Plan fuer Start/Stop/Restart/Create.

## Modellgrenzen

Das Core-Modell trennt bewusst vier Dinge, die in Infrastruktur-Tools oft ineinander fallen:

```txt
Provider -> Connection -> Target -> Observation -> Normalized Graph
```

- Provider beantworten: "Welche Technologie oder welcher Dienst wird angesprochen?"
- Connections beantworten: "Wie kommt Builder sicher dorthin?"
- Targets beantworten: "Welcher konkrete Scope wird adressiert?"
- Observations beantworten: "Was hat der Provider dort gesehen?"
- Nodes im Normalized Graph beantworten: "Was gehoert fachlich und architektonisch zu meinem Projekt-Stack?"

Targets sind also keine Projekt-Nodes. Ein Target kann selbst als Node sichtbar werden, z.B. ein Docker Daemon, Kubernetes Cluster oder Azure Postgres Server. Es kann aber auch viele Nodes liefern, z.B. Container, Datenbanken, Deployments, Secrets, Queues oder Repositories.

Beispiele:

```txt
Provider: docker-cli
Connection: ssh:mac-mini-01
Target: docker-daemon:mac-mini-01:orbstack
Nodes:
  host:mac-mini-01
  runtime:orbstack
  container:django-api
  service:django-api
Relations:
  runtime:orbstack runs_on host:mac-mini-01
  container:django-api runs_on runtime:orbstack
  service:django-api deployed_as container:django-api
```

```txt
Provider: azure-arm, postgres
Connection: azure:prod-subscription, postgres-login:pg-1
Target: azure-postgres-server:pg-1
Nodes:
  database_server:pg-1
  database:testing-1
Relations:
  database_server:pg-1 contains database:testing-1
  database_server:pg-1 managed_by database:testing-1
  service:api uses database:testing-1
```

## Connection Modell

Connections sollten erstklassige Datensaetze werden, statt nur als `transport` am Target oder als Provider-Config zu leben. Dadurch kann ein SSH-Zugang mehrere Targets tragen, z.B. Bash, Docker Context, Filesystem und Agent auf demselben Mac mini.

Minimaler Vertrag:

```ts
interface ProviderConnection {
  id: string
  name: string
  kind: string
  status: 'connected' | 'degraded' | 'disabled' | 'unknown'
  mode: 'read_only' | 'write_capable'
  endpoint?: string
  proxyConnectionId?: string
  secretRefs: Record<string, string>
  config: Record<string, string | number | boolean | null>
  labels: Record<string, string>
  lastChecked?: string
}
```

Beispiele fuer `kind`:

```txt
local-cli
local-fs
ssh
docker-context
http-api
github-token
azure-arm
kubeconfig
postgres-login
proxy
agent
```

Secrets bleiben im Secret Store. Connections speichern nur Secret-Referenzen, Fingerprints, Status und nicht-sensitive Config.

Targets referenzieren dann eine Connection:

```ts
interface ProviderTargetScope {
  id: string
  name: string
  kind: string
  connectionId?: string
  parentTargetId?: string
  labels: Record<string, string>
}
```

Ein Target darf verschachtelt sein. Beispiel: `docker-daemon:mac-mini-01` haengt an `host:mac-mini-01`; `container:django-api` ist kein Target, sondern ein Node aus Observations.

## Node Modell

Nodes sind normalisierte Stack-Bausteine. Sie duerfen aus Providern kommen oder manuell angelegt werden. Provider-spezifische Details gehoeren in `metadata`, stabile Architekturbeziehungen in `relations`.

Empfohlene Node-Arten:

```txt
project
service
repo
host
runtime
container
cluster
namespace
function
database_server
database
storage
queue
domain
secret_store
external_service
```

Die aktuelle `database`-Node reicht fuer einfache Datenbanken. Fuer Cloud-Angebote wie Azure Database for PostgreSQL sollte zusaetzlich `database_server` eingefuehrt werden, damit Server/Instanz und einzelne Datenbank nicht vermischt werden.

Typische Relationen:

```txt
owns
contains
runs_on
deployed_as
deployed_from
uses
publishes
subscribes
exposed_by
managed_by
secured_by
reachable_via
observed_by
```

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
- OpenTofu/Terraform-compatible IaC: Backbone fuer Desired State, Plan und Resource-Normalisierung
- Bash: Escape-Hatch fuer lokale Spezialfaelle

## OpenTofu Backbone

OpenTofu ist keine normale Provider-Integration. Es sitzt eine Ebene unter vielen Providern als IaC-Backbone:

```txt
OpenTofu state/plan/config -> IaC Backbone -> Normalized Graph -> Provider Runtime Actions
```

Diese Schicht beantwortet:

- Welche Ressourcen sollen existieren?
- Welche Ressourcen existieren laut State?
- Welche Aenderungen plant IaC?
- Welche Cloud-/Dienst-Ressourcen koennen als Builder-Nodes normalisiert werden?

Die Backbone-Schicht erzeugt Nodes und Relations aus OpenTofu-kompatiblem JSON:

```txt
azurerm_postgresql_flexible_server        -> database_server
azurerm_postgresql_flexible_server_database -> database
aws_db_instance                           -> database_server
github_repository                         -> repo
azurerm_linux_function_app                -> function
azurerm_kubernetes_cluster                -> cluster
kubernetes_namespace                      -> namespace
aws_s3_bucket / azurerm_storage_account   -> storage
aws_sqs_queue / google_pubsub_topic       -> queue
cloudflare_record / route53_record        -> domain
```

Provider sollen diese Backbone-Daten nutzen duerfen, aber nicht davon abhaengen. Beispiel:

```txt
OpenTofu erkennt:
  database_server:orders-prod
  database:testing-1
  function:billing-api

Native Provider verifizieren live:
  postgres connection health
  azure function runtime status
  logs/metrics/deployment actions
```

Damit wird OpenTofu zur gemeinsamen Sprache fuer Provisioning und Desired State, waehrend native Provider weiterhin Live-State, Logs und sichere Actions liefern.

Implementierungsregeln:

- Backbone ist read-only per Default.
- Bevorzugt werden exportierte JSON-Dateien: `tofu show -json`.
- CLI-Ausfuehrung gegen Workspaces ist opt-in, weil State JSON sensible Werte enthalten kann.
- Plan-JSON erzeugt Insights fuer create/update/delete, aber fuehrt nichts aus.
- Secrets werden nicht aus State in Builder-Secrets uebernommen.
- Provider-spezifische Werte landen nur als whitelisted, nicht-sensitive Metadata auf Nodes.

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
  nodeOptions?: ProviderNodeCreateOption[]
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

interface ProviderNodeCreateOption {
  id: string
  label: string
  description: string
  type: string
  capability: string
  nodeKind: Exclude<EntityKind, 'project'>
  defaultProvider?: string
  defaultPlatform?: string
  tags?: string[]
  ui?: {
    component: string
  }
  configSchema?: unknown
}

interface ProviderUiExtension {
  component: string
  surfaces: Array<'provider.panel' | 'add.option.panel' | 'project.node.create'>
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

`nodeOptions` sind der Project-Stack-Teil eines Providers. Sie definieren, welche Nodes ein Plugin auf der Projects-Seite anlegen kann. Der Core kennt nur `nodeKind`, Defaults und Metadaten; provider-spezifische Auswahl wie GitHub-Repository, Repo-Ordner, Branch oder Pages-URL kommt aus einer optionalen Create-UI des Providers.

Beispiel GitHub:

```txt
github.nodeOptions:
  Repository folder -> repo
    UI: repository select + folder + branch
    Metadata: repository, sourcePath, branch, htmlUrl

  GitHub Pages site -> domain
    UI: repository select + pagesUrl
    Metadata: repository, pagesUrl, htmlUrl
```

Provider ohne eigene Project-Node-UI fallen auf ein generisches Formular zurueck. Docker kann dadurch z.B. `Compose app -> runtime` und `Container -> container` anbieten, Local Folder `Workspace folder -> repo` und `Service folder -> service`.

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

## Open Source Manager Integration

Builder soll keinen kompletten Docker-, Compose- oder Kubernetes-Manager nachbauen. Das Ziel ist ein Projekt-Stack-Graph mit sicheren Action Plans. Externe Manager koennen als optionale Provider integriert werden, wenn sie fuer Betrieb, UI, Agenten oder komplexe Workflows schon gut sind.

Grundregel:

```txt
Builder owns the graph.
External managers own their operational surface.
Providers bridge between both.
```

Das bedeutet:

- Builder normalisiert Ressourcen zu Nodes und Relations.
- Externe Manager bleiben fuer Spezial-UI, Logs, Exec, Shell, komplexe Deployments und Low-Level-Operationen zustaendig.
- Actions laufen in Builder weiterhin ueber `plan -> approve -> apply -> verify -> audit`.
- Provider duerfen externe Manager-APIs nutzen, aber keine fremde Datenstruktur wird direkt zum Core-Modell.
- Wo moeglich verwendet Builder native APIs fuer stabile Inventarisierung: Docker Engine API fuer Docker, Kubernetes API fuer Kubernetes.
- Externe Manager werden bevorzugt verlinkt oder ueber Provider-Panels eingebunden, nicht als versteckte Abhaengigkeit im Core.

### Docker und Compose

Empfohlene Stufen:

1. **Native Docker Provider behalten.** Der aktuelle `docker-cli` Provider ist gut fuer lokale Entwicklung. Spaeter sollte er optional auf Docker Engine API/SDK wechseln, damit Inventory und Actions nicht an CLI-Parsing haengen.
2. **Connection/Target sauber machen.** Docker via lokalem Socket, SSH Docker Context, Agent oder Proxy sind unterschiedliche Connections auf dasselbe Zielmuster `docker-daemon`.
3. **Compose als eigene Surface behandeln.** Compose Stacks sind Deployment-Gruppen, nicht nur Containerlisten. Ein Compose Stack kann mehrere Container-Nodes und Service-Nodes erzeugen.
4. **Optionalen Manager Provider anbieten.** Portainer, Dockge oder Komodo werden als Provider/Bridge integriert, nicht als Ersatz fuer das Builder-Modell.

Kandidaten:

- **Portainer CE**: breitester Docker/Swarm/Kubernetes/ACI-Manager, API vorhanden, kann auch als Gateway zur darunterliegenden Docker/Kubernetes API dienen. Gut als optionaler `portainer` Provider fuer Environments, Stacks, Containers und Deep Links.
- **Dockge**: schlanker Compose-orientierter Manager. Sinnvoll, wenn der Fokus auf `compose.yaml`-Stacks liegt und nicht auf voller Docker-Verwaltung.
- **Komodo**: agentenbasierter Multi-Server-Manager mit Periphery-Agent. Sinnvoll, wenn Builder viele VMs/Server ueber Agents erreichen und Git-basierte Deployments koordinieren soll.

Portainer-Integration:

```txt
Provider: portainer
Connection: portainer-api-token
Targets:
  portainer:endpoint:mac-mini-01
  docker-daemon:mac-mini-01
Observations:
  endpoint
  stack
  container
  image
  volume
Nodes:
  host/runtime/container/service
Actions:
  start/stop/restart stack/container via Portainer API
  deep_link to Portainer UI for advanced operations
```

Dockge-Integration:

```txt
Provider: dockge
Connection: dockge-api/session or reverse proxy
Targets:
  compose-host:mac-mini-01
Observations:
  compose-stack
  compose-service
  compose-file
Nodes:
  runtime/container/service
Actions:
  compose up/down/restart/pull when exposed by Dockge
  deep_link to Dockge stack UI
```

Komodo-Integration:

```txt
Provider: komodo
Connection: komodo-api-token
Targets:
  komodo-server:mac-mini-01
  docker-daemon:mac-mini-01
Observations:
  server
  stack
  deployment
  repo/build
Nodes:
  host/runtime/container/service/repo
Actions:
  deploy/redeploy/restart via Komodo Core API
```

### Kubernetes

Kubernetes sollte nicht ueber einen selbstgebauten Full-Manager bedient werden. Der stabile Kern ist die Kubernetes API mit offiziellen Client Libraries und kubeconfig/ServiceAccount-RBAC. Builder sollte daraus nur die projektbezogenen Nodes und Relations normalisieren.

Empfohlene Stufen:

1. **Native Kubernetes Provider.** Liest Deployments, StatefulSets, Services, Ingress, ConfigMaps, Secrets-Metadaten, Namespaces, Pods und Events ueber Kubernetes API.
2. **RBAC-first.** Jede Connection ist ein kubeconfig oder ServiceAccount mit klar begrenzten Rechten.
3. **Action Plans.** Restart rollout, scale, apply manifest, suspend/resume CronJob und port-forward/exec nur mit explizitem Plan und Risiko.
4. **Manager UI verlinken.** Fuer Cluster-Detailarbeit lieber Headlamp oder Portainer nutzen, statt alles in Builder nachzubauen.

Kandidaten:

- **Headlamp**: Kubernetes SIG UI Projekt, Apache-2.0, pluginfaehig. Gute Wahl fuer eine tiefe K8s-UI neben Builder.
- **Portainer CE**: kann Docker und Kubernetes in einer UI verwalten und hat eine API. Gut, wenn ein gemeinsamer Manager fuer Docker und K8s gewuenscht ist.
- **Kubernetes Dashboard**: vor Nutzung pruefen. Stand 2026-06-01 zeigt das offizielle GitHub-Repo auf `kubernetes-retired/dashboard`; daher nicht als neue Hauptintegration planen.

Kubernetes-Provider-Beispiel:

```txt
Provider: kubernetes
Connection: kubeconfig:prod-eu
Target: k8s-cluster:prod-eu
Observations:
  namespace
  deployment
  statefulset
  service
  ingress
  pod
Nodes:
  cluster
  namespace
  service
  runtime/workload
  domain
Relations:
  service runs_on cluster
  workload contains pod
  service exposed_by ingress/domain
```

### Entscheidung

Fuer Builder macht die Integration externer Manager Sinn, aber als Bruecke:

- **Ja zu Integration** fuer Discovery, Deep Links, Aktionen und bestehende Agenten.
- **Nein zu Abhaengigkeit** im Core. Ein Projektgraph muss auch ohne Portainer, Dockge, Komodo oder Headlamp funktionieren.
- **Nicht alles selbst bauen.** Builder baut nur die Stack-Sicht, Normalisierung, sichere Plans und Projekt-Kontext. Externe Manager behalten die Low-Level-Bedienung.

Externe Referenzen, Stand 2026-06-01:

- Docker Engine API: https://docs.docker.com/reference/api/engine/
- Kubernetes Client Libraries: https://kubernetes.io/docs/reference/using-api/client-libraries/
- Portainer CE/API: https://github.com/portainer/portainer und https://docs.portainer.io/api/docs
- Dockge: https://github.com/louislam/dockge
- Komodo: https://komo.do/docs/setup und https://komo.do/docs/setup/connect-servers
- Headlamp: https://github.com/kubernetes-sigs/headlamp
- Kubernetes Dashboard Status: https://github.com/kubernetes/dashboard

## Naechste Umsetzung

1. Shared Provider Types.
2. Provider Registry im Server.
3. Erster `docker-cli` Provider mit `deployments.list` und Action Plans fuer Start/Stop/Restart.
4. API Endpoint `/api/providers/runtime`.
5. Provider-Seite als Konsole fuer Provider, Collector-Instanzen, Deployments und Action Plan Preview.
6. Targets-Seite fuer konkrete Runtime-Scope-Details wie Geraete, Docker Daemons, Cluster und Cloud Accounts.
7. Connection Store fuer SSH, API Tokens, kubeconfig, Azure ARM und Proxy/Agent Setups.
8. Normalizer von Provider Observations zu Graph Nodes/Relations.
9. Optionaler Portainer- oder Komodo-Provider fuer Docker/Compose Multi-Host Management.
10. Kubernetes Provider ueber Kubernetes API plus optional Headlamp/Portainer Deep Links.
11. Spaeter: SSH/Agent Transport und Grafana Provider.

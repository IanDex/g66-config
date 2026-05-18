# g66 CLI — Herramientas para microservicios Global66

CLI de productividad para el equipo de desarrollo. Automatiza el flujo completo: configuración, PRs, migraciones, propiedades, homologación entre ambientes, y tablero Slack.

---

## Requisitos

| Herramienta | Versión mínima |
|---|---|
| Node.js | 18+ |
| Python | 3.9+ |
| `pip install requests` | — |
| AWS CLI configurado | `aws configure` |
| Git | 2.x |

---

## Instalación

```bash
cd g66-config
npm install
npm run build
npm link        # registra el binario globalmente
```

Verificar:
```bash
g66 --version
```

---

## Configuración global — `~/.g66-config.json`

```json
{
  "configRepoPath": "C:/ruta/a/ms-config-properties",
  "branch_prefix": "cv",
  "envSync": {
    "slackNotify": true,
    "slackBotToken": "xoxb-...",
    "slackChannelId": "CXXXXXXXXX",
    "whitelist": []
  },
  "slack": {
    "token": "xoxb-...",
    "channel": "CXXXXXXXXX",
    "dev_channel": "CXXXXXXXXX",
    "webhook_url": "https://hooks.slack.com/triggers/...",
    "my_user_id": "UXXXXXXXXX",
    "excluded_users": ["UXXXXXXXXX"]
  }
}
```

### Cómo obtener cada valor

| Campo | Cómo obtenerlo |
|---|---|
| `branch_prefix` | Tus iniciales (ej: `cv`). Se pide automáticamente en `g66 nb`. |
| `slack.token` | [api.slack.com/apps](https://api.slack.com/apps) → tu app → OAuth & Permissions → Bot Token |
| `slack.dev_channel` | ID del canal privado de devs (empieza con C) |
| `slack.webhook_url` | Workflow Builder → trigger "Se inicia con un webhook" → copiar URL |
| `slack.my_user_id` | Slack → Perfil → ⋮ → "Copiar ID de miembro" (empieza con U) |
| `slack.excluded_users` | IDs de usuarios a ocultar en `g66 slack users` |

---

## Comandos

### Flujo de trabajo diario

---

#### `g66 nb <env> <hu>` — Crear nueva rama

Crea la rama `{prefix}/{env}/{hu}` desde la rama base actualizada.

```bash
g66 nb dev AT-115
# → git checkout development && git pull && git checkout -b cv/dev/AT-115

g66 nb ci AT-115
# → git checkout master && git pull && git checkout -b cv/ci/AT-115

g66 nb prod AT-115
# → git checkout release && git pull && git checkout -b cv/prod/AT-115
```

**Primera vez:** pide el prefijo (ej: `cv`) y lo guarda en `~/.g66-config.json`.

---

#### `g66 go <env>` — Checkout rápido a rama base

```bash
g66 go dev    # git checkout development
g66 go ci     # git checkout master
g66 go prod   # git checkout release
```

---

#### `g66 undo` — Deshacer último commit

```bash
g66 undo
# Muestra el commit que se va a deshacer
# Pide confirmación (default: No)
# Ejecuta: git reset --hard HEAD^
```

⚠️ Destructivo — los cambios se pierden permanentemente.

---

#### `g66 config` — Sincronizar application.yml

Copia el archivo de configuración del repositorio de properties al proyecto local.

```bash
g66 config
g66 config --port 9090    # sobrescribe el puerto
```

Reemplaza automáticamente:
- `lb-*-private` → `lb-*`
- Elimina tokens `{cipher}`

---

#### `g66 ship` — Revertir + spotless + commit + push

```bash
g66 ship
# 1. Revierte application.yml
# 2. Aplica spotless
# 3. Commit y push
```

---

### Pull Requests

---

#### `g66 pr-smart` — PR con IA

Genera título y descripción con Claude, hace commit + push + PR en CodeCommit, actualiza Jira, sincroniza API Gateway y agrega al tablero de Slack.

```bash
g66 pr-smart                    # flujo completo
g66 pr-smart --dry-run          # solo muestra el PR generado, sin ejecutar
g66 pr-smart --mock             # salta commit/push/PR real (para testear flujos post-PR)
g66 pr-smart --apigw            # sincroniza API Gateway sin preguntar
g66 pr-smart --no-apigw-prompt  # omite la pregunta de API Gateway
g66 pr-smart --region us-west-2 # región AWS distinta
```

**Flujo completo:**
1. Claude analiza el diff y genera título + descripción
2. Muestra preview — confirmar para continuar
3. `git add` → `spotless:apply` → commit → push
4. Crea o actualiza PR en CodeCommit
5. Actualiza campo "PR en dev/CI/Prod" en Jira
6. Pregunta si sincronizar API Gateway
7. Pregunta si agregar al tablero de Slack (con assignee y comentario)

**Con `--mock`:** salta los pasos 3-5, usa PR #999 fake, continúa con API Gateway y Slack.

---

#### `g66 pr` — PR manual

```bash
g66 pr
```

PR en CodeCommit sin generación de IA.

---

### Tablero Slack

---

#### `g66 slack users` — Listar miembros del canal

```bash
g66 slack users             # carga desde cache local (rápido)
g66 slack users --refresh   # actualiza desde Slack API y guarda cache
```

Guarda en `~/.g66-slack-members.json`. Actualizar cada viernes con `--refresh`.

---

#### `g66 slack add` — Agregar item al tablero

```bash
g66 slack add
# Flujo interactivo:
# 1. Infiere HU desde la rama actual
# 2. Pide comentario opcional
# 3. Muestra lista de devs para asignar (desde cache)
# 4. Crea item en el tablero via Workflow Builder webhook
```

```bash
g66 slack add --hu AT-115 --pr-url "https://..." --assignee-id U0XXXXXXXXX
```

**Primera vez:** si `my_user_id` no está configurado, pide el Slack user ID y lo guarda.

---

#### `g66 slack test` — Verificar conexión

```bash
g66 slack test
# ✅ Conectado como b2bot (Global66)
# Canal: #nombre-canal (CXXXXXXXXX)
```

---

### Ambientes y homologación

---

#### `g66 env-status` — Matriz de HUs por ambiente

```bash
g66 env-status
```

Muestra qué HUs están en PROD / CI / DEV:

```
HU          PROD    CI      DEV
AT-110       ok      ok      ok
AT-108       --      ok      ok
AT-106       --      --      ok
```

---

#### `g66 sync` — Sincronizar HUs entre ambientes

```bash
g66 sync
# 1. Muestra matriz env-status
# 2. Seleccionar origen (dev/ci/prod)
# 3. Seleccionar destino
# 4. Checkbox de HUs a sincronizar
# 5. Preview de commits
# 6. Confirmar → cherry-pick + spotless + push directo
```

Excluye automáticamente: `Dockerfile`, `docker-compose*.yml`, `application-*.yml` (configurable en `homologIgnore`).

---

#### `g66 hotfix` — Cherry-pick a múltiples ambientes

```bash
g66 hotfix
# 1. Lista los últimos 30 commits
# 2. Checkbox para seleccionar commits
# 3. Elegir ambientes: Todos / PROD+CI / Solo PROD
# 4. Por cada ambiente: crea rama hotfix, cherry-pick, push, PR en CodeCommit
# 5. Comenta URLs de PRs en Jira
```

---

### Configuración del proyecto

---

#### `g66 props` — Sincronizar properties en ms-config-properties

```bash
g66 props
# 1. Analiza @Value en el diff
# 2. Dry-run: muestra properties detectadas por ambiente
# 3. Pide valor para properties sin default
# 4. Aplica cambios en dev/ci/prod
# 5. Crea PRs en ms-config-properties
# 6. Comenta en Jira (como comentario, no en campos PR en dev/CI/Prod)
```

```bash
g66 props --values '{"clave": "valor"}'   # pasar valores explícitos
```

---

#### `g66 migrate` — Generar migración Liquibase

```bash
g66 migrate
# 1. Detecta cambios en @Entity del diff
# 2. Muestra entidades modificadas
# 3. Claude genera migración en formato YAML
# 4. Preview completo del YAML
# 5. Pide nombre de archivo (ej: 20260518_AT-110.yaml)
# 6. Escribe en db/migrations/
```

Formato generado: `YYYYMMDD_{HU}.yaml`, IDs: `YYYYMMDD-N-AT-XXX`.

---

### IA y análisis

---

#### `g66 contract` — Generar contrato de API

```bash
g66 contract
g66 contract --class com.global.businessapi.presentation.impl.B2bAuthController#token
g66 contract --hu AT-110
g66 contract --dry-run
```

Genera documentación de endpoints (método, path, headers excl. `Claim-*`, curl, request/response) y la postea como comentario en Jira.

---

#### `g66 summary` — Resumen ejecutivo de la HU

```bash
g66 summary
```

Claude genera un resumen en español de todos los cambios de la HU y lo postea como comentario en Jira.

---

#### `g66 pr-review` — Revisión de PR con IA

```bash
g66 pr-review
```

Revisión del PR contra los lineamientos G66. Genera reporte en `~/Documents/PR Reviews/`.

---

### Infraestructura

---

#### `g66 apigw` — Sincronizar API Gateway

```bash
g66 apigw
```

Detecta endpoints nuevos en Spring controllers y los sincroniza en `ms-config-api-gateway` (dev/ci/prod).

---

#### `g66 wl` — Whitelist de IPs

```bash
g66 wl
```

Gestión de IPs en whitelist del microservicio.

---

### Utilidades

---

#### `g66 tokens` — Estadísticas de consumo de tokens IA

```bash
g66 tokens
g66 tokens --last 20     # últimas 20 entradas
g66 tokens --clear       # limpiar historial
```

Muestra tabla: comando | llamadas | tokens entrada | tokens salida | total.
Historial en `~/.g66-tokens.jsonl`.

---

#### `g66 doctor` — Diagnóstico del entorno

```bash
g66 doctor
```

Verifica que todas las dependencias estén instaladas y configuradas.

---

#### `g66 init` — Configuración inicial

```bash
g66 init
```

Configura nombre del desarrollador y preferencias globales. Ejecutar una vez al instalar.

---

#### `g66 revert` — Revertir application.yml

```bash
g66 revert
```

Restaura `application-{env}.yml` a su versión en el repositorio.

---

## Setup del Workflow Builder de Slack

Para que `g66 slack add` y `g66 pr-smart` puedan crear items en el tablero:

### 1. Scopes del bot (api.slack.com/apps)

```
chat:write
channels:history
groups:read
groups:history
users:read
incoming-webhook
```

### 2. Variables del trigger webhook

| Nombre | Tipo |
|---|---|
| `title` | Texto |
| `hu` | Texto |
| `pr_url_dev` | URL |
| `pr_url_ci` | URL |
| `pr_url_prod` | URL |
| `comments` | Texto |
| `assignee_id` | Miembro |
| `dev` | Miembro |

### 3. Mapeo de campos en el paso "Agregar elemento a lista"

| Campo tablero | Variable webhook |
|---|---|
| Summary | `title` |
| Details | `comments` |
| PR DEV | `pr_url_dev` |
| PR CI | `pr_url_ci` |
| PR PROD | `pr_url_prod` |
| Assignee | `assignee_id` |
| Dev | `dev` |
| Status | `Sin Iniciar` (valor fijo) |

### 4. Agregar el bot al canal privado

Canal de devs → nombre del canal → Integraciones → Agregar apps → buscar el bot.

---

## Actualización semanal (viernes)

```bash
g66 slack users --refresh
```

Actualiza el cache de miembros del canal en `~/.g66-slack-members.json`.

---

## Flujo completo de una HU nueva

```bash
# 1. Crear rama desde la base actualizada
g66 nb dev AT-120

# 2. Desarrollar... (commits normales)

# 3. Sincronizar configuración local para correr el servicio
g66 config

# 4. Si hay nuevas @Entity, generar migración Liquibase
g66 migrate

# 5. Subir PR con IA + tablero Slack + API Gateway
g66 pr-smart

# 6. Si hay nuevas @Value sin default, sincronizar properties
g66 props

# 7. Ver estado de la HU en todos los ambientes
g66 env-status

# 8. Cuando sea aprobado, homologar a CI
g66 sync
```

---

## Versión actual

`1.7.7`

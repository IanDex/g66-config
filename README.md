# g66 CLI — Herramientas para microservicios Global66

CLI de productividad para el equipo de desarrollo. Automatiza el flujo completo: configuración, PRs, migraciones, propiedades y homologación entre ambientes.

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

El TL del equipo comparte este archivo con los valores ya configurados.  
Solo debes agregar tu `branch_prefix` (tus iniciales).

```json
{
  "configRepoPath": "C:/ruta/a/ms-config-properties",
  "branch_prefix": "cv"
}
```

---

## Comandos

### Flujo de trabajo diario

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

Genera título y descripción con Claude, hace commit + push + PR en CodeCommit, actualiza Jira y sincroniza API Gateway.

```bash
g66 pr-smart                    # flujo completo
g66 pr-smart --dry-run          # solo muestra el PR generado, sin ejecutar
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

---

#### `g66 pr` — PR manual

```bash
g66 pr
```

PR en CodeCommit sin generación de IA.

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

Excluye automáticamente: `Dockerfile`, `docker-compose*.yml`, `application-*.yml`.

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
# 6. Comenta en Jira
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

Genera documentación de endpoints (método, path, headers, curl, request/response) y la postea como comentario en Jira.

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

#### `g66 company` — Vista completa de una compañía

```bash
g66 company                              # pide env + company ID
g66 company --env dev --id 123           # directo
g66 company --env dev --id 123 --login   # muestra info + selecciona usuario + hace login
g66 company --env dev --id 123 --login --decode  # + decodifica JWT claims
```

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

## Flujo completo de una HU nueva

```bash
# 1. Sincronizar configuración local para correr el servicio
g66 config

# 2. Si hay nuevas @Entity, generar migración Liquibase
g66 migrate

# 3. Subir PR con IA + API Gateway
g66 pr-smart

# 4. Si hay nuevas @Value sin default, sincronizar properties
g66 props

# 5. Ver estado de la HU en todos los ambientes
g66 env-status

# 6. Cuando sea aprobado, homologar a CI
g66 sync
```

---

## Versión actual

`1.7.8`

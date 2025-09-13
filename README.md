# 🛠️ g66 — CLI para sincronizar y automatizar flujos DevLocal en microservicios Global66

Herramienta de línea de comandos para facilitar la configuración, automatizar PRs y gestionar whitelists en microservicios de Global66. Incluye sincronización de archivos `application-{env}.yml` desde `ms-config-properties`, revertir cambios, comandos para comitear fácilmente y automatización de PRs en CodeCommit.

---

## 🚀 ¿Qué hace esta herramienta?

- Detecta en qué microservicio estás (`ms-company`, `ms-document`, etc.).
- Detecta en qué rama Git estás y de dónde proviene (base branch: `development`, `master`, `release`).
- Copia automáticamente el archivo de configuración (`application-dev.yml` o `application-ci.yml`) desde `ms-config-properties`.
- Realiza un `git pull` antes de copiar para asegurar que el archivo esté actualizado.
- Aplica modificaciones al archivo copiado:
  - Reemplazo de `lb-dev-private.global66.com` → `lb-dev.global66.com`
  - Reemplazo de `lb-ci-private.global66.com` → `lb-ci.global66.com`
  - Limpieza de tokens `{cipher}...`
  - Agrega esta propiedad al inicio del archivo:

    ```yaml
    spring:
      cloud:
        config:
          enabled: false
    ```
- Comando para revertir (`revert`) el archivo al original del repo.
- Comando para comitear en un solo paso (`ship`) con `spotless`, `git add`, `commit` y `push`.
- Creación de Pull Requests automatizada (`pr`) usando AWS CodeCommit.
- Gestión de **whitelist**:
  - Busca un `companyId` por email en la base de datos.
  - Lo agrega al campo `white-list.exclude.user-ids` en `auth-server.yml` de `ms-config-properties`.
  - Genera PR automático en CodeCommit.
- Reinicio de pipelines:
  - Modifica el archivo `src/test/resources/application.yml` en `ms-auth-server`, alternando el valor de `connect-timeout` entre `30` ↔ `31`.
  - Genera PR en CodeCommit para forzar reinicio del pipeline.

---

## 📦 Instalación

> ⚠️ Si instalaste previamente la versión **1.0.0** con `npm link`, debes **desvincularla** antes de instalar esta nueva:

```bash
npm unlink -g g66-config
```

Instalación limpia:

```bash
git clone https://github.com/IanDex/g66-config.git
cd g66-config
npm install
npm run build
npm link
```

Esto te permitirá usar `g66` desde cualquier terminal.

---

## 📁 Estructura esperada

```
src/
└── main/
    └── resources/
        └── application-dev.yml
        └── application-ci.yml
```

En el repo `ms-config-properties`:

```
ms-config-properties
...
```

---

## ⚙️ Configuración inicial

El CLI usa un archivo de configuración en `~/.g66-config.json`. Ejemplo:

```json
{
  "configRepoPath": "/ruta/local/a/ms-config-properties",
  "authServerRepoPath": "/ruta/local/a/ms-auth-server",
  "port": 8888,
  "db": {
    "dev": {
      "host": "host-dev",
      "user": "usuario-dev",
      "password": "contraseña-dev",
      "database": "company",
      "port": 3306
    },
    "ci": {
      "host": "host-ci",
      "user": "usuario-ci",
      "password": "contraseña-ci",
      "database": "company",
      "port": 3306
    },
    "prod": {
      "host": "host-prod",
      "user": "usuario-prod",
      "password": "contraseña-prod",
      "database": "company",
      "port": 3306
    }
  }
}
```

- `configRepoPath`: ruta local al repo `ms-config-properties`.  
- `authServerRepoPath`: ruta local al repo `ms-auth-server`.  
- `port`: puerto para servicios locales (default `8080`, configurable con `g66 config -p 8888`).  
- `db`: credenciales para conexión a MySQL en cada entorno (`dev`, `ci`, `prod`).  

---

## 🧪 Uso

### 🛠️ Sincronización

```bash
g66 config
```

Este comando detecta automáticamente el entorno (`dev`, `ci`, `prod`) a partir de la rama actual de Git y realiza la sincronización del archivo de configuración YAML correspondiente al microservicio en el que estás.

Además, puedes especificar un **puerto local del microservicio** para que el archivo YAML generado lo incluya, usando:

```bash
g66 config -p <puerto>
```

Por ejemplo:

```bash
g66 config -p 8888
```

#### 🧾 Ejemplo de salida:

```
📍 Microservicio detectado: company
🌿 Rama actual: cv/dev/fix-auth-token
🔎 Rama base inferida: development
🌐 Entorno inferido: dev
📄 Archivo de configuración: company.yml
📁 Repositorio de configuración: ../Global66/ms-config-properties
📂 Ruta destino: src/main/resources/application-dev.yml
🔧 El archivo será modificado:
   • Reemplazo de lb-*-private → lb-*
   • Eliminación de token cifrado `{cipher}`
   • Puerto local ajustado a 8888
✅ ¿Deseas aplicar esta configuración ahora?
```

✅ Al confirmar, el CLI copia y ajusta el archivo YAML desde `ms-config-properties`, aplicando transformaciones automáticas según el entorno.


### 🔄 Revertir archivo (BETA)

```bash
g66 revert 
```

Restaura el archivo de configuración actual (`application-{env}.yml`) desde `ms-config-properties`.

---

### 🚀 Shippear cambios

```bash
g66 ship
```

Este comando:

1. Ejecuta `g66 revert`
2. Aplica `mvn spotless:apply`
3. Realiza `git add .`
4. Solicita historia de usuario y descripción
5. Hace `git commit -m "[HU] Desc"`
6. Realiza `git push`

---

### 📤 Crear Pull Request

```bash
g66 pr
```

Este comando:

- Detecta entorno, rama actual y base.
- Verifica que la rama esté pusheada y tenga commits nuevos.
- Solicita:
  - Historia de Jira (HU-123)
  - Título del PR
  - Descripción en formato Markdown
  - (Opcional) Bloque Liquibase
  - (Opcional) Fragmento de propiedades YAML
- Construye el PR con plantilla estándar.
- Crea el PR en AWS CodeCommit.
- Abre automáticamente el navegador en la URL del PR.

---

### 🔐 Agregar a whitelist y reiniciar pipeline

```bash
g66 wl --email usuario@ejemplo.com --env dev
```

Este comando:

1. Busca el `companyId` en la base de datos MySQL (`db.dev`, `db.ci`, `db.prod` según `--env`).  
2. Agrega ese `companyId` al campo `white-list.exclude.user-ids` en `auth-server.yml` de `ms-config-properties`.  
3. Crea PR en CodeCommit para `ms-config-properties`.  
4. Modifica `src/test/resources/application.yml` en `ms-auth-server`, alternando `connect-timeout` entre `30` ↔ `31`.  
5. Crea PR en CodeCommit para `ms-auth-server`, forzando reinicio de pipeline.  

---

## ❗ Manejo de errores

- Si ejecutas `g66` fuera de un repositorio Git:

```
❌ Este directorio no es un repositorio Git.
```

- Si no se encuentra el archivo original, la operación se cancela con un mensaje adecuado.  
- Si no existe la ruta a `ms-config-properties` o `ms-auth-server`, se solicita ingresar nuevamente.  
- Si no hay commits nuevos, el comando `g66 pr` o `g66 wl` se cancela.  

---

## 🎛️ Subcomandos disponibles

```bash
g66 init        # Configura tu nombre y preferencias locales
g66 config      # Sincroniza el archivo de configuración
g66 revert      # Revierte el archivo application-{env}.yml al original
g66 ship        # Revert + spotless + git commit + push
g66 pr          # Crea un Pull Request en AWS CodeCommit
g66 wl          # Agrega companyId a whitelist y reinicia pipeline
g66 -v, --version
```

---

## 🛡️ Requisitos

- Node.js 18+  
- Git y Maven instalados  
- Clonado de `ms-config-properties` y `ms-auth-server`  
- Permisos de escritura en AWS CodeCommit  

---

## 🧑‍💻 Autor

**Crisis / Equipo de Desarrollo Global66**  
Construido con 💙 para mejorar el flujo DevLocal en microservicios  

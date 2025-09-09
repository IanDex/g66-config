# 🛠️ g66 — CLI para sincronizar y automatizar flujos DevLocal en microservicios Global66

Herramienta de línea de comandos para facilitar la configuración y el flujo de trabajo en microservicios localmente. Incluye sincronización de archivos `application-{env}.yml` desde `ms-config-properties`, revertir cambios, y comandos para comitear fácilmente en un solo paso.

---

## 🚀 ¿Qué hace esta herramienta?

- Detecta en qué microservicio estás (`ms-company`, `ms-document`, etc.).
- Detecta en qué rama Git estás y de dónde proviene (base branch).
- Copia automáticamente el archivo de configuración (`application-dev.yml` o `application-ci.yml`) desde `ms-config-properties`.
- Realiza un `git pull` antes de copiar para asegurar que el archivo esté actualizado.
- Aplica modificaciones al archivo copiado:
  - Reemplazo de `lb-dev-private.global66.com` → `lb-dev.global66.com`
  - Reemplazo de `lb-ci-private.global66.com` → `lb-ci.global66.com`
  - Limpieza de tokens `{cipher}...`
  - Inserción de la propiedad `spring.cloud.config.enabled: false` al inicio del archivo
- Comando para revertir (`revert`) el archivo al original del repo.
- Comando para comitear en un solo paso (`ship`) con `spotless`, `git add`, `commit` y `push`.
- Errores controlados si no estás en un repositorio Git.

---

## 📦 Instalación

```bash
git clone https://github.com/IanDex/g66-config.git
cd g66-config
npm install
npm run build
npm link
```

> Esto hará que puedas usar `g66` desde cualquier terminal.

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
ms-config-properties/
├── application-dev.yml
├── application-ci.yml
├── ms-company/
│   ├── application-dev.yml
│   └── application-ci.yml
...
```

---

## 🧪 Uso

### 🛠️ Sincronización

```bash
g66 config
```

Detecta automáticamente el entorno (`dev`, `ci`) y muestra:

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
✅ ¿Deseas aplicar esta configuración ahora?
```

---

### 🔄 Revertir archivo

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

## ❗ Manejo de errores

- Si ejecutas `g66` fuera de un repositorio Git, verás:

```
❌ Este directorio no es un repositorio Git.
```

- Si no se encuentra el archivo original, se cancela la operación con un mensaje adecuado.
- Si no existe la ruta a `ms-config-properties`, se solicita ingresar nuevamente.

---

## 🎛️ Subcomandos disponibles

```bash
g66 config      # Sincroniza el archivo de configuración
g66 revert      # Revierte el archivo application-{env}.yml al original
g66 ship        # Revert + spotless + git commit + push
g66 -v, --version
```

---

## 🛡️ Requisitos

- Node.js 18+
- Tener clonado `ms-config-properties`
- Git y Maven instalados
- Permisos de escritura en el microservicio

---

## 🧑‍💻 Autor

**Crisis / Equipo de Desarrollo Global66**  
Construido con 💙 para mejorar el flujo DevLocal en microservicios


# 🛠️ g66-config — CLI para sincronizar archivos de configuración de microservicios Global66

Herramienta de línea de comandos para facilitar la configuración de microservicios en local, trayendo automáticamente el archivo `application-{env}.yml` correcto desde el repositorio `ms-config-properties`, según la rama actual (`development`, `master`, o ramas tipo `*/dev/*`, `*/ci/*`).

---

## 🚀 ¿Qué hace esta herramienta?

- Detecta en qué microservicio estás (`ms-company`, `ms-document`, etc.).
- Detecta en qué rama git estás y de dónde proviene (base branch).
- Copia automáticamente el archivo de configuración (`application-dev.yml` o `application-ci.yml`) desde el repositorio `ms-config-properties`.
- Realiza un `git pull` para asegurarse de que las properties estén actualizadas.
- Modifica el archivo copiado para:
  - Reemplazar cualquier `lb-dev-private.global66.com` → `lb-dev.global66.com`.
  - Reemplazar cualquier `lb-ci-private.global66.com` → `lb-ci.global66.com`.
  - Limpiar cualquier token encriptado de Slack (`{cipher}...` → `""`).
  - Agregar esta propiedad al inicio del archivo:

    ```yaml
    spring:
      cloud:
        config:
          enabled: false
    ```

- Te muestra los pasos y cambios visualmente en español, con íconos ✅ y ❌, y al final te pide confirmación para aplicar los cambios.

---

## 📦 Instalación

### 1. Clonar el proyecto

```bash
git clone https://github.com/IanDex/g66-config.git
cd g66-config
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Compilar el proyecto

```bash
npm run build
```

### 4. Hacerlo global

```bash
npm link
```

> Este paso hará que puedas usar `g66-config` desde cualquier terminal, en cualquier microservicio.

---

## ⚙️ Configuración inicial

La primera vez que lo ejecutes, la CLI te pedirá que indiques la ruta local donde tienes clonado el repositorio `ms-config-properties`.

Ejemplo:

```bash
? Ruta local a ms-config-properties: ../Global66/ms-config-properties
```

Esta ruta se guardará en un archivo de configuración local y no tendrás que volver a ingresarla.

---

## 🧪 Uso

Desde cualquier microservicio:

```bash
g66-config
```

La CLI detectará todo automáticamente y te mostrará algo como:

```
🔍 Microservicio detectado: ms-company
🌱 Rama actual: feature/cv/dev/fix-document-path
📌 Rama base inferida: development
🧭 Archivo remoto: application-dev.yml
📁 Archivo destino: src/main/resources/application-dev.yml
🔄 Actualizando ms-config-properties con git pull...
📎 Copiando archivo...
⚙️ Modificando archivo:
   ✅ Reemplazo de dominios internos ✔
   ✅ Limpieza de {cipher} ✔
   ✅ Configuración 'spring.cloud.config.enabled=false' agregada ✔
🤔 ¿Deseas aplicar esta configuración ahora?
```

Si confirmas, el archivo será sobrescrito.

---

## 🧼 Comportamiento adicional

- Si el archivo de configuración ya existe en el microservicio, será sobrescrito solo después de tu confirmación.
- Si hay un error (por ejemplo, la ruta a `ms-config-properties` ya no existe), se te pedirá corregirla.
- La herramienta también funciona correctamente en las ramas `development`, `master` o cualquier rama derivada como `cv/ci/feature-x`, `cv/dev/bugfix`.

---

## 🧾 Estructura de archivos esperada

En el repositorio `ms-config-properties`, se espera una estructura como:

```
ms-config-properties/
│
├── application-dev.yml
├── application-ci.yml
├── ms-company/
│   ├── application-dev.yml
│   └── application-ci.yml
├── ms-document/
│   ├── application-dev.yml
│   └── application-ci.yml
...
```

---

## 🛡️ Requisitos

- Node.js 18 o superior
- Git instalado y funcionando correctamente
- Tener clonado el repositorio de `ms-config-properties`
- Tener permisos de lectura/escritura en tu microservicio local

---

## 🗂️ Estructura del proyecto

```
g66-config/
├── bin/
│   └── g66-config.js       # Archivo compilado para ejecución CLI
├── src/
│   ├── index.ts            # Entrada principal
│   ├── config.ts           # Configuración local (ruta de properties)
│   ├── detect.ts           # Detección de entorno
│   └── sync.ts             # Lógica de sincronización
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## 📜 Licencia

MIT – Global66 Internal Tooling.

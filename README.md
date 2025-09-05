# g66-config

CLI para sincronizar automáticamente archivos de configuración desde el repositorio `ms-config-properties` hacia el microservicio actual, con soporte para detección de entorno (`dev` o `ci`), reemplazo de URLs privadas, y limpieza de secretos cifrados.

## Uso

```bash
cd ms-company
g66-config
```

## Requisitos

- Tener Node.js 18+
- Tener `ms-config-properties` clonado localmente
- Tener configurada la ruta a `ms-config-properties` (se solicita la primera vez)

## Instalación

```bash
npm install
npm run build
npm link
```
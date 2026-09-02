# Diagnóstico — Error Linux-only en `npm install`

## Causa raíz (inequívoca)

**Versión de runtime de Node incompatible con la dependencia nativa `better-sqlite3`.**

El `npm install` falla en Linux porque el proyecto se está instalando con **Node v26.7.0**, una
versión demasiado nueva para `better-sqlite3@11.10.0`. Al no existir un binario precompilado
(prebuild) para Node 26, `node-gyp` intenta compilar el addon nativo desde el código fuente C++,
y la compilación falla porque la API de V8 cambió de forma incompatible: varios métodos que
`better-sqlite3` usa fueron **renombrados o eliminados** en el V8 que trae Node 26.

En macOS funciona porque ahí se usa una versión de Node más vieja (20/22), para la cual
`better-sqlite3` publica binarios precompilados y no se dispara la compilación desde fuente.

## Clasificación del problema

- **Versión de runtime (Node)** — es la causa. Node 26 es demasiado nuevo.
- No es case-sensitivity, ni separador de ruta, ni CRLF/LF, ni permiso de ejecución, ni variable
  de entorno, ni path hardcodeado. El log no muestra ningún `ENOENT`/`EACCES` ni ruta tipo
  `/Users/...` o `/Applications/...`.

## Archivo / línea responsable

- `apps/server/package.json` línea 19 → `"better-sqlite3": "^11.7.0"` (resuelve a 11.10.0).
- `package.json` línea 16-18 → `"engines": { "node": ">=20" }` — **no fija un tope superior**,
  por lo que Node 26 se considera "válido" y no se bloquea la instalación.

## Evidencia del log (líneas exactas)

```
2 info using node@v26.7.0
```

```
4815 error ./src/util/binder.lzz:40:37: error: 'class v8::Object' has no member named 'GetPrototype'; did you mean 'GetPrototypeV2'?
4816 error ./src/util/binder.lzz:49:62: error: 'class v8::Object' has no member named 'GetPrototype'; did you mean 'GetPrototypeV2'?
4831 error ./src/better_sqlite3.lzz:68:34: error: 'class v8::Context' has no member named 'GetIsolate'
4868 error ./src/objects/database.lzz:416:89: error: 'const class v8::PropertyCallbackInfo<v8::Value>' has no member named 'This'
```

```
4927 error make: *** [better_sqlite3.target.mk:122: Release/obj.target/better_sqlite3/src/better_sqlite3.o] Error 1
4928 error gyp ERR! build error
4929 error gyp ERR! stack Error: `make` failed with exit code: 2
4934 error gyp ERR! node -v v26.7.0
4935 error gyp ERR! node-gyp -v v12.4.0
4938 error gyp ERR! not ok
```

La línea 4815 es la prueba directa: el compilador reporta que `v8::Object::GetPrototype` ya no
existe (fue renombrado a `GetPrototypeV2` en V8/Node 26). `better-sqlite3@11.10.0` todavía llama
a la API vieja, por lo que la compilación nativa aborta y `npm install` termina con `exit 1`.

## Por qué macOS no falla

En macOS el proyecto corre con Node 20/22. Para esas versiones `better-sqlite3` publica
prebuilds (binarios `.node` precompilados), así que `prebuild-install` los descarga y **nunca se
invoca `node-gyp`**. El problema es específico de Linux únicamente porque en esa máquina se usó
Node 26 (el Node embebido de Hermes en `/home/minimalart/.hermes/node`), no por una diferencia
de sistema operativo en sí.

## Corrección recomendada

1. **Inmediata:** instalar con una versión de Node soportada (20 LTS o 22 LTS), p. ej. vía
   `nvm use 22` antes de `npm ci`.
2. **De fondo:** subir `better-sqlite3` a una versión que soporte Node 26 (>= 12.x), o acotar
   `engines.node` a un rango explícito (p. ej. `">=20 <26"`) para que `npm` rechace Node 26 con un
   error claro en lugar de intentar compilar y fallar.

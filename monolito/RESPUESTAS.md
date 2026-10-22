# Respuestas — TP N° 3

**Estudiante:** Gregorio Luján  
**Materia:** Programación Distribuida (UCH)

Las pruebas que respaldan estas respuestas están en `PRUEBAS.md` y en `evidencias/`.

---

## Parte I — Persistencia y modelado

### 1. ¿Qué diferencia existe entre almacenar un recurso en un arreglo JavaScript y almacenarlo en MongoDB?

El arreglo vive en el proceso de Node: es rápido, pero se pierde al reiniciar, no se comparte entre instancias y la integridad (unicidad de patente, rangos) hay que programarla a mano. MongoDB guarda documentos en disco, en una base aparte del proceso HTTP. Reiniciar Node no borra los vehículos; otra instancia puede leer los mismos datos; y un índice único rechaza duplicados aunque dos requests lleguen juntas.

En el TP1/TP2, un `POST` seguido de `npm start` devolvía otra vez los 3 seeds. Acá el Honda Civic creado sigue existiendo después del reinicio: está en la colección `vehiculos` de la base `taller`.

### 2. ¿Qué función cumplen el Schema y el Model de Mongoose dentro de la aplicación?

El **Schema** declara la forma del documento y las reglas (tipos, `required`, `min`/`max`, `unique`, `match`). Es el contrato de integridad del recurso, no el de HTTP.

El **Model** es la clase que usa ese schema para hablar con una colección: `Vehiculo.findById`, `create`, `save`. Las rutas no arman queries sueltas ni validan campo por campo como en el TP1: delegan en el model y traducen `ValidationError` → 400 y código 11000 → 409.

### 3. ¿Por qué conviene diferenciar un identificador inválido de un identificador válido cuyo documento no existe?

Son errores distintos y se corrigen distinto.

- `GET /api/vehiculos/no-es-un-objectid` → **400**: el cliente mandó algo que MongoDB ni siquiera puede usar como `_id`. Hay que corregir el pedido.
- `GET /api/vehiculos/aaaaaaaaaaaaaaaaaaaaaaaa` → **404**: el id tiene forma de ObjectId, el servidor lo entendió, y ese documento no está. El cliente puede haber usado un id viejo o borrado.

Si ambos dieran 404, un typo y un recurso ausente se verían iguales. Si ambos dieran 400, un id correcto de un auto ya eliminado parecería un bug del cliente.

---

## Parte II — Logging y rotación

### 1. ¿Qué diferencia práctica existe entre registrar un evento como INFO, WARN o ERROR?

- **INFO**: la operación anduvo. Sirve para seguir el flujo (arrancó HTTPS, se creó el vehículo X, GET 200).
- **WARN**: algo se rechazó pero el servicio sigue (400 de validación, 409 de patente duplicada, lock ocupado). Hay que mirarlo si se acumula, no es una caída.
- **ERROR**: no se pudo completar y hay que diagnosticar (MongoDB caído al conectar, Redis que no libera el lock, 500).

Mezclarlos obliga a greppear a ciegas. Separar permite que `error-YYYY-MM-DD.log` sea corto y accionable.

### 2. ¿Qué problema resuelven la rotación y la retención limitada de archivos de log?

Sin rotación, un único `app.log` crece hasta llenar el disco. La rotación corta por fecha y/o tamaño (`app-2026-09-04.log`, y si pasa `LOG_MAX_SIZE`, `app-2026-09-04.1.log`). La retención (`LOG_MAX_FILES=7d` o `3` archivos en la demo) borra los viejos. Se conserva historia reciente sin un archivo eterno.

---

## Parte III — OpenAPI / Swagger

### 1. ¿Qué diferencia existe entre OpenAPI y Swagger UI?

OpenAPI es el **contrato**: un documento JSON/YAML que describe rutas, bodies, códigos y schemas. Acá vive en `src/openapi.js` y se sirve en `/api-docs.json`.

Swagger UI es una **interfaz** que lee ese contrato y lo muestra en el navegador, con Try it out. No es la API: es un cliente generado a partir de la especificación.

### 2. ¿La existencia de documentación Swagger garantiza que la implementación del endpoint sea correcta? Justifique.

No. Swagger describe lo que *decimos* que hace la API. Si el YAML dice 409 y el código responde 400, Try it out va a mostrar 400 y la doc queda mentira. La especificación no ejecuta las reglas de Mongoose ni el lock: hay que mantenerla alineada y probarla (como en `pruebas-swagger.js` y las corridas CRUD desde la UI).

### 3. ¿Qué ventaja aporta disponer de un contrato de API documentado y reproducible?

Cualquiera (compañero, docente, Postman, otro servicio) puede ver los endpoints, los códigos y un ejemplo, y repetir el mismo pedido. No depende de un README que se desactualiza ni de “fijate en el código”. El JSON de `/api-docs.json` se puede versionar y comparar.

---

## Parte IV — Integración

### 1. ¿Qué problema resuelve MongoDB/Mongoose que no resolvía el almacenamiento en memoria?

La **durabilidad** y la **integridad declarada**. El arreglo se evaporaba al matar Node y la unicidad de la patente era un `some()` sobre ese arreglo. MongoDB conserva el documento; Mongoose rechaza datos inválidos y el índice único de `patente` responde 409 aunque el proceso se reinicie o haya más de una instancia.

No resuelve la condición de carrera del stock: dos lecturas-escrituras concurrentes siguen pudiendo pisarse. Eso sigue siendo trabajo del lock en Redis.

### 2. ¿Qué responsabilidad cumple cada componente: MongoDB, Redis/Memurai, Winston y OpenAPI/Swagger?

| Componente | Responsabilidad |
|---|---|
| **MongoDB + Mongoose** | Persistencia e integridad del recurso (documentos, validación, unicidad). |
| **Redis/Memurai** | Coordinación: lock de corta vida sobre `lock:repuesto:{id}` para la sección crítica. No guarda el stock. |
| **Winston** | Registro de lo que pasó, con niveles, rotación y retención. No cambia el negocio. |
| **OpenAPI / Swagger** | Documentar y permitir probar el contrato HTTP. No implementa los endpoints. |

HTTPS (del TP2) sigue cifrando el canal. Cada pieza cubre un problema distinto; ninguna reemplaza a las otras.

# Panel de control de Torque (exposición)

```bash
node scripts/panel/server.mjs        # → http://localhost:4000
```

Sin dependencias (Node ≥ 18). Escucha solo en `127.0.0.1` y ejecuta únicamente acciones de una lista
cerrada: no acepta comandos libres. Lee la contraseña del admin del `.env` y nunca la manda al navegador.

**Destino** (arriba a la izquierda):
- **Pruebas (`torque-defensa`, :3100):** stack descartable; el destino por defecto.
- **Demo real (`torque`, :3000):** todo lo que apaga servicios, cambia configuración o escribe datos pide confirmación.

Para arrancar directamente sobre la demo: `PANEL_DESTINO=demo node scripts/panel/server.mjs`.

| Pestaña | Qué permite |
|---|---|
| Resumen | Diagrama de la arquitectura en vivo: cada contenedor con su luz de estado y CPU; las dependencias caídas se marcan en rojo. Al lado, órdenes por estado, stock y últimos movimientos del libro. Tocar una caja abre su detalle |
| App | Swagger de Torque dentro del panel. Cuentas de prueba (`demo-admin@torque.local` / `admin-demo-2026`, `demo-mecanico@torque.local` / `mecanico-demo-2026`) con email, contraseña y token para copiar, y «Entrar en Swagger» para autorizar en un clic. La contraseña del admin real del `.env` nunca se muestra |
| Servicios | Los 10 contenedores con estado, uptime, CPU, memoria y puertos. Apagar, matar (SIGKILL), congelar (pause), reiniciar o prender cada uno. Al tocar una fila: imagen, comando, redes, healthcheck y **variables de entorno** (secretos ocultos) |
| Configuración | Cambiar en caliente `DEMO_DELAY_MS`, `LOCK_TTL_MS`, `LAB_ENDPOINTS`, `JWT_EXPIRES_IN`, `SESSION_IDLE`, `BCRYPT_ROUNDS` y timeouts; recrea solo el servicio afectado. Al lado, las variables efectivas de cualquier contenedor. «Volver al .env» deshace todo |
| Pruebas | Experimentos con gráfico en vivo (lecturas, logins, órdenes/s, mismo repuesto, invariantes), carreras H02–H15, caídas, ensayo de la demo, sesión y suites |
| Datos | Negocio en vivo (órdenes, stock, libro, cada 3 s) y explorador de las 4 bases **de solo lectura** |
| Consola HTTP | Cualquier pedido `/api/...` como ADMIN, MECANICO, sin token o con token inválido; «Rastrear» muestra el recorrido por los servicios usando el request ID |
| Logs | Logs en vivo de un servicio o de todos, con filtro |

Enlaces directos: `#app`, `#servicios`, `#servicios:redis` (abre su detalle), `#pruebas`, `#datos`, `#logs`… Atajo de teclado: Alt+1…8.

**Combinar pruebas:** los trabajos corren en paralelo. Ejemplo: lanzar «Lecturas, 200 usuarios, 60 s» y,
mientras tanto, apagar `redis` o congelar `inventory-service`; el gráfico muestra el efecto en el momento.

La salida de los trabajos va a `scripts/panel/salidas/` (ignorada por git), para no pisar la evidencia de
`docs/defensa/resultados/`. Si se para un escenario de caída a la mitad, puede quedar un servicio
apagado: usar «Prender todo».

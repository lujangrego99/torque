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

| Bloque | Qué permite |
|---|---|
| Contenedores | Ver estado, salud, CPU y memoria de los 10 contenedores. Por cada uno: apagar (stop), matar (SIGKILL), congelar (pause) y reiniciar; también prender, apagar o reiniciar todo |
| Configuración en caliente | Cambiar `DEMO_DELAY_MS`, `LOCK_TTL_MS`, `LAB_ENDPOINTS`, `JWT_EXPIRES_IN`, `SESSION_IDLE`, `BCRYPT_ROUNDS`, timeouts. El panel recrea solo el servicio afectado y muestra el valor **efectivo** (leído del contenedor). «Volver al .env» deshace los cambios |
| Experimentos | Lecturas con N usuarios, N logins simultáneos, órdenes por segundo, N órdenes sobre el mismo repuesto, invariantes. Gráfico en vivo de req/s, p95 y errores |
| Escenarios preparados | Carreras H02/H03/H04/H07/H15, caídas (auth, inventory, redis, vehicles, workorders-db, kill a mitad de una orden, timeout, reinicio), ensayo de la demo, vencimiento de sesión y suites TP6/TP7/correcciones |
| Consola HTTP | Cualquier pedido `/api/...` como ADMIN, MECANICO, sin token o con un token inválido. Muestra status, ms y request ID; «Rastrear rid» muestra por qué servicios pasó |
| Logs en vivo | `docker compose logs -f` de un servicio, con filtro |

**Combinar pruebas:** los trabajos corren en paralelo. Ejemplo: lanzar «Lecturas, 200 usuarios, 60 s» y,
mientras tanto, apagar `redis` o congelar `inventory-service`; el gráfico muestra el efecto en el momento.

La salida de los trabajos va a `scripts/panel/salidas/` (ignorada por git), para no pisar la evidencia de
`docs/defensa/resultados/`. Si se para un escenario de caída a la mitad, puede quedar un servicio
apagado: usar «Prender todo».

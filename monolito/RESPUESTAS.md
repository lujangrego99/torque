# Respuestas — TP4 Consenso (Raft / Paxos)

## Preguntas de control (Hito 2)

### 1. ¿Por qué un nodo no debería votar por dos candidatos diferentes dentro del mismo término?

Porque el término identifica una ronda de elección. Si un nodo otorgara dos votos en el mismo término, dos candidatos podrían alcanzar mayoría a la vez y aparecerían **dos Leaders** para el mismo término, rompiendo la seguridad de Raft (a lo sumo un Leader por término). Por eso se persiste `votedFor` junto con `currentTerm`.

### 2. ¿Qué debería ocurrir si un mensaje recibido contiene un término mayor al término local?

El nodo debe **adoptar ese término**, olvidar su voto del término anterior (`votedFor = null`), pasar a **FOLLOWER** y aceptar la información de liderazgo si aplica. Así se abandona una elección o un liderazgo obsoleto frente a un cluster más avanzado.

### 3. ¿Puede un único nodo de un cluster de tres declarar por sí solo que existe consenso?

No. La mayoría de 3 es **2**. Un nodo solo tiene un voto; sin al menos otro voto (u otro nodo que replique/confirme) no hay quorum. Por eso con 1/3 activo no se confirman escrituras nuevas.

## Paxos vs Raft (conceptual)

| | Paxos | Raft |
|---|---|---|
| Enfoque | Acuerdos por instancias (proposers/acceptors/learners); varias variantes | Descompone consenso en Leader election + log replication |
| Legibilidad | Potente pero difícil de enseñar/implementar “completo” | Diseñado para ser entendible; estados y RPCs claros |
| Leader | No siempre hay un líder estable único en la presentación clásica | Leader fuerte: concentra propuestas de orden |
| Este TP | Solo comparación conceptual | Implementación educativa simplificada |

Raft no es “Paxos con otro nombre”, pero resuelve el mismo problema de **acuerdo sobre una secuencia de valores** con otra organización pedagógica y operativa.

## Decisión de diseño: escritura a follower

Se eligió **rechazo HTTP 503** informando `leaderId` y URLs del Leader.  
Motivos: evidencia clara en demos, el follower no aplica estado de negocio ni enmascara el rol, y el cliente (o el operador del lab) reintenta en el Leader.

## Redis vs Raft (integración)

- **Redis/Memurai**: exclusión mutua de la sección crítica del descuento (`lock:repuesto:{id}`).
- **Raft**: orden total, replicación y commit de la modificación aceptada.
- Redis **no** almacena votos, no elige Leader y no decide commit.

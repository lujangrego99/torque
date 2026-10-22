const logger = require("../logger");
const persistence = require("./persistence");
const { aplicarComando } = require("./stateMachine");
const rpc = require("./rpcClient");

class RaftNode {
  constructor(config) {
    this.config = config;
    this.nodeId = config.nodeId;
    this.peers = config.peers;
    this.majority = config.majority;

    this.currentTerm = 0;
    this.votedFor = null;
    this.log = [];
    this.commitIndex = 0;
    this.lastApplied = 0;

    this.role = "FOLLOWER";
    this.leaderId = null;
    this.nextIndex = {};
    this.matchIndex = {};

    this.electionTimer = null;
    this.heartbeatTimer = null;
    this.pending = new Map();
    this.applyResults = new Map();
    this.started = false;
  }

  async start() {
    const estado = await persistence.cargarEstadoPersistido();
    this.currentTerm = estado.currentTerm;
    this.votedFor = estado.votedFor;
    this.log = estado.log;
    this.commitIndex = estado.commitIndex;
    this.lastApplied = estado.lastApplied;
    this.role = "FOLLOWER";
    this.leaderId = null;
    this.started = true;

    logger.info(
      `Raft start node=${this.nodeId} term=${this.currentTerm} logLen=${this.log.length} commit=${this.commitIndex}`
    );

    await this._aplicarHastaCommit();
    this._resetElectionTimer();
  }

  stop() {
    this._clearElectionTimer();
    this._clearHeartbeatTimer();
    this.started = false;
  }

  status() {
    return {
      nodeId: this.nodeId,
      role: this.role,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      leaderId: this.leaderId,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      lastLogIndex: this._lastLogIndex(),
      lastLogTerm: this._lastLogTerm(),
      logLength: this.log.length,
      peers: this.peers.map((p) => p.nodeId),
      majority: this.majority,
      apiHttp: this.config.apiHttp,
      apiHttps: this.config.apiHttps,
      raftUrl: this.config.raftUrl,
      mongoDb: this.config.mongoDb,
    };
  }

  logSnapshot() {
    return {
      nodeId: this.nodeId,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
      entries: this.log.map((e) => ({
        index: e.index,
        term: e.term,
        commandType: e.command && e.command.type,
        committed: e.index <= this.commitIndex,
        applied: e.index <= this.lastApplied,
      })),
    };
  }

  esLeader() {
    return this.role === "LEADER";
  }

  infoLeader() {
    if (!this.leaderId) {
      return null;
    }
    if (this.leaderId === this.nodeId) {
      return {
        leaderId: this.nodeId,
        apiHttp: this.config.apiHttp,
        apiHttps: this.config.apiHttps,
      };
    }
    const peer = this.peers.find((p) => p.nodeId === this.leaderId);
    if (!peer) {
      return { leaderId: this.leaderId };
    }
    return {
      leaderId: peer.nodeId,
      apiHttp: peer.apiHttp,
      apiHttps: peer.apiHttps,
    };
  }

  /**
   * Propone un comando. Solo el Leader. Resuelve cuando está committed y applied.
   */
  async proponer(command, { timeoutMs = 8000 } = {}) {
    if (!this.esLeader()) {
      const err = new Error("No soy el Leader.");
      err.codigo = "not_leader";
      err.leader = this.infoLeader();
      throw err;
    }

    const entrada = {
      index: this._lastLogIndex() + 1,
      term: this.currentTerm,
      command,
    };
    this.log.push(entrada);
    await persistence.appendEntrada(entrada);
    logger.info(`Raft append local index=${entrada.index} term=${entrada.term} type=${command.type}`);

    const espera = this._esperarAplicacion(entrada.index, timeoutMs);

    await this._replicarATodos();
    this._actualizarCommit();
    await this._aplicarHastaCommit();

    return espera;
  }

  async handleRequestVote(body) {
    const term = Number(body.term);
    const candidateId = body.candidateId;
    const lastLogIndex = Number(body.lastLogIndex) || 0;
    const lastLogTerm = Number(body.lastLogTerm) || 0;

    if (term > this.currentTerm) {
      await this._adoptarTermino(term, null);
    }

    let voteGranted = false;

    if (term < this.currentTerm) {
      voteGranted = false;
    } else if (this.votedFor === null || this.votedFor === candidateId) {
      const upToDate = this._candidatoAlDia(lastLogIndex, lastLogTerm);
      if (upToDate) {
        this.votedFor = candidateId;
        await this._persistirMeta();
        voteGranted = true;
        this._resetElectionTimer();
        logger.info(`Raft voto concedido a ${candidateId} term=${this.currentTerm}`);
      }
    }

    return {
      term: this.currentTerm,
      voteGranted,
      voterId: this.nodeId,
    };
  }

  async handleAppendEntries(body) {
    const term = Number(body.term);
    const leaderId = body.leaderId;
    const prevLogIndex = Number(body.prevLogIndex) || 0;
    const prevLogTerm = Number(body.prevLogTerm) || 0;
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const leaderCommit = Number(body.leaderCommit) || 0;

    if (term < this.currentTerm) {
      return {
        term: this.currentTerm,
        success: false,
        nodeId: this.nodeId,
        matchIndex: this._lastLogIndex(),
      };
    }

    if (term > this.currentTerm || this.role !== "FOLLOWER") {
      await this._adoptarTermino(term, leaderId);
    } else {
      this.leaderId = leaderId;
      if (this.role !== "FOLLOWER") {
        this.role = "FOLLOWER";
        this._clearHeartbeatTimer();
      }
    }

    this._resetElectionTimer();

    if (prevLogIndex > 0) {
      const prev = this._entrada(prevLogIndex);
      if (!prev || prev.term !== prevLogTerm) {
        logger.warn(
          `Raft AppendEntries rechazo: prevLogIndex=${prevLogIndex} prevLogTerm=${prevLogTerm} localTerm=${
            prev ? prev.term : "ausente"
          }`
        );
        return {
          term: this.currentTerm,
          success: false,
          nodeId: this.nodeId,
          matchIndex: this._lastLogIndex(),
        };
      }
    }

    if (entries.length > 0) {
      let truncateFrom = null;
      for (const entrante of entries) {
        const local = this._entrada(entrante.index);
        if (local && local.term !== entrante.term) {
          truncateFrom = entrante.index;
          break;
        }
        if (!local) {
          truncateFrom = entrante.index;
          break;
        }
      }

      if (truncateFrom !== null) {
        this.log = this.log.filter((e) => e.index < truncateFrom);
        const nuevas = entries.filter((e) => e.index >= truncateFrom);
        this.log.push(...nuevas);
        this.log.sort((a, b) => a.index - b.index);
        await persistence.reemplazarLogDesde(truncateFrom, nuevas);
        logger.info(
          `Raft log sync desde index=${truncateFrom} nuevas=${nuevas.length} leader=${leaderId}`
        );
      }
    }

    if (leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(leaderCommit, this._lastLogIndex());
      await this._persistirMeta();
      await this._aplicarHastaCommit();
    }

    return {
      term: this.currentTerm,
      success: true,
      nodeId: this.nodeId,
      matchIndex: this._lastLogIndex(),
    };
  }

  // --- internos ---

  _entrada(index) {
    return this.log.find((e) => e.index === index) || null;
  }

  _lastLogIndex() {
    if (this.log.length === 0) return 0;
    return this.log[this.log.length - 1].index;
  }

  _lastLogTerm() {
    if (this.log.length === 0) return 0;
    return this.log[this.log.length - 1].term;
  }

  _candidatoAlDia(candLastIndex, candLastTerm) {
    const localTerm = this._lastLogTerm();
    const localIndex = this._lastLogIndex();
    if (candLastTerm !== localTerm) {
      return candLastTerm > localTerm;
    }
    return candLastIndex >= localIndex;
  }

  async _persistirMeta() {
    await persistence.guardarMeta({
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      commitIndex: this.commitIndex,
      lastApplied: this.lastApplied,
    });
  }

  async _adoptarTermino(term, leaderId) {
    const terminoCambio = term !== this.currentTerm;
    this.currentTerm = term;
    if (terminoCambio) {
      this.votedFor = null;
    }
    this.role = "FOLLOWER";
    this.leaderId = leaderId;
    this._clearHeartbeatTimer();
    await this._persistirMeta();
    logger.info(
      `Raft adopta term=${term} leader=${leaderId || "?"} role=FOLLOWER`
    );
  }

  _randomElectionTimeout() {
    const min = this.config.electionTimeoutMin;
    const max = this.config.electionTimeoutMax;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  _clearElectionTimer() {
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
  }

  _clearHeartbeatTimer() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  _resetElectionTimer() {
    this._clearElectionTimer();
    if (!this.started || this.role === "LEADER") {
      return;
    }
    const ms = this._randomElectionTimeout();
    this.electionTimer = setTimeout(() => {
      this._iniciarEleccion().catch((err) => {
        logger.error(`Raft elección error: ${err.message}`);
      });
    }, ms);
  }

  async _iniciarEleccion() {
    if (!this.started || this.role === "LEADER") {
      return;
    }

    this.role = "CANDIDATE";
    this.currentTerm += 1;
    this.votedFor = this.nodeId;
    this.leaderId = null;
    await this._persistirMeta();
    logger.info(`Raft elección iniciada term=${this.currentTerm} por ${this.nodeId}`);

    const votes = 1;
    const payload = {
      term: this.currentTerm,
      candidateId: this.nodeId,
      lastLogIndex: this._lastLogIndex(),
      lastLogTerm: this._lastLogTerm(),
    };

    const resultados = await Promise.all(
      this.peers.map(async (peer) => {
        try {
          const res = await rpc.requestVote(peer, payload);
          return res.data || {};
        } catch (err) {
          logger.warn(`Raft RequestVote a ${peer.nodeId} falló: ${err.message}`);
          return {};
        }
      })
    );

    let otorgados = votes;
    for (const r of resultados) {
      if (Number(r.term) > this.currentTerm) {
        await this._adoptarTermino(Number(r.term), null);
        this._resetElectionTimer();
        return;
      }
      if (r.voteGranted) {
        otorgados += 1;
      }
    }

    if (this.role !== "CANDIDATE") {
      return;
    }

    if (otorgados >= this.majority) {
      await this._devenirLeader();
    } else {
      logger.info(
        `Raft sin mayoría term=${this.currentTerm} votos=${otorgados}/${this.config.clusterSize}`
      );
      this.role = "FOLLOWER";
      this._resetElectionTimer();
    }
  }

  async _devenirLeader() {
    this.role = "LEADER";
    this.leaderId = this.nodeId;
    this._clearElectionTimer();

    const last = this._lastLogIndex();
    for (const peer of this.peers) {
      this.nextIndex[peer.nodeId] = last + 1;
      this.matchIndex[peer.nodeId] = 0;
    }

    logger.info(`Raft LEADER electo node=${this.nodeId} term=${this.currentTerm}`);
    await this._replicarATodos();
    this._clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      this._replicarATodos().catch((err) => {
        logger.warn(`Raft heartbeat error: ${err.message}`);
      });
    }, this.config.heartbeatInterval);
  }

  async _replicarATodos() {
    if (!this.esLeader()) {
      return;
    }
    await Promise.all(this.peers.map((peer) => this._replicarA(peer)));
    this._actualizarCommit();
    await this._aplicarHastaCommit();
  }

  async _replicarA(peer) {
    if (!this.esLeader()) {
      return;
    }

    let next = this.nextIndex[peer.nodeId] || 1;

    // Reintentos con decremento si el follower está atrasado / inconsistente.
    for (let intento = 0; intento < 64; intento += 1) {
      if (!this.esLeader()) {
        return;
      }

      const prevLogIndex = next - 1;
      const prev = this._entrada(prevLogIndex);
      const prevLogTerm = prev ? prev.term : 0;
      const entries = this.log.filter((e) => e.index >= next);

      const payload = {
        term: this.currentTerm,
        leaderId: this.nodeId,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: this.commitIndex,
      };

      let data;
      try {
        const res = await rpc.appendEntries(peer, payload);
        data = res.data || {};
      } catch (err) {
        logger.warn(`Raft AppendEntries a ${peer.nodeId} falló: ${err.message}`);
        return;
      }

      if (Number(data.term) > this.currentTerm) {
        await this._adoptarTermino(Number(data.term), null);
        this._resetElectionTimer();
        return;
      }

      if (data.success) {
        const match = Number(data.matchIndex) || this._lastLogIndex();
        this.matchIndex[peer.nodeId] = match;
        this.nextIndex[peer.nodeId] = match + 1;
        return;
      }

      next = Math.max(1, next - 1);
      this.nextIndex[peer.nodeId] = next;
    }
  }

  _actualizarCommit() {
    if (!this.esLeader()) {
      return;
    }

    const indices = [this._lastLogIndex(), ...Object.values(this.matchIndex)];
    const max = Math.max(...indices, 0);

    for (let n = max; n > this.commitIndex; n -= 1) {
      const entrada = this._entrada(n);
      if (!entrada || entrada.term !== this.currentTerm) {
        continue;
      }
      let count = 1; // leader
      for (const peer of this.peers) {
        if ((this.matchIndex[peer.nodeId] || 0) >= n) {
          count += 1;
        }
      }
      if (count >= this.majority) {
        this.commitIndex = n;
        logger.info(`Raft commitIndex=${n} term=${this.currentTerm}`);
        this._persistirMeta().catch((err) => {
          logger.error(`Raft persist meta: ${err.message}`);
        });
        break;
      }
    }
  }

  _esperarAplicacion(index, timeoutMs) {
    if (this.applyResults.has(index)) {
      const resultado = this.applyResults.get(index);
      this.applyResults.delete(index);
      return Promise.resolve(resultado);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(index);
        const err = new Error(`Timeout esperando commit/apply de index=${index}`);
        err.codigo = "raft_timeout";
        reject(err);
      }, timeoutMs);

      this.pending.set(index, {
        resolve: (valor) => {
          clearTimeout(timer);
          resolve(valor);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  async _aplicarHastaCommit() {
    while (this.lastApplied < this.commitIndex) {
      const siguiente = this.lastApplied + 1;
      const entrada = this._entrada(siguiente);
      if (!entrada) {
        logger.error(`Raft hueco en log al aplicar index=${siguiente}`);
        break;
      }

      let resultado;
      try {
        resultado = await aplicarComando(entrada.command);
      } catch (err) {
        const { interpretarErrorPersistencia } = require("../utils/errores");
        const interpretado = interpretarErrorPersistencia(err);
        if (interpretado) {
          resultado = {
            ok: false,
            status: interpretado.status,
            body: {
              error: interpretado.error,
              detalles: interpretado.detalles,
            },
          };
        } else {
          logger.error(`SM error index=${siguiente}: ${err.message}`);
          resultado = {
            ok: false,
            status: 500,
            body: { error: "Error interno del servidor." },
          };
        }
      }

      this.lastApplied = siguiente;
      await this._persistirMeta();
      logger.info(
        `Raft applied index=${siguiente} type=${entrada.command.type} status=${resultado.status}`
      );

      if (this.pending.has(siguiente)) {
        this.pending.get(siguiente).resolve(resultado);
        this.pending.delete(siguiente);
      } else {
        this.applyResults.set(siguiente, resultado);
      }
    }
  }
}

module.exports = { RaftNode };

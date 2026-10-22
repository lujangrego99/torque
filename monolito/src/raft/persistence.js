const mongoose = require("mongoose");

const metaSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "raft" },
    currentTerm: { type: Number, default: 0 },
    votedFor: { type: String, default: null },
    commitIndex: { type: Number, default: 0 },
    lastApplied: { type: Number, default: 0 },
  },
  { collection: "raft_meta" }
);

const logSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true, unique: true },
    term: { type: Number, required: true },
    command: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { collection: "raft_log" }
);

const RaftMeta = mongoose.models.RaftMeta || mongoose.model("RaftMeta", metaSchema);
const RaftLog = mongoose.models.RaftLog || mongoose.model("RaftLog", logSchema);

async function cargarEstadoPersistido() {
  let meta = await RaftMeta.findById("raft");
  if (!meta) {
    meta = await RaftMeta.create({
      _id: "raft",
      currentTerm: 0,
      votedFor: null,
      commitIndex: 0,
      lastApplied: 0,
    });
  }

  const entradas = await RaftLog.find().sort({ index: 1 }).lean();
  return {
    currentTerm: meta.currentTerm,
    votedFor: meta.votedFor,
    commitIndex: meta.commitIndex,
    lastApplied: meta.lastApplied,
    log: entradas.map((e) => ({
      index: e.index,
      term: e.term,
      command: e.command,
    })),
  };
}

async function guardarMeta({ currentTerm, votedFor, commitIndex, lastApplied }) {
  await RaftMeta.findByIdAndUpdate(
    "raft",
    {
      currentTerm,
      votedFor,
      commitIndex,
      lastApplied,
    },
    { upsert: true, new: true }
  );
}

async function reemplazarLogDesde(indexInclusive, entradas) {
  await RaftLog.deleteMany({ index: { $gte: indexInclusive } });
  if (entradas.length === 0) {
    return;
  }
  await RaftLog.insertMany(
    entradas.map((e) => ({
      index: e.index,
      term: e.term,
      command: e.command,
    })),
    { ordered: true }
  );
}

async function appendEntrada(entrada) {
  await RaftLog.create({
    index: entrada.index,
    term: entrada.term,
    command: entrada.command,
  });
}

module.exports = {
  cargarEstadoPersistido,
  guardarMeta,
  reemplazarLogDesde,
  appendEntrada,
};

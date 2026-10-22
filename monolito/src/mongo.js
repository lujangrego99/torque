const mongoose = require("mongoose");
const logger = require("./logger");

function uriMongo() {
  return process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/taller";
}

function redactarUri(uri) {
  return String(uri).replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
}

async function conectar() {
  mongoose.set("strictQuery", true);

  mongoose.connection.on("error", (err) => {
    logger.error(`MongoDB: ${err.message}`);
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB desconectado.");
  });

  await mongoose.connect(uriMongo());
  logger.info(`MongoDB conectado en ${redactarUri(uriMongo())} (db=${mongoose.connection.name})`);
  return mongoose.connection;
}

async function desconectar() {
  await mongoose.disconnect();
}

module.exports = {
  conectar,
  desconectar,
  uriMongo,
  redactarUri,
};

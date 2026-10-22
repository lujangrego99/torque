const Vehiculo = require("../models/vehiculo");
const Repuesto = require("../models/repuesto");
const logger = require("../logger");
const { serializarVehiculo, serializarRepuesto } = require("../utils/serializar");

/**
 * Aplica un comando committed al estado de negocio local.
 * Los identificadores y valores no determinísticos ya vienen fijados en el comando
 * (generados una sola vez en el Leader).
 */
async function aplicarComando(command) {
  switch (command.type) {
    case "vehiculo.create": {
      const doc = await Vehiculo.create({
        _id: command.payload._id,
        marca: command.payload.marca,
        modelo: command.payload.modelo,
        anio: command.payload.anio,
        patente: command.payload.patente,
        kilometraje: command.payload.kilometraje,
      });
      logger.info(`SM apply vehiculo.create id=${doc._id}`);
      return { ok: true, status: 201, body: serializarVehiculo(doc) };
    }
    case "vehiculo.update": {
      const doc = await Vehiculo.findById(command.payload._id);
      if (!doc) {
        return {
          ok: false,
          status: 404,
          body: { error: "Vehículo no encontrado." },
        };
      }
      doc.set({
        marca: command.payload.marca,
        modelo: command.payload.modelo,
        anio: command.payload.anio,
        patente: command.payload.patente,
        kilometraje: command.payload.kilometraje,
      });
      const actualizado = await doc.save();
      logger.info(`SM apply vehiculo.update id=${actualizado._id}`);
      return { ok: true, status: 200, body: serializarVehiculo(actualizado) };
    }
    case "vehiculo.delete": {
      const eliminado = await Vehiculo.findByIdAndDelete(command.payload._id);
      if (!eliminado) {
        return {
          ok: false,
          status: 404,
          body: { error: "Vehículo no encontrado." },
        };
      }
      logger.info(`SM apply vehiculo.delete id=${command.payload._id}`);
      return { ok: true, status: 204, body: null };
    }
    case "repuesto.descontar": {
      const existente = await Repuesto.findById(command.payload._id);
      if (!existente) {
        return {
          ok: false,
          status: 404,
          body: { error: "Repuesto no encontrado." },
        };
      }
      if (existente.stock < command.payload.cantidad) {
        return {
          ok: false,
          status: 409,
          body: {
            error: "Stock insuficiente.",
            item: serializarRepuesto(existente),
          },
        };
      }
      const actualizado = await Repuesto.findByIdAndUpdate(
        command.payload._id,
        { $inc: { stock: -command.payload.cantidad } },
        { new: true }
      );
      logger.info(
        `SM apply repuesto.descontar id=${actualizado._id} stock=${actualizado.stock}`
      );
      return {
        ok: true,
        status: 200,
        body: {
          mensaje: "Stock descontado.",
          item: serializarRepuesto(actualizado),
          proteccion: true,
          via: "redis+raft",
        },
      };
    }
    default:
      logger.warn(`SM comando desconocido: ${command.type}`);
      return {
        ok: false,
        status: 500,
        body: { error: `Comando desconocido: ${command.type}` },
      };
  }
}

module.exports = { aplicarComando };

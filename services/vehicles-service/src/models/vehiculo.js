const mongoose = require("mongoose");

const ANIO_MINIMO = 1900;
const TELEFONO = /^(?=(?:\D*\d){6})[0-9+()\s-]{6,20}$/;

function anioMaximo() {
  return new Date().getFullYear() + 1;
}

function esEntero(valor) {
  return Number.isInteger(valor);
}

const vehiculoSchema = new mongoose.Schema(
  {
    marca: {
      type: String,
      required: [true, "El campo marca es obligatorio y no puede estar vacío."],
      trim: true,
      minlength: [1, "El campo marca es obligatorio y no puede estar vacío."],
      maxlength: [60, "El campo marca no puede superar 60 caracteres."],
    },
    modelo: {
      type: String,
      required: [true, "El campo modelo es obligatorio y no puede estar vacío."],
      trim: true,
      minlength: [1, "El campo modelo es obligatorio y no puede estar vacío."],
      maxlength: [60, "El campo modelo no puede superar 60 caracteres."],
    },
    anio: {
      type: Number,
      required: [true, "El campo anio es obligatorio y debe ser un entero."],
      validate: [
        {
          validator: esEntero,
          message: "El campo anio es obligatorio y debe ser un entero.",
        },
        {
          validator(valor) {
            return valor >= ANIO_MINIMO && valor <= anioMaximo();
          },
          message: `El campo anio debe ser un entero entre ${ANIO_MINIMO} y el año próximo.`,
        },
      ],
    },
    patente: {
      type: String,
      required: [true, "El campo patente es obligatorio y no puede estar vacío."],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: [6, "La patente debe tener entre 6 y 8 caracteres alfanuméricos."],
      maxlength: [8, "La patente debe tener entre 6 y 8 caracteres alfanuméricos."],
      match: [/^[A-Z0-9]{6,8}$/, "La patente debe tener entre 6 y 8 caracteres alfanuméricos."],
    },
    kilometraje: {
      type: Number,
      required: [true, "El campo kilometraje es obligatorio y debe ser un entero mayor o igual a 0."],
      min: [0, "El campo kilometraje es obligatorio y debe ser un entero mayor o igual a 0."],
      validate: {
        validator: esEntero,
        message: "El campo kilometraje es obligatorio y debe ser un entero mayor o igual a 0.",
      },
    },
    // Dueño del auto (requisito 4): para avisarle cuando el auto está listo.
    duenio: {
      type: new mongoose.Schema(
        {
          nombre: {
            type: String,
            required: [true, "El nombre del dueño es obligatorio."],
            trim: true,
            minlength: [2, "El nombre del dueño debe tener entre 2 y 80 caracteres."],
            maxlength: [80, "El nombre del dueño debe tener entre 2 y 80 caracteres."],
          },
          telefono: {
            type: String,
            required: [true, "El teléfono del dueño es obligatorio."],
            trim: true,
            match: [TELEFONO, "El teléfono del dueño debe tener entre 6 y 20 caracteres (dígitos, espacios, +, -, paréntesis)."],
          },
        },
        { _id: false }
      ),
      required: [true, "Los datos del dueño (duenio.nombre y duenio.telefono) son obligatorios."],
    },
    // Baja LÓGICA: el auto no se borra (sus órdenes siguen apuntando a él y se
    // conserva el historial). Inactivo = no se le pueden crear órdenes nuevas.
    activo: { type: Boolean, default: true, index: true },
    baja: {
      fecha: Date,
      por: String,
      motivo: String,
    },
  },
  { versionKey: false, timestamps: { createdAt: "creadoEn", updatedAt: "actualizadoEn" } }
);

module.exports = mongoose.model("Vehiculo", vehiculoSchema);
module.exports.ANIO_MINIMO = ANIO_MINIMO;
module.exports.anioMaximo = anioMaximo;

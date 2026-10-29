const mongoose = require("mongoose");

const ANIO_MINIMO = 1900;

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
  },
  { versionKey: false }
);

module.exports = mongoose.model("Vehiculo", vehiculoSchema);
module.exports.ANIO_MINIMO = ANIO_MINIMO;
module.exports.anioMaximo = anioMaximo;

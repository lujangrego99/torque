const mongoose = require("mongoose");

const repuestoSchema = new mongoose.Schema(
  {
    nombre: {
      type: String,
      required: [true, "El campo nombre es obligatorio y no puede estar vacío."],
      trim: true,
      minlength: [1, "El campo nombre es obligatorio y no puede estar vacío."],
      maxlength: [80, "El campo nombre no puede superar 80 caracteres."],
    },
    codigo: {
      type: String,
      required: [true, "El campo codigo es obligatorio y no puede estar vacío."],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9-]{5,20}$/, "El codigo debe tener entre 5 y 20 caracteres (A-Z, 0-9 o guion)."],
    },
    stock: {
      type: Number,
      required: [true, "El campo stock es obligatorio y debe ser un entero."],
      validate: {
        validator: Number.isInteger,
        message: "El campo stock es obligatorio y debe ser un entero.",
      },
    },
  },
  { versionKey: false }
);

module.exports = mongoose.model("Repuesto", repuestoSchema);

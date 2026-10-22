function parsearObjectId(valor) {
  if (!/^[a-fA-F0-9]{24}$/.test(String(valor))) {
    return null;
  }
  return String(valor);
}

function esObjetoJson(body) {
  return body !== undefined && body !== null && typeof body === "object" && !Array.isArray(body);
}

module.exports = {
  parsearObjectId,
  esObjetoJson,
};

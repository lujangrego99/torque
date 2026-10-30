function parsearObjectId(valor) {
  return /^[a-fA-F0-9]{24}$/.test(String(valor)) ? String(valor) : null;
}

function esObjetoJson(body) {
  return body !== undefined && body !== null && typeof body === "object" && !Array.isArray(body);
}

module.exports = { parsearObjectId, esObjetoJson };

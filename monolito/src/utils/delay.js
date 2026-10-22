function esperar(ms) {
  const duracion = Number(ms);
  if (!Number.isFinite(duracion) || duracion <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, duracion);
  });
}

module.exports = { esperar };

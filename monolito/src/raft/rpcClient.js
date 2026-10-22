async function postJson(url, body, timeoutMs = 800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function requestVote(peer, payload) {
  return postJson(`${peer.raftUrl}/raft/request-vote`, payload);
}

async function appendEntries(peer, payload) {
  return postJson(`${peer.raftUrl}/raft/append-entries`, payload);
}

module.exports = {
  requestVote,
  appendEntries,
};

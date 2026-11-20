// Sets up the fictional FMV picture (fmv.jpg) in a running emcc (M8 or later, no login): one link of
// the fmv plugin that listens on loopback for a STANAG 4609 stream (Settings > FMV).
//
//   node fmv-scene.mjs [base-url] [port]       (default http://127.0.0.1:18103 and 15609)
//
// The stream itself is our own: spike S10's LiveSender (spikes/s10-uav-fmv/java, run unchanged)
// renders a camera flying fmv/route.json over a texture that fmv/FmvTexture.java draws from the
// public-domain Sundsvall height data, and sends H.264 with ST 0601 KLV to that port
// (marketing/README.md, "The FMV picture"). No recording and no imagery is used.
const BASE = process.argv[2] ?? "http://127.0.0.1:18103";
const PORT = Number(process.argv[3] ?? 15609);

async function call(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const settings = (await call("GET", "/api/settings/plugins/fmv")).values;
settings.links = [{ name: "Demo UAV", enabled: true, mode: "udp", address: "127.0.0.1", port: PORT, cameraIdentity: "friend" }];
await call("PUT", "/api/settings/plugins/fmv", settings);
console.log(`fmv link "Demo UAV" listens on 127.0.0.1:${PORT}`);

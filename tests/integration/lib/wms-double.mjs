// The ITA's WMS test double (ADR-0035, T-074): a small WMS server on 127.0.0.1 for basemap-wms.
// It answers GetCapabilities in WMS 1.3.0 or 1.1.1 and GetMap with a PNG of one colour, the colour of
// the top-most layer asked for (the last in LAYERS), so a test can tell from the map's pixels which
// background is drawn and in which order its layers came. Every request is recorded with its
// parameters, names in upper case (WMS names ignore case).
//
// The layers (no projection on the root, so that each one's are its own and its parents'):
//   ita:land   "Land"   EPSG:3857, EPSG:4326
//   ita:roads  "Roads"  EPSG:3857
//   ita:polar  "Polar"  EPSG:3031, and EPSG:3413 from its parent layer "Polar group"
//
// `doctype`: none; 'bare', a DOCTYPE without an internal subset whose DTD address is this double's
// own /dtd/ path, as GeoServer's WMS 1.1.1 capabilities have (owner, EX), so that a test can check
// the DTD is never fetched; 'internal', a DOCTYPE with an internal subset and an entity, which the
// plugin must refuse. `refuseConnections()` closes the open connections and resets every new one
// while the port stays taken (a server that went away). Nothing is fetched from anywhere.
import { createServer } from 'node:http';
import { solidPng } from './fake-tiles.mjs';

/** The layers' colours (RGB), unlike the fake tiles', Natural Earth's and the symbols'. */
export const WMS_COLOURS = { 'ita:land': [150, 0, 200], 'ita:roads': [0, 150, 150], 'ita:polar': [240, 150, 0] };

/** The GetMap parameters the plugin's server part sends, each once (basemap-wms brief, function 2). */
export const GETMAP_PARAMETERS = ['SERVICE', 'VERSION', 'REQUEST', 'LAYERS', 'STYLES', 'FORMAT', 'TRANSPARENT', 'BBOX', 'WIDTH', 'HEIGHT'];

/** Starts a double on a free port. `version`: '1.3.0' (default) or '1.1.1'; `doctype` as above. */
export function startWmsDouble({ version = '1.3.0', doctype = 'none' } = {}) {
  const requests = [];
  let refusing = false;
  const refused = { count: 0 };
  let base = '';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const params = new Map();
    const names = [];
    for (const [name, value] of url.searchParams) {
      names.push(name);
      params.set(name.toUpperCase(), value);
    }
    const request = { at: Date.now(), path: url.pathname, query: url.search, names, params };
    requests.push(request);
    if (url.pathname.startsWith('/dtd/')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const kind = (params.get('REQUEST') ?? '').toLowerCase();
    if (kind === 'getcapabilities') {
      res.writeHead(200, { 'Content-Type': version === '1.3.0' ? 'text/xml' : 'application/vnd.ogc.wms_xml' });
      res.end(capabilities(version, doctype, base));
    } else if (kind === 'getmap') {
      const layers = (params.get('LAYERS') ?? '').split(',');
      const colour = WMS_COLOURS[layers.at(-1)];
      const width = Number(params.get('WIDTH'));
      const height = Number(params.get('HEIGHT'));
      if (colour === undefined || !(width >= 1 && width <= 4096 && height >= 1 && height <= 4096)) {
        res.writeHead(200, { 'Content-Type': 'application/vnd.ogc.se_xml' });
        res.end(`<?xml version="1.0"?><ServiceExceptionReport version="${version}"><ServiceException>bad request</ServiceException></ServiceExceptionReport>`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(solidPng(width, height, colour));
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('unknown request');
    }
  });
  server.on('connection', (socket) => {
    if (refusing) {
      refused.count++;
      socket.resetAndDestroy();
    }
  });
  return new Promise((resolveStart) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolveStart({
        /** The address for WMS requests, as an admin enters it. */
        url: `${base}/wms`,
        requests,
        /** The GetMap requests so far. */
        getMaps: () => requests.filter((r) => (r.params.get('REQUEST') ?? '').toLowerCase() === 'getmap'),
        /** The GetCapabilities requests so far. */
        capabilityReads: () => requests.filter((r) => (r.params.get('REQUEST') ?? '').toLowerCase() === 'getcapabilities'),
        /** Requests for the DTD (never expected). */
        dtdReads: () => requests.filter((r) => r.path.startsWith('/dtd/')),
        refuseConnections: () => {
          refusing = true;
          server.closeAllConnections(); // also the callers' open keep-alive connections
        },
        refused,
        close: () =>
          new Promise((resolveClose) => {
            server.closeAllConnections();
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

function capabilities(version, doctype, base) {
  const v13 = version === '1.3.0';
  const crs = (codes) => codes.map((c) => (v13 ? `<CRS>${c}</CRS>` : `<SRS>${c}</SRS>`)).join('');
  const root = v13 ? 'WMS_Capabilities' : 'WMT_MS_Capabilities';
  const head =
    doctype === 'bare'
      ? `<!DOCTYPE ${root} SYSTEM "${base}/dtd/WMS_MS_Capabilities.dtd">\n`
      : doctype === 'internal'
        ? `<!DOCTYPE ${root} [<!ENTITY ita "Injected">]>\n`
        : '';
  const title = doctype === 'internal' ? '&ita;' : 'ITA WMS double';
  const online = `<OnlineResource xmlns:xlink="http://www.w3.org/1999/xlink" xlink:type="simple" xlink:href="${base}/wms"/>`;
  const dcp = `<DCPType><HTTP><Get>${online}</Get></HTTP></DCPType>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
${head}<${root} version="${version}"${v13 ? ' xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink"' : ''}>
  <Service><Name>${v13 ? 'WMS' : 'OGC:WMS'}</Name><Title>${title}</Title>${online}</Service>
  <Capability>
    <Request>
      <GetCapabilities><Format>${v13 ? 'text/xml' : 'application/vnd.ogc.wms_xml'}</Format>${dcp}</GetCapabilities>
      <GetMap><Format>image/png</Format><Format>image/jpeg</Format>${dcp}</GetMap>
    </Request>
    <Exception><Format>${v13 ? 'XML' : 'application/vnd.ogc.se_xml'}</Format></Exception>
    <Layer>
      <Title>ITA root</Title>
      <Layer queryable="0"><Name>ita:land</Name><Title>Land</Title>${crs(['EPSG:3857', 'EPSG:4326'])}</Layer>
      <Layer queryable="0"><Name>ita:roads</Name><Title>Roads</Title>${crs(['EPSG:3857'])}</Layer>
      <Layer>
        <Title>Polar group</Title>${crs(['EPSG:3413'])}
        <Layer queryable="0"><Name>ita:polar</Name><Title>Polar</Title>${crs(['EPSG:3031'])}</Layer>
      </Layer>
    </Layer>
  </Capability>
</${root}>
`;
}

// A test-only plugin of the ITA (tests/integration/README.md, "Test probe"). Never installed
// outside the integration tests. It gets services through the SDK, as any plugin does, and hands
// them to the browser test as window.__itaProbe, so a test can call the real SymbolService and
// MapView. Plain JavaScript, no build and no imports: the service keys are the SDK's ids.
const SYMBOLS = { id: 'emc2.symbols', cardinality: 'one' };
const MAP_VIEW = { id: 'emc2.map-view', cardinality: 'one' };

export default {
  async activate(ctx) {
    const [symbols, mapView] = await Promise.all([ctx.services.get(SYMBOLS), ctx.services.get(MAP_VIEW)]);
    window.__itaProbe = { symbols, mapView };
    ctx.status.set('OK', 'ITA test probe');
  },
};

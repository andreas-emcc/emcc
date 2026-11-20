import { boot } from './boot.tsx';
import { withSessionHeader } from './time/temporal.ts';
import { withoutLoginReturn } from './ui/tabs.ts';
import '@emc2/plugin-sdk/components.css';
import './tokens.css';
import './shell.css';
import './shell-look.css'; // right after shell.css (T-199)

const root = document.getElementById('root');
if (!root) {
  throw new Error('Element #root is missing from index.html');
}

const search = withoutLoginReturn(window.location.search);
if (search !== null) {
  window.history.replaceState(window.history.state, '', window.location.pathname + search + window.location.hash);
}

const shell = boot({ rootElement: root, loadPluginWebParts: !import.meta.env.DEV });
// SDK 1.4.0 (owner, 2026-11-06): requests to the plugins' endpoints name the page's live session,
// so that they carry the page's time (EndpointRequest.userTime()); the web parts' own fetch included.
window.fetch = withSessionHeader(window.fetch.bind(window), () => shell.connection.session, window.location.origin);

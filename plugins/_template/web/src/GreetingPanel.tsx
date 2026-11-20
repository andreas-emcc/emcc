import { useState } from 'react';
import { Button, Notice, PanelFrame } from '@emc2/plugin-sdk';

/**
 * A panel: the greeting from the settings, and the one from the plugin's own server part. Built from the
 * SDK's shared components (ADR-0029). The shell's head shows its title, so the frame draws none
 * (SDK 1.8.0, heading={false}); the title stays the section's accessible name.
 */
export function GreetingPanel(props: { readonly greeting: string; readonly serverBase: string }) {
  const [fromServer, setFromServer] = useState<string | null>(null);

  const ask = async () => {
    // Only the emc2 server is reachable from the browser (ADR-0030); serverBase is /api/plugins/<id>/.
    const response = await fetch(`${props.serverBase}greeting`);
    setFromServer(response.ok ? await response.text() : `Server answered ${String(response.status)}`);
  };

  return (
    <PanelFrame title="Template" heading={false}>
      <div className="template-content">
        <p>{props.greeting}</p>
        <Button onClick={() => void ask()}>Ask the server</Button>
        {fromServer !== null && <Notice>{fromServer}</Notice>}
      </div>
    </PanelFrame>
  );
}

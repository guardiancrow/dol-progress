import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RecoveryScreen } from "./RecoveryScreen";
import { dataRootService, type StartupPresentation } from "./dataRoot/service";

function StartupApp() {
  const [startup, setStartup] = useState<StartupPresentation>();
  const [error, setError] = useState<string>();
  useEffect(() => { void dataRootService.status().then(setStartup).catch((cause: unknown) => setError(String(cause))); }, []);
  if (error) return <main className="recovery-screen"><section className="state-panel"><h2>起動状態を確認できません。</h2><p>{error}</p></section></main>;
  if (!startup) return <main className="recovery-screen"><section className="state-panel"><p>データ保存場所を確認しています...</p></section></main>;
  if (startup.kind === "recovery") return <RecoveryScreen info={startup} />;
  return <App dataRootInfo={startup} />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <StartupApp />
  </React.StrictMode>,
);

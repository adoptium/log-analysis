import { useEffect, useState } from "react";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Rules from "./pages/Rules";
import Investigate from "./pages/Investigate";
import Placeholder from "./pages/Placeholder";
import { AnalysisProvider } from "./state/analysis";

// ─────────────────────────────────────────────────────────────
// Lightweight hash router (no dependency). Routes:
//   #/dashboard   → Log overview   (this app)
//   #/rules       → Rules          (this app)
//   #/investigate → Investigate    (this app)
//   #/query       → placeholder    (deferred)
// ─────────────────────────────────────────────────────────────

function parseRoute(): string {
  const r = window.location.hash.replace(/^#\/?/, "").trim();
  return r || "dashboard";
}

export default function App() {
  const [route, setRoute] = useState(parseRoute);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  let page;
  switch (route) {
    case "rules":
      page = <Rules />;
      break;
    case "investigate":
      page = <Investigate />;
      break;
    case "query":
      page = <Placeholder title="Query" note="Coming soon!" />;
      break;
    case "dashboard":
    default:
      page = <Dashboard />;
      break;
  }

  return (
    <AnalysisProvider>
      <Layout route={route}>{page}</Layout>
    </AnalysisProvider>
  );
}

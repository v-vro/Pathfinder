import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import Landing from "./pages/landing/Landing";
import NotFound from "./pages/NotFound";

// Tool pages load on demand so their code never weighs down the landing page.
const Planner = lazy(() => import("./pages/Planner"));
const Hologram = lazy(() => import("./pages/Hologram"));

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Landing />} />
          <Route
            path="planner"
            element={
              <Suspense fallback={null}>
                <Planner />
              </Suspense>
            }
          />
          <Route
            path="hologram"
            element={
              <Suspense fallback={null}>
                <Hologram />
              </Suspense>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

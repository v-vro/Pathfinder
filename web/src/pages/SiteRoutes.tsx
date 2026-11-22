import { Route, Routes } from "react-router-dom";
import { Layout } from "../components/Layout";
import Landing from "./landing/Landing";
import NotFound from "./NotFound";

/** Everything except /planner: the landing page and a 404, inside the site layout. */
export default function SiteRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

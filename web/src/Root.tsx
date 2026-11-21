import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

// Each route loads only its own code and CSS. The planner is unchanged; the site links to
// it with a full page load, so it still mounts exactly once per page load.
const App = lazy(() => import('./App.tsx'))
const SiteRoutes = lazy(() => import('./pages/SiteRoutes.tsx'))

export default function Root() {
  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/planner" element={<App />} />
          <Route path="/*" element={<SiteRoutes />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

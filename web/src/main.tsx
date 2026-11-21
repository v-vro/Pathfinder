import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'

// No StrictMode: the 3D viewer owns a WebGL context and must mount exactly once.
createRoot(document.getElementById('root')!).render(<Root />)

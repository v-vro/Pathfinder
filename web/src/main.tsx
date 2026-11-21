import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: the 3D viewer owns a WebGL context and must mount exactly once.
createRoot(document.getElementById('root')!).render(<App />)

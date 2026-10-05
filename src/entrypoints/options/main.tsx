import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@/lib/ui/theme.css';
import './style.css';

createRoot(document.getElementById('root')!).render(<App />);

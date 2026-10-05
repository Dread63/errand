import { createRoot } from 'react-dom/client';
import '@/lib/ui/theme.css';
import { App } from './App';
import './style.css';

createRoot(document.getElementById('root')!).render(<App />);

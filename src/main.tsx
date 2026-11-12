import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installVercelApiFetchBridge } from './utils/authClient';

installVercelApiFetchBridge();

createRoot(document.getElementById('root')!).render(<App />);

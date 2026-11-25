import { createRoot } from 'react-dom/client';
import { Bench, readOptions } from './Bench.tsx';

const options = readOptions(new URLSearchParams(location.search));
// No StrictMode: its double mount would create a second WebGL context, and the bench must measure exactly one.
createRoot(document.getElementById('root')!).render(<Bench options={options} />);

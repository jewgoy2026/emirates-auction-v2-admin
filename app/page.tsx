import { Suspense } from 'react';
import Shell from './ui/shell';
export default function Page(){return <Suspense fallback={<p>Carregando painel…</p>}><Shell/></Suspense>;}

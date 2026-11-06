import type { Metadata } from 'next';
import './reset.css';
import './lab.css';
export const metadata:Metadata={title:'Emirates Auction · Administration',description:'Painel administrativo da Emirates Auction v2.',robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body style={{margin:0,fontFamily:'Arial, Helvetica, sans-serif'}}>{children}</body></html>;}

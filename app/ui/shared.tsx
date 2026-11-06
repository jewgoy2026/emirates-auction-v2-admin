'use client';

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type { Dashboard, User } from '../../lib/v2';

export type AdminState = {
  user: User | null;
  dashboard: Dashboard | null;
  loading: boolean;
  busy: boolean;
  path: string[];
  refresh: () => Promise<void>;
  run: <T = any>(path: string, options?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, message?: string) => Promise<T | null>;
  flash: (message: string, error?: boolean) => void;
};

export const Context = createContext<AdminState | null>(null);
export const useAdmin = () => { const value = useContext(Context); if (!value) throw new Error('Admin context is unavailable.'); return value; };
export const url = (path = '') => `/?view=${encodeURIComponent(path || 'painel')}`;

export const statusLabels: Record<string, string> = {
  mirrored: 'Espelhado', draft: 'Rascunho', scheduled: 'Agendado', open: 'Em andamento', paused: 'Suspenso', ended: 'Aguardando decisão', pending: 'Aguardando pagamento', sold: 'Concluído', cancelled: 'Cancelado', archived: 'Arquivado', active: 'Ativa', inactive: 'Inativa', requested: 'Solicitado', approved: 'Aprovado', rejected: 'Recusado', outstanding: 'Em aberto', paid: 'Pago', confirming: 'Confirmando', confirmed: 'Confirmado', underpaid: 'Valor insuficiente', expired: 'Expirado', failed: 'Falhou', broadcast: 'Transmitido', completed: 'Concluído', manual: 'Manual', auto: 'Automático',
};

export function Badge({ value }: { value: string }) { return <span className={`lab-badge ${value}`}>{statusLabels[value] ?? value}</span>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="lab-empty"><Icon name="box" size={32}/><p>{children}</p></div>; }
export function Section({ title, eyebrow, actions }: { title: string; eyebrow?: string; actions?: ReactNode }) { return <div className="lab-section-head"><div>{eyebrow && <span className="lab-eyebrow">{eyebrow}</span>}<h1>{title}</h1></div>{actions}</div>; }
export function Metric({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) { return <div className="lab-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
export function Table({ headers, children }: { headers: string[]; children: ReactNode }) { return <div className="lab-table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="lab-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog className="lab-dialog" ref={ref} aria-label={title} onCancel={onClose}><div className="lab-modal-head"><h2>{title}</h2><button className="lab-icon-button" type="button" aria-label="Fechar" onClick={onClose}><Icon name="close"/></button></div>{children}</dialog>;
}

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>, user: <><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></>, grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>, hammer: <><path d="m13 3 8 8-4 4-8-8zM11 13 3 21M3 22h12"/><path d="m7 7 3-3m7 13 3-3"/></>, wallet: <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 6V3h15v3m3 5h-6v5h6"/></>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>, box: <><path d="m3 7 9-4 9 4v12l-9 3-9-3zM3 7l9 4 9-4M12 11v11M7 5l9 4"/></>, plus: <path d="M12 4v16M4 12h16"/>, close: <path d="m5 5 14 14M5 19 19 5"/>, bell: <><path d="M5 17V9a7 7 0 0 1 14 0v8l2 2H3zM9 22h6"/></>, check: <path d="m4 12 5 5L20 6"/>, category: <><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z"/></>, users: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-6a5 5 0 0 1 5 5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.box}</svg>;
}

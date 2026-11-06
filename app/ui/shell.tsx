'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Admin from './admin';
import { Context, Field, Icon, url } from './shared';
import { api, normalizeDashboard, type Dashboard, type User } from '../../lib/v2';

type Toast = { message: string; error: boolean };

export default function Shell() {
  const params = useSearchParams();
  const path = (params.get('view') ?? 'painel').split('/');
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(false);

  const flash = useCallback((message: string, error = false) => {
    setToast({ message, error });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const session = await api<{ user: { id: string; email: string; name: string; phone: string; role: 'admin' | 'bidder' } }>('/v1/auth/me');
      const current: User = { ...session.user, phone: session.user.phone ?? '', status: 'active', createdAt: 0, wallet: { balance: 0, reserved: 0, available: 0 } };
      setUser(current);
      if (current.role === 'admin') setDashboard(normalizeDashboard(await api('/v1/auction/admin/dashboard')));
      else setDashboard(null);
    } catch {
      setUser(null);
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => { if (!document.hidden && !active.current) void refresh(); }, 15_000);
    return () => { clearInterval(poll); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [refresh]);

  const run = useCallback(async <T,>(endpoint: string, options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown } = {}, message = 'Alteração salva.') => {
    if (active.current) return null;
    active.current = true; setBusy(true);
    try {
      const result = await api<T>(endpoint, options);
      await refresh();
      if (message) flash(message);
      return result;
    } catch (error) {
      flash((error as Error).message, true);
      return null;
    } finally {
      active.current = false; setBusy(false);
    }
  }, [flash, refresh]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api('/v1/auth/login', { method: 'POST', body: { email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') } });
      await refresh();
      flash('Sessão administrativa iniciada.');
    } catch (error) {
      flash((error as Error).message, true);
    } finally { setBusy(false); }
  }

  async function logout() {
    await run('/v1/auth/logout', { method: 'POST', body: {} }, 'Sessão encerrada.');
    setUser(null); setDashboard(null);
  }

  return <Context.Provider value={{ user, dashboard, loading, busy, path, refresh, run, flash }}>
    <div className="lab">
      <div className="lab-environment"><span><b>EMIRATES AUCTION V2</b> · Administration</span><span>AED reference · crypto settlement</span></div>
      <header className="lab-header"><div className="lab-width lab-topbar">
        <Link href={url()} className="lab-brand"><img src="/emirates-auction-logo.svg" width="86" height="65" alt="Emirates Auction"/><span className="lab-brand-label">ADMIN</span></Link>
        <nav><Link className="active" href={url()}>Administration</Link></nav>
        {user && <button className="lab-profile" onClick={logout} disabled={busy}><Icon name="user"/><span>{user.name}</span> · Sair</button>}
      </div></header>
      <main className="lab-width lab-main">
        {loading && !user ? <p>Carregando sessão…</p> : user ? <Admin/> : <div className="lab-login">
          <span className="lab-eyebrow">PAINEL ADMINISTRATIVO</span><h1>Gerencie toda a operação do leilão.</h1>
          <p>Catálogo, categorias, regras de caução, lances, vencedores, pagamentos, saques e auditoria.</p>
          <form className="lab-panel" style={{ maxWidth: 530, margin: '30px auto', textAlign: 'left' }} onSubmit={login}>
            <h2>Entrar</h2>
            <Field label="E-mail"><input name="email" type="email" autoComplete="username" required/></Field>
            <Field label="Senha"><input name="password" type="password" autoComplete="current-password" required/></Field>
            <button className="lab-button full" disabled={busy}>{busy ? 'Entrando…' : 'Acessar painel'}</button>
          </form>
          <p className="lab-fine">Acesso restrito a administradores. Todas as alterações são auditadas.</p>
        </div>}
      </main>
      <footer className="lab-width lab-footer"><span>EMIRATES AUCTION · ADMINISTRATION</span><span>Version 2</span></footer>
      {toast && <div className={`lab-toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><Icon name={toast.error ? 'close' : 'check'}/><span>{toast.message}</span><button aria-label="Fechar mensagem" onClick={() => setToast(null)}>×</button></div>}
    </div>
  </Context.Provider>;
}

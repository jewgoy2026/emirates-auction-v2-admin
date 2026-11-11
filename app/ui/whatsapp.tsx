'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, AUCTION_TIME_ZONE, dubaiCalendarDate } from '../../lib/v2';
import { Empty, Field, Icon, Section, useAdmin } from './shared';

type ConnectionStatus = {
  configured: boolean;
  state: 'disconnected' | 'connecting' | 'qr' | 'connected' | 'reconnecting' | 'logged_out' | 'error';
  qrDataUrl: string; phone: string; displayName: string; lastError: string; updatedAt: string;
};
type AdminOption = { id: string; displayName: string; email: string };
type Customer = { id: string; displayName: string; email: string; phone: string };
type Conversation = {
  jid: string; phone: string; contact_name: string; push_name: string; assigned_admin_id: string | null;
  assignedAdmin: AdminOption | null; status: 'open' | 'pending' | 'closed'; labels: string[]; internal_note: string;
  unread_count: number; last_message_preview: string; last_message_at: string | null; updated_at: string; customer: Customer | null;
};
type Message = {
  id: string | number; whatsapp_id: string; direction: 'inbound' | 'outbound'; kind: string; body: string;
  media_mime: string; media_name: string; delivery_status: string; sent_at: string;
};

const emptyStatus: ConnectionStatus = { configured: true, state: 'disconnected', qrDataUrl: '', phone: '', displayName: '', lastError: '', updatedAt: '' };
const stateText: Record<ConnectionStatus['state'], string> = { disconnected: 'Desconectado', connecting: 'Preparando conexão', qr: 'Aguardando leitura do QR', connected: 'Conectado', reconnecting: 'Reconectando', logged_out: 'Sessão encerrada', error: 'Conector indisponível' };
const statusText: Record<Conversation['status'], string> = { open: 'Em atendimento', pending: 'Aguardando cliente', closed: 'Resolvido' };
const mediaText: Record<string, string> = { image: '📷 Imagem', video: '🎥 Vídeo', audio: '🎤 Áudio', document: '📄 Documento', sticker: 'Sticker', contact: 'Contato compartilhado', location: 'Localização compartilhada', interactive: 'Resposta interativa', unsupported: 'Mensagem não suportada' };

function when(value: string | null, includeDate = false) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return '';
  return new Intl.DateTimeFormat('pt-BR', includeDate ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: AUCTION_TIME_ZONE } : { hour: '2-digit', minute: '2-digit', timeZone: AUCTION_TIME_ZONE }).format(date);
}
function displayName(item: Conversation) { return item.customer?.displayName || item.contact_name || item.push_name || `+${item.phone}`; }
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'WA'; }

export default function WhatsAppSupport() {
  const { flash } = useAdmin();
  const [connection, setConnection] = useState<ConnectionStatus>(emptyStatus);
  const [conversations, setConversations] = useState<Conversation[]>([]), [admins, setAdmins] = useState<AdminOption[]>([]);
  const [selectedJid, setSelectedJid] = useState(''), [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [labels, setLabels] = useState(''), [note, setNote] = useState(''), [assigned, setAssigned] = useState(''), [caseStatus, setCaseStatus] = useState<Conversation['status']>('open');
  const threadEnd = useRef<HTMLDivElement>(null), firstThreadLoad = useRef(true), selectedRef = useRef('');
  const selected = conversations.find((item) => item.jid === selectedJid) ?? null;
  selectedRef.current = selectedJid;

  const loadStatus = useCallback(async () => {
    try { setConnection(await api<ConnectionStatus>('/v1/auction/admin/whatsapp/status')); }
    catch (error) { setConnection((current) => ({ ...current, state: 'error', lastError: (error as Error).message })); }
  }, []);
  const loadConversations = useCallback(async (quiet = false) => {
    try {
      const params = new URLSearchParams({ limit: '300', status: filter });
      if (search.trim()) params.set('search', search.trim());
      const result = await api<{ items: Conversation[]; admins: AdminOption[] }>(`/v1/auction/admin/whatsapp/conversations?${params}`);
      setConversations(result.items); setAdmins(result.admins);
      const activeJid = selectedRef.current;
      if (activeJid && !result.items.some((item) => item.jid === activeJid)) setSelectedJid('');
      if (!activeJid && result.items.length) setSelectedJid(result.items[0].jid);
    } catch (error) { if (!quiet) flash((error as Error).message, true); }
    finally { setLoading(false); }
  }, [filter, search, flash]);
  const loadMessages = useCallback(async (jid: string, quiet = false) => {
    if (!jid) return;
    try {
      const result = await api<{ items: Message[] }>(`/v1/auction/admin/whatsapp/conversations/${encodeURIComponent(jid)}/messages?limit=300`);
      setMessages(result.items);
      const conversation = conversations.find((item) => item.jid === jid);
      if (conversation?.unread_count) {
        await api(`/v1/auction/admin/whatsapp/conversations/${encodeURIComponent(jid)}/seen`, { method: 'POST', body: {} });
        setConversations((items) => items.map((item) => item.jid === jid ? { ...item, unread_count: 0 } : item));
      }
    } catch (error) { if (!quiet) flash((error as Error).message, true); }
  }, [conversations, flash]);

  useEffect(() => { void loadStatus(); const timer = setInterval(() => { if (!document.hidden) void loadStatus(); }, 4_000); return () => clearInterval(timer); }, [loadStatus]);
  useEffect(() => { const timer = setTimeout(() => void loadConversations(), 220); const poll = setInterval(() => { if (!document.hidden) void loadConversations(true); }, 5_000); return () => { clearTimeout(timer); clearInterval(poll); }; }, [loadConversations]);
  useEffect(() => {
    if (!selectedJid) { setMessages([]); return; }
    firstThreadLoad.current = true; void loadMessages(selectedJid);
    const timer = setInterval(() => { if (!document.hidden) void loadMessages(selectedJid, true); }, 2_500);
    return () => clearInterval(timer);
  }, [selectedJid]);
  useEffect(() => { if (!selected) return; setLabels(selected.labels.join(', ')); setNote(selected.internal_note); setAssigned(selected.assigned_admin_id ?? ''); setCaseStatus(selected.status); }, [selected?.jid, selected?.updated_at]);
  useEffect(() => { if (firstThreadLoad.current || messages.length) { threadEnd.current?.scrollIntoView({ block: 'end' }); firstThreadLoad.current = false; } }, [messages]);

  const counts = useMemo(() => ({ unread: conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0), open: conversations.filter((item) => item.status === 'open').length }), [conversations]);

  async function connect() {
    setBusy(true);
    try { setConnection(await api<ConnectionStatus>('/v1/auction/admin/whatsapp/connect', { method: 'POST', body: {} })); flash('Conector iniciado. Leia o QR quando ele aparecer.'); }
    catch (error) { flash((error as Error).message, true); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!window.confirm('Desconectar este número do painel e apagar a sessão vinculada?')) return;
    setBusy(true);
    try { setConnection(await api<ConnectionStatus>('/v1/auction/admin/whatsapp/logout', { method: 'POST', body: {} })); flash('Número desconectado do painel.'); }
    catch (error) { flash((error as Error).message, true); }
    finally { setBusy(false); }
  }
  async function saveCase() {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/v1/auction/admin/whatsapp/conversations/${encodeURIComponent(selected.jid)}`, { method: 'PATCH', body: { status: caseStatus, assignedAdminId: assigned || null, labels: labels.split(',').map((item) => item.trim()).filter(Boolean), internalNote: note } });
      await loadConversations(true); flash('Organização do atendimento salva.');
    } catch (error) { flash((error as Error).message, true); }
    finally { setBusy(false); }
  }

  return <>
    <Section title="Atendimento WhatsApp" eyebrow="CAIXA DE ENTRADA DA EQUIPE" actions={<div className={`wa-connection-chip ${connection.state}`}><i/>{stateText[connection.state]}</div>}/>
    <div className="wa-security-note"><Icon name="message"/><div><strong>Acompanhamento em modo somente leitura.</strong><span>O painel sincroniza o histórico e organiza os atendimentos. Mensagens e respostas são enviadas manualmente pelo telefone oficial.</span></div></div>
    {!connection.configured ? <div className="lab-error">O conector ainda não foi configurado no servidor.</div> : connection.state !== 'connected' ? <div className="wa-connect-panel">
      <div className="wa-connect-copy"><span className="lab-eyebrow">APARELHO VINCULADO</span><h2>{connection.state === 'qr' ? 'Leia o QR com o número de suporte' : 'Conecte o WhatsApp da operação'}</h2><p>No celular, abra WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho. A conexão é restaurada automaticamente após reinícios.</p>{connection.lastError && <p className="lab-error">{connection.lastError}</p>}<button className="lab-button" disabled={busy || ['connecting','reconnecting'].includes(connection.state)} onClick={connect}>{['connecting','reconnecting'].includes(connection.state) ? 'Preparando…' : connection.state === 'qr' ? 'Gerar novo QR' : 'Conectar número'}</button></div>
      <div className="wa-qr-box">{connection.qrDataUrl ? <img src={connection.qrDataUrl} alt="QR para vincular o WhatsApp de suporte" width="270" height="270"/> : <div className="wa-qr-placeholder"><Icon name="message" size={38}/><span>O QR aparecerá aqui</span></div>}<small>O QR expira rapidamente e é renovado de forma automática.</small></div>
    </div> : <>
      <div className="wa-connected-bar"><div className="wa-number-avatar"><Icon name="message"/></div><div><strong>{connection.displayName || 'WhatsApp de suporte'}</strong><span>+{connection.phone} · sincronização ativa</span></div><div className="wa-connected-stats"><span><b>{counts.unread}</b> não lidas</span><span><b>{counts.open}</b> em atendimento</span></div><button className="lab-outline-button small" onClick={disconnect} disabled={busy}>Desconectar</button></div>
      <div className="wa-inbox">
        <aside className="wa-conversation-column"><div className="wa-column-head"><div><strong>Conversas</strong><span>{conversations.length} encontradas</span></div></div><div className="wa-list-tools"><label><Icon name="search" size={17}/><input aria-label="Buscar conversas" placeholder="Nome, telefone ou e-mail" value={search} onChange={(event) => setSearch(event.target.value)}/></label><select aria-label="Filtrar atendimento" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todos os atendimentos</option><option value="open">Em atendimento</option><option value="pending">Aguardando cliente</option><option value="closed">Resolvidos</option></select></div><div className="wa-conversation-list">{loading ? <p className="wa-list-state">Carregando conversas…</p> : conversations.length ? conversations.map((item) => <button key={item.jid} className={item.jid === selectedJid ? 'selected' : ''} onClick={() => setSelectedJid(item.jid)}><span className="wa-avatar">{initials(displayName(item))}</span><span className="wa-conversation-copy"><span><strong>{displayName(item)}</strong><time>{when(item.last_message_at)}</time></span><small>{item.last_message_preview || 'Sem mensagens sincronizadas'}</small><em>{statusText[item.status]}</em></span>{item.unread_count > 0 && <b className="wa-unread">{item.unread_count > 99 ? '99+' : item.unread_count}</b>}</button>) : <p className="wa-list-state">Nenhuma conversa encontrada.</p>}</div></aside>
        <section className="wa-thread-column">{selected ? <><header className="wa-thread-head"><span className="wa-avatar">{initials(displayName(selected))}</span><div><strong>{displayName(selected)}</strong><span>+{selected.phone}{selected.customer ? ` · ${selected.customer.email}` : ''}</span></div><span className={`wa-case-status ${selected.status}`}>{statusText[selected.status]}</span></header><div className="wa-thread" aria-live="polite">{messages.length ? messages.map((message, index) => { const previous = messages[index - 1], showDate = !previous || dubaiCalendarDate(previous.sent_at) !== dubaiCalendarDate(message.sent_at); return <div key={`${message.id}-${message.whatsapp_id}`}>{showDate && <div className="wa-date-separator">{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: AUCTION_TIME_ZONE }).format(new Date(message.sent_at))}</div>}<div className={`wa-message ${message.direction}`}><div>{message.kind !== 'text' && <strong className="wa-media-kind">{mediaText[message.kind] ?? 'Mensagem'}</strong>}<p>{message.body || (message.media_name ? message.media_name : mediaText[message.kind] ?? 'Mensagem')}</p><span>{when(message.sent_at)}{message.direction === 'outbound' ? ` · ${message.delivery_status === 'read' || message.delivery_status === 'played' ? 'Lida' : message.delivery_status === 'delivered' ? 'Entregue' : message.delivery_status === 'failed' ? 'Falhou' : 'Enviada'}` : ''}</span></div></div></div>; }) : <Empty>A conversa ainda não possui mensagens sincronizadas.</Empty>}<div ref={threadEnd}/></div><div className="wa-monitor-footer"><Icon name="message" size={18}/><span><strong>Envio pelo telefone oficial</strong>As novas mensagens aparecerão aqui automaticamente.</span></div></> : <div className="wa-no-selection"><Icon name="message" size={42}/><h2>Selecione uma conversa</h2><p>O histórico sincronizado aparecerá aqui.</p></div>}</section>
        <aside className="wa-details-column">{selected ? <><div className="wa-profile-card"><span className="wa-avatar large">{initials(displayName(selected))}</span><h3>{displayName(selected)}</h3><p>+{selected.phone}</p>{selected.customer ? <div className="wa-customer-match"><Icon name="check" size={16}/><span><b>Cliente cadastrado</b>{selected.customer.email}</span></div> : <div className="wa-customer-missing">Contato ainda não associado a um cadastro.</div>}</div><div className="wa-case-form"><h3>Organização interna</h3><Field label="Situação"><select value={caseStatus} onChange={(event) => setCaseStatus(event.target.value as Conversation['status'])}><option value="open">Em atendimento</option><option value="pending">Aguardando cliente</option><option value="closed">Resolvido</option></select></Field><Field label="Responsável"><select value={assigned} onChange={(event) => setAssigned(event.target.value)}><option value="">Sem responsável</option>{admins.map((admin) => <option value={admin.id} key={admin.id}>{admin.displayName || admin.email}</option>)}</select></Field><Field label="Etiquetas" hint="Separe por vírgulas"><input value={labels} maxLength={320} placeholder="pagamento, cadastro" onChange={(event) => setLabels(event.target.value)}/></Field><Field label="Observação interna" hint="Não é enviada ao cliente"><textarea value={note} rows={5} maxLength={2000} placeholder="Contexto para a equipe…" onChange={(event) => setNote(event.target.value)}/></Field><button className="lab-outline-button full" disabled={busy} onClick={saveCase}>Salvar organização</button></div></> : null}</aside>
      </div>
    </>}
  </>;
}

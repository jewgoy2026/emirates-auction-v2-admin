export type Role = 'admin' | 'bidder';
export type User = { id: string; name: string; role: Role };
export type Lot = {
  id: string; title: string; category: string; description: string; image: string;
  mode: 'auction' | 'direct'; status: string; startPrice: number; price: number;
  increment: number; extension: number; startsAt: number; endsAt: number;
  fee: number; vat: number; winnerId: string | null; round: number;
  depositBps: number; minDeposit: number; minLimit: number;
  sourceId: string; sourcePrice: number | null; sourceBidCount: number | null;
  sourceObservedAt: string; createdAt: number; bidCount?: number;
};
export type Bid = { id: number; lotId: string; userId: string; amount: number; kind: string; round: number; createdAt: number };
export type Invoice = { id: string; lotId: string; userId: string; price: number; fee: number; tax: number; total: number; credit: number; due: number; status: string; createdAt: number; expiresAt: number };
export type Notice = { id: string; userId: string; lotId: string; invoiceId: string | null; message: string; contact: string; active: number; seen: number; createdAt: number };
export type Wallet = { balance: number; reserved: number; available: number; biddingLimit: number };
export const categories = ['Veículos', 'Placas', 'Imóveis', 'Itens gerais', 'Joias e relógios', 'Locação', 'Telefonia', 'Embarcações', 'Outros'];
export const statusLabels: Record<string, string> = { draft:'Rascunho', scheduled:'Agendado', open:'Em andamento', paused:'Suspenso', pending:'Aguardando aprovação', approved:'Aguardando pagamento', sold:'Concluído', cancelled:'Cancelado', archived:'Arquivado', requested:'Solicitado', rejected:'Recusado', paid:'Pago', confirmed:'Confirmado', expired:'Expirado' };
export function money(cents: number) { return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'AED' }).format(cents / 100); }
export function collateral(lot: Pick<Lot,'depositBps'|'minDeposit'|'minLimit'>, limit: number) { return Math.max(lot.minDeposit, Math.ceil(Math.max(limit,lot.minLimit)*lot.depositBps/10_000)); }
export function cents(value: string) { const normalized=value.trim().replace(',','.'); if(!/^\d{1,10}(\.\d{1,2})?$/.test(normalized))throw new Error('Informe um valor positivo com até duas casas decimais.');const [whole,fraction='']=normalized.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0')); }

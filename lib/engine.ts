import type { DemoDatabase } from './database';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { User, Lot, Bid, Invoice, Wallet } from './model.ts';
import { categories, collateral } from './model.ts';

export class DomainError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
function need(condition: unknown, message: string, status = 400): asserts condition { if (!condition) throw new DomainError(message, status); }
const id = () => randomUUID();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const amount = (v: unknown, min = 1) => { need(typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= 100_000_000_000, 'Valor inválido. Use centavos inteiros.'); return v; };
const label = (v: unknown, max: number, min = 1) => { need(typeof v === 'string' && v.trim().length >= min && v.length <= max, `Texto deve ter entre ${min} e ${max} caracteres.`); return v.trim(); };

/** Local simulation only. No private keys, payment destinations or chain broadcasts. */
export class Engine {
  db: DemoDatabase;
  now: () => number;
  constructor(db: DemoDatabase, now: () => number = Date.now) {
    this.db = db; this.now = now;
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lots(id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL, status TEXT NOT NULL, startPrice INTEGER NOT NULL, price INTEGER NOT NULL, increment INTEGER NOT NULL, extension INTEGER NOT NULL, startsAt INTEGER NOT NULL, endsAt INTEGER NOT NULL, fee INTEGER NOT NULL, vat INTEGER NOT NULL, winnerId TEXT REFERENCES users(id), round INTEGER NOT NULL DEFAULT 1, sourceId TEXT NOT NULL DEFAULT '', sourcePrice INTEGER, sourceBidCount INTEGER, sourceObservedAt TEXT NOT NULL DEFAULT '', createdAt INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS source_unique ON lots(sourceId) WHERE sourceId!='';
      CREATE TABLE IF NOT EXISTS bids(id INTEGER PRIMARY KEY AUTOINCREMENT, lotId TEXT NOT NULL REFERENCES lots(id), userId TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, kind TEXT NOT NULL, round INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS bids_lot_round ON bids(lotId,round,id);
      CREATE TABLE IF NOT EXISTS autobids(id INTEGER PRIMARY KEY AUTOINCREMENT, lotId TEXT NOT NULL REFERENCES lots(id), userId TEXT NOT NULL REFERENCES users(id), maximum INTEGER NOT NULL, round INTEGER NOT NULL, createdAt INTEGER NOT NULL, UNIQUE(lotId,userId,round));
      CREATE TABLE IF NOT EXISTS ledger(id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, kind TEXT NOT NULL, reference TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS holds(reference TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount>=0), kind TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS deposits(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS withdrawals(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL, destination TEXT NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY, lotId TEXT NOT NULL REFERENCES lots(id), userId TEXT NOT NULL REFERENCES users(id), price INTEGER NOT NULL, fee INTEGER NOT NULL, tax INTEGER NOT NULL, total INTEGER NOT NULL, credit INTEGER NOT NULL, due INTEGER NOT NULL, status TEXT NOT NULL, createdAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), lotId TEXT NOT NULL REFERENCES lots(id), invoiceId TEXT REFERENCES invoices(id), message TEXT NOT NULL, contact TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, seen INTEGER NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS carts(lotId TEXT PRIMARY KEY REFERENCES lots(id), userId TEXT NOT NULL REFERENCES users(id), expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actorId TEXT, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS audit_time ON audit(createdAt);`);
    const columns=this.all<{name:string}>('PRAGMA table_info(lots)').map(c=>c.name);
    for(const [name,value] of [['depositBps',2000],['minDeposit',0],['minLimit',0]] as const) if(!columns.includes(name))db.exec(`ALTER TABLE lots ADD COLUMN ${name} INTEGER NOT NULL DEFAULT ${value}`);
  }
  all<T = Record<string, unknown>>(sql: string, ...args: (string | number | null)[]) { return this.db.prepare(sql).all(...args) as T[]; }
  one<T = Record<string, unknown>>(sql: string, ...args: (string | number | null)[]) { return this.db.prepare(sql).get(...args) as T | undefined; }
  run(sql: string, ...args: (string | number | null)[]) { return this.db.prepare(sql).run(...args); }
  tx<T>(fn: () => T): T { if(this.db.transactionSync)return this.db.transactionSync(fn);this.db.exec('BEGIN IMMEDIATE'); try { const v = fn(); this.db.exec('COMMIT'); return v; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  log(actor: string | null, action: string, target: string, detail: unknown) { this.run('INSERT INTO audit(actorId,action,target,detail,createdAt) VALUES(?,?,?,?,?)', actor, action, target, JSON.stringify(detail), this.now()); }
  admin(user: User) { need(user.role === 'admin', 'Acesso exclusivo do administrador.', 403); }
  bidder(user: User) { need(user.role === 'bidder', 'Use uma conta de participante para esta operação.', 403); }
  lot(lotId: string) { const lot = this.one<Lot>('SELECT * FROM lots WHERE id=?', lotId); need(lot, 'Lote não encontrado.', 404); return lot; }
  wallet(userId: string): Wallet {
    const balance = this.one<{n:number}>('SELECT COALESCE(SUM(amount),0) n FROM ledger WHERE userId=?', userId)!.n;
    const reserved = this.one<{n:number}>('SELECT COALESCE(SUM(amount),0) n FROM holds WHERE userId=?', userId)!.n;
    return { balance, reserved, available: balance - reserved, biddingLimit: (balance - reserved) * 5 };
  }
  hold(reference: string, userId: string, value: number, kind: string) {
    const previous = this.one<{amount:number,userId:string}>('SELECT amount,userId FROM holds WHERE reference=?', reference);
    const free = this.wallet(userId).available + (previous?.userId === userId ? previous.amount : 0);
    need(free >= value, 'Saldo livre insuficiente para a caução ou reserva.');
    this.run('INSERT INTO holds(reference,userId,amount,kind) VALUES(?,?,?,?) ON CONFLICT(reference) DO UPDATE SET userId=excluded.userId,amount=excluded.amount,kind=excluded.kind', reference,userId,value,kind);
  }
  seed() {
    if (this.one('SELECT id FROM users LIMIT 1')) return;
    this.tx(() => {
      for (const u of [{id:'admin',name:'Administrador de teste',role:'admin'}, {id:'ana',name:'Ana · conta de teste',role:'bidder'}, {id:'bruno',name:'Bruno · conta de teste',role:'bidder'}]) this.run('INSERT INTO users VALUES(?,?,?)',u.id,u.name,u.role);
      for (const u of ['ana','bruno']) this.run('INSERT INTO ledger(userId,amount,kind,reference,createdAt) VALUES(?,?,?,?,?)',u,2_000_000,'DEMO_INITIAL',`seed:${u}`,this.now());
      const admin = this.one<User>('SELECT * FROM users WHERE id=?','admin')!;
      const seeds = [
        ['patrol','Nissan Patrol 2014','Veículos',1_600_000,10_000,3,'auction','Motor V8 · automático · 443.439 km. Exemplo de catálogo para teste, sem oferta real.'],
        ['coupe','Coupé esportivo 2022','Veículos',10_000_000,50_000,3,'auction','Lote fictício para validar o limite de lance e o abatimento da caução.'],
        ['plate','Placa 98949 · código 4','Placas',1_100_000,10_000,5,'direct','Compra direta de demonstração. Reserva do carrinho por 15 minutos.'],
        ['apartment','Apartamento · 2 dormitórios','Imóveis',51_000_000,100_000,3,'auction','1.812,98 ft² · residencial. Dados de referência; nenhuma propriedade está sendo oferecida.'],
        ['gold','Ouro 24k · 7,78 g','Joias e relógios',60_000,10_000,5,'auction','Exemplo de lote para avaliar ficha, lances e aprovação.'],
        ['phones','Conjunto de smartphones · 10 unidades','Itens gerais',55_000,5_000,5,'auction','Lote demonstrativo. Imagens ilustrativas e valores simulados.'],
        ['rent','Loja comercial · 140 m²','Locação',6_000_000,10_000,5,'auction','Valor anual ilustrativo. Contrato de demonstração.'],
        ['trailer','Reboque utilitário','Itens gerais',30_000,10_000,4,'auction','Exemplo de leilão com extensão de quatro minutos.'],
      ];
      for (let i=0;i<seeds.length;i++) {
        const [key,title,category,price,increment,extension,mode,description] = seeds[i];
        this.insertLot({id:String(key),title,category,startPrice:price,increment,extension,mode,description,startsAt:this.now()-60_000,endsAt:this.now()+(i+1)*3_600_000,fee:category==='Joias e relógios'?35_000:20_000,vat:500}, 'open');
      }
      this.log(admin.id,'DEMO_INITIALIZED','catalog',{note:'Catálogo ilustrativo, sem leilões ou pagamentos reais.'});
    });
  }
  validateLot(input: Record<string, unknown>) {
    const title=label(input.title,180), category=label(input.category,50), description=label(input.description,6000);
    need(categories.includes(category),'Categoria inválida.');
    need(input.mode==='auction'||input.mode==='direct','Modalidade inválida.');
    const startPrice=amount(input.startPrice), increment=amount(input.increment), fee=amount(input.fee??0,0), vat=amount(input.vat??500,0), extension=amount(input.extension??3);
    need(vat<=10000 && extension<=60,'Taxa ou prorrogação inválida.');
    const startsAt=Number(input.startsAt),endsAt=Number(input.endsAt); need(Number.isSafeInteger(startsAt)&&Number.isSafeInteger(endsAt)&&startsAt>0&&endsAt<4_102_444_800_000&&endsAt>startsAt,'Informe datas válidas, com fim posterior ao início.');
    const image=typeof input.image==='string'?input.image:''; need(!image || /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(image),'Use uma imagem enviada pelo painel.');
    const depositBps=amount(input.depositBps??2000),minDeposit=amount(input.minDeposit??0,0),minLimit=amount(input.minLimit??0,0);
    need(depositBps<=10000,'Percentual de caução deve estar entre 0,01% e 100%.');
    return {title,category,description,mode:input.mode,startPrice,increment,fee,vat,extension,startsAt,endsAt,image,depositBps,minDeposit,minLimit};
  }
  insertLot(input: Record<string, unknown>, status='draft') {
    const d=this.validateLot(input), lotId=typeof input.id==='string'?input.id:id();
    this.run('INSERT INTO lots(id,title,category,description,image,mode,status,startPrice,price,increment,extension,startsAt,endsAt,fee,vat,createdAt,depositBps,minDeposit,minLimit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',lotId,d.title,d.category,d.description,d.image,d.mode,status,d.startPrice,d.startPrice,d.increment,d.extension,d.startsAt,d.endsAt,d.fee,d.vat,this.now(),d.depositBps,d.minDeposit,d.minLimit); return this.lot(lotId);
  }
  create(user:User,input:Record<string,unknown>) { this.admin(user);return this.tx(()=>{const lot=this.insertLot(input);this.log(user.id,'LOT_CREATED',lot.id,{title:lot.title});return lot;}); }
  edit(user:User,lotId:string,input:Record<string,unknown>) {
    this.admin(user);return this.tx(()=>{
      const lot=this.lot(lotId),d=this.validateLot({...lot,...input});
      if(lot.status==='draft')this.run('UPDATE lots SET title=?,category=?,description=?,image=?,mode=?,startPrice=?,price=?,increment=?,extension=?,startsAt=?,endsAt=?,fee=?,vat=?,depositBps=?,minDeposit=?,minLimit=? WHERE id=?',d.title,d.category,d.description,d.image,d.mode,d.startPrice,d.startPrice,d.increment,d.extension,d.startsAt,d.endsAt,d.fee,d.vat,d.depositBps,d.minDeposit,d.minLimit,lotId);
      else {
        for(const key of ['category','mode','startPrice','increment','extension','startsAt','endsAt','fee','vat','depositBps','minDeposit','minLimit'] as const) need(d[key]===lot[key],'Edite valores e regras no rascunho de uma nova rodada.');
        this.run('UPDATE lots SET title=?,description=?,image=? WHERE id=?',d.title,d.description,d.image,lotId);
      }
      this.log(user.id,'LOT_EDITED',lotId,{before:lot,after:d});return this.lot(lotId);
    });
  }
  import(user:User, input:unknown) {
    this.admin(user);need(Array.isArray(input)&&input.length>0&&input.length<=500,'Importe de 1 a 500 registros JSON.');
    return this.tx(()=>input.map((v)=>{need(v&&typeof v==='object'&&!Array.isArray(v),'Registro inválido.');const source=label(v.sourceId,120);need(!this.one('SELECT id FROM lots WHERE sourceId=?',source),'ID de origem duplicado: '+source);const lot=this.insertLot(v);const sourcePrice=amount(v.sourcePrice??v.startPrice,0),sourceBidCount=amount(v.sourceBidCount??0,0);const observed=label(v.sourceObservedAt,40);need(Number.isFinite(Date.parse(observed)),'Data de coleta inválida.');this.run('UPDATE lots SET sourceId=?,sourcePrice=?,sourceBidCount=?,sourceObservedAt=? WHERE id=?',source,sourcePrice,sourceBidCount,observed,lot.id);this.log(user.id,'CATALOG_IMPORTED',lot.id,{source,sourcePrice,sourceBidCount,observed,note:'Snapshot arquivado; lances não foram sintetizados.'});return this.lot(lot.id);}));
  }
  login(userId:string) { const user=this.one<User>('SELECT * FROM users WHERE id=?',userId);need(user,'Conta de teste inválida.');const token=randomBytes(32).toString('hex');this.run('INSERT INTO sessions VALUES(?,?,?)',sha(token),user.id,this.now()+8*3600_000);return {user,token}; }
  session(token:string) { return this.one<User>('SELECT u.* FROM sessions s JOIN users u ON u.id=s.userId WHERE s.token=? AND s.expiresAt>?',sha(token),this.now()); }
  logout(token:string) {this.run('DELETE FROM sessions WHERE token=?',sha(token));}
  catalog(admin=false) { return this.all<Lot>(`SELECT l.*, (SELECT COUNT(*) FROM bids b WHERE b.lotId=l.id AND b.round=l.round) bidCount FROM lots l ${admin?'':"WHERE status NOT IN ('draft','archived')"} ORDER BY createdAt DESC,id`); }
  tick() {return this.tx(()=>{
    this.run("UPDATE lots SET status='open' WHERE status='scheduled' AND startsAt<=?",this.now());
    for(const lot of this.all<Lot>("SELECT * FROM lots WHERE mode='auction' AND status='open' AND endsAt<=?",this.now()))this.close(lot,null);
    this.run('DELETE FROM carts WHERE expiresAt<=?',this.now());
    for(const invoice of this.all<Invoice>("SELECT * FROM invoices WHERE status='pending' AND expiresAt<=?",this.now())){this.run("UPDATE invoices SET status='expired' WHERE id=?",invoice.id);this.run('DELETE FROM holds WHERE reference=?','invoice:'+invoice.id);const lot=this.lot(invoice.lotId);this.run('UPDATE lots SET status=? WHERE id=?',lot.mode==='direct'?'open':'pending',lot.id);this.run('UPDATE notices SET active=0 WHERE invoiceId=?',invoice.id);this.log(null,'INVOICE_EXPIRED',invoice.id,{lotId:lot.id});}
    this.run('DELETE FROM sessions WHERE expiresAt<=?',this.now());
  });}
  close(lot:Lot,actor:string|null) {this.run('UPDATE lots SET status=?,endsAt=? WHERE id=?',lot.winnerId?'pending':'cancelled',Math.min(lot.endsAt,this.now()),lot.id);this.log(actor,'AUCTION_ENDED',lot.id,{round:lot.round,winnerId:lot.winnerId,price:lot.price});}
  bid(user:User,lotId:string,value:unknown,automatic=false) {
    this.bidder(user);const offer=amount(value);return this.tx(()=>{
      const lot=this.lot(lotId);need(lot.mode==='auction'&&lot.status==='open'&&lot.startsAt<=this.now()&&lot.endsAt>this.now(),'Este leilão não está recebendo lances.');
      const minimum=lot.winnerId?lot.price+lot.increment:lot.startPrice;
      need(offer>=minimum,`Lance mínimo: ${(minimum/100).toFixed(2)} AED.`);
      const previous=this.one<{amount:number,userId:string}>('SELECT * FROM holds WHERE reference=?','bid:'+lot.id);
      const free=this.wallet(user.id).available+(previous?.userId===user.id?previous.amount:0);
      need(free>=collateral(lot,offer),'Depósito insuficiente para o limite desejado e os mínimos deste lote.');
      if(automatic){need(!this.one('SELECT id FROM autobids WHERE lotId=? AND userId=? AND round=?',lot.id,user.id,lot.round),'O limite automático desta rodada já foi definido e não pode ser alterado.');this.run('INSERT INTO autobids(lotId,userId,maximum,round,createdAt) VALUES(?,?,?,?,?)',lot.id,user.id,offer,lot.round,this.now());}
      let price=automatic?lot.price:offer;
      let winner=automatic?lot.winnerId:user.id;
      if(!automatic)this.run('INSERT INTO bids(lotId,userId,amount,kind,round,createdAt) VALUES(?,?,?,?,?,?)',lot.id,user.id,offer,'manual',lot.round,this.now());
      const autos=this.all<{userId:string,maximum:number,id:number}>('SELECT * FROM autobids WHERE lotId=? AND round=? ORDER BY maximum DESC,id ASC',lot.id,lot.round);
      // Competing proxy limits are private; actual accepted bids are public amounts only.
      for(const auto of autos){
        const ownHold=previous?.userId===auto.userId?previous.amount:0;
        if(this.wallet(auto.userId).available+ownHold<collateral(lot,auto.maximum))continue;
        const required=winner?(auto.userId===winner?price:price+lot.increment):lot.startPrice;
        if(auto.maximum<required)continue;
        let target=required;
        const second=autos.find(a=>a.userId!==auto.userId&&a.maximum>=required&&this.wallet(a.userId).available+(previous?.userId===a.userId?previous.amount:0)>=collateral(lot,a.maximum));
        if(second)target=Math.min(auto.maximum,second.maximum+lot.increment);
        if(auto.userId!==winner||target>price){winner=auto.userId;price=target;this.run('INSERT INTO bids(lotId,userId,amount,kind,round,createdAt) VALUES(?,?,?,?,?,?)',lot.id,winner,price,'automatic',lot.round,this.now());}break;
      }
      need(winner,'Não foi possível registrar o lance.');
      const leaderAuto=autos.find(a=>a.userId===winner);
      this.hold('bid:'+lot.id,winner,collateral(lot,Math.max(price,leaderAuto?.maximum??0)),'bid');
      const extensionMs=lot.extension*60_000;
      const endsAt=lot.endsAt-this.now()<=extensionMs?Math.max(lot.endsAt,this.now()+extensionMs):lot.endsAt;
      this.run('UPDATE lots SET price=?,winnerId=?,endsAt=? WHERE id=?',price,winner,endsAt,lot.id);
      this.log(user.id,automatic?'AUTO_BID_SET':'BID_PLACED',lot.id,{amount:automatic?undefined:offer,round:lot.round,extended:endsAt!==lot.endsAt});
      return this.lot(lot.id);
    });
  }
  invoice(lot:Lot,userId:string,expiresAt:number) {
    const fee=lot.fee,tax=Math.round((lot.price+fee)*lot.vat/10_000),total=lot.price+fee+tax;
    this.run('DELETE FROM holds WHERE reference=?','bid:'+lot.id);
    const credit=Math.min(total,this.wallet(userId).available),invoiceId=id();
    this.hold('invoice:'+invoiceId,userId,credit,'invoice');
    this.run('INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',invoiceId,lot.id,userId,lot.price,fee,tax,total,credit,total-credit,'pending',this.now(),expiresAt);
    this.run("UPDATE lots SET status='approved',winnerId=? WHERE id=?",userId,lot.id);
    return this.one<Invoice>('SELECT * FROM invoices WHERE id=?',invoiceId)!;
  }
  lotAction(user:User,lotId:string,action:string,reason:unknown,minutes?:unknown) {this.admin(user);const why=label(reason,500,5);return this.tx(()=>{
    const lot=this.lot(lotId);
    if(action==='publish'){need(['draft','paused'].includes(lot.status)&&lot.endsAt>this.now(),'Revise o estado e o encerramento antes de publicar.');this.run('UPDATE lots SET status=? WHERE id=?',lot.startsAt>this.now()?'scheduled':'open',lotId);}
    else if(action==='pause'){need(['open','scheduled'].includes(lot.status),'Somente leilões abertos ou agendados podem ser suspensos.');this.run("UPDATE lots SET status='paused' WHERE id=?",lotId);}
    else if(action==='extend'){need(['open','paused','scheduled'].includes(lot.status),'Este estado não permite prorrogação.');const m=amount(minutes);need(m<=43200,'Prorrogação máxima: 30 dias.');this.run('UPDATE lots SET endsAt=? WHERE id=?',Math.max(lot.endsAt,this.now())+m*60_000,lotId);}
    else if(action==='end'){need(lot.mode==='auction'&&['open','paused'].includes(lot.status),'Leilão não pode ser encerrado neste estado.');this.close(lot,user.id);}
    else if(action==='approve'){need(lot.status==='pending'&&lot.winnerId,'Não há resultado pendente de aprovação.');need(!this.one("SELECT id FROM invoices WHERE lotId=? AND status IN ('pending','paid')",lotId),'Já existe uma fatura ativa.');this.invoice(lot,lot.winnerId,this.now()+48*3600_000);}
    else if(['cancel','reset','archive'].includes(action)){
      need(action==='archive'||lot.status!=='sold','Venda concluída não pode ser cancelada ou resetada.');
      this.run('DELETE FROM holds WHERE reference=?','bid:'+lotId);
      for(const inv of this.all<Invoice>("SELECT * FROM invoices WHERE lotId=? AND status='pending'",lotId)){this.run("UPDATE invoices SET status='cancelled' WHERE id=?",inv.id);this.run('DELETE FROM holds WHERE reference=?','invoice:'+inv.id);}
      this.run('DELETE FROM carts WHERE lotId=?',lotId);this.run('UPDATE notices SET active=0 WHERE lotId=?',lotId);
      if(action==='reset')this.run("UPDATE lots SET status='draft',winnerId=NULL,price=startPrice,round=round+1,startsAt=?,endsAt=? WHERE id=?",this.now(),this.now()+86400_000,lotId);
      else this.run('UPDATE lots SET status=? WHERE id=?',action==='archive'?'archived':'cancelled',lotId);
    }else throw new DomainError('Ação inválida.');
    this.log(user.id,'LOT_'+action.toUpperCase(),lotId,{reason:why,previousStatus:lot.status,previousRound:lot.round,minutes});return this.lot(lotId);
  });}
  reserve(user:User,lotId:string) {this.bidder(user);return this.tx(()=>{const lot=this.lot(lotId);need(lot.mode==='direct'&&lot.status==='open','Item indisponível.');const current=this.one<{userId:string}>('SELECT * FROM carts WHERE lotId=?',lotId);need(!current||current.userId===user.id,'Item reservado por outro participante.');const count=this.one<{n:number}>('SELECT COUNT(*) n FROM carts WHERE userId=?',user.id)!.n;need(current||count<3,'O carrinho aceita até três itens.');const expiry=this.now()+15*60_000;this.run('INSERT INTO carts VALUES(?,?,?) ON CONFLICT(lotId) DO UPDATE SET expiresAt=excluded.expiresAt',lotId,user.id,expiry);this.run('UPDATE carts SET expiresAt=? WHERE userId=?',expiry,user.id);this.log(user.id,'CART_RESERVED',lotId,{expiresAt:expiry});});}
  removeCart(user:User,lotId:string){this.run('DELETE FROM carts WHERE lotId=? AND userId=?',lotId,user.id);}
  checkout(user:User){this.bidder(user);return this.tx(()=>{const cart=this.all<{lotId:string,expiresAt:number}>('SELECT * FROM carts WHERE userId=? AND expiresAt>?',user.id,this.now());need(cart.length,'Carrinho vazio ou expirado.');const invoices=cart.map(row=>{const lot=this.lot(row.lotId);need(lot.status==='open','Item indisponível.');return this.invoice(lot,user.id,row.expiresAt);});this.run('DELETE FROM carts WHERE userId=?',user.id);this.log(user.id,'DIRECT_CHECKOUT','cart',{invoices:invoices.map(i=>i.id)});return invoices;});}
  deposit(user:User,value:unknown){this.bidder(user);const n=amount(value);need(n<=100_000_000,'Limite de depósito de teste: 1 milhão AED.');const dep=id();this.run('INSERT INTO deposits VALUES(?,?,?,?,?)',dep,user.id,n,'pending',this.now());this.log(user.id,'DEMO_DEPOSIT_REQUESTED',dep,{amount:n});return this.one('SELECT * FROM deposits WHERE id=?',dep)!;}
  confirmDeposit(user:User,depId:string){this.bidder(user);return this.tx(()=>{const d=this.one<{userId:string,status:string,amount:number}>('SELECT * FROM deposits WHERE id=? AND userId=?',depId,user.id);need(d,'Depósito não encontrado.',404);if(d.status==='confirmed')return;need(d.status==='pending','Depósito indisponível.');this.run('INSERT INTO ledger(userId,amount,kind,reference,createdAt) VALUES(?,?,?,?,?)',user.id,d.amount,'DEMO_DEPOSIT',depId,this.now());this.run("UPDATE deposits SET status='confirmed' WHERE id=?",depId);this.log(user.id,'DEMO_DEPOSIT_CONFIRMED',depId,{amount:d.amount});});}
  withdraw(user:User,value:unknown){this.bidder(user);return this.tx(()=>{const n=amount(value),wid=id();this.hold('withdrawal:'+wid,user.id,n,'withdrawal');this.run('INSERT INTO withdrawals VALUES(?,?,?,?,?,?)',wid,user.id,n,'Carteira fictícia de homologação','requested',this.now());this.log(user.id,'WITHDRAWAL_REQUESTED',wid,{amount:n});return this.one('SELECT * FROM withdrawals WHERE id=?',wid);});}
  reviewWithdrawal(user:User,wid:string,approve:boolean,reason:unknown){this.admin(user);const why=label(reason,500,5);return this.tx(()=>{const w=this.one<{userId:string,amount:number,status:string}>('SELECT * FROM withdrawals WHERE id=?',wid);need(w&&w.status==='requested','Solicitação já processada ou inexistente.');if(approve)this.run('INSERT INTO ledger(userId,amount,kind,reference,createdAt) VALUES(?,?,?,?,?)',w.userId,-w.amount,'DEMO_WITHDRAWAL',wid,this.now());this.run('DELETE FROM holds WHERE reference=?','withdrawal:'+wid);this.run('UPDATE withdrawals SET status=? WHERE id=?',approve?'paid':'rejected',wid);this.log(user.id,approve?'DEMO_WITHDRAWAL_PAID':'WITHDRAWAL_REJECTED',wid,{reason:why});});}
  pay(user:User,invoiceId:string){this.bidder(user);return this.tx(()=>{const inv=this.one<Invoice>('SELECT * FROM invoices WHERE id=? AND userId=?',invoiceId,user.id);need(inv,'Fatura não encontrada.',404);if(inv.status==='paid')return;need(inv.status==='pending'&&inv.expiresAt>this.now(),'Fatura expirada ou cancelada.');need(this.lot(inv.lotId).mode==='direct'||this.one('SELECT id FROM notices WHERE invoiceId=? AND userId=? AND active=1',inv.id,user.id),'O administrador ainda não liberou o aviso desta fatura.');if(inv.credit)this.run('INSERT INTO ledger(userId,amount,kind,reference,createdAt) VALUES(?,?,?,?,?)',user.id,-inv.credit,'INVOICE_CREDIT',inv.id,this.now());this.run('DELETE FROM holds WHERE reference=?','invoice:'+inv.id);this.run("UPDATE invoices SET status='paid' WHERE id=?",inv.id);this.run("UPDATE lots SET status='sold' WHERE id=?",inv.lotId);this.run('UPDATE notices SET active=0 WHERE invoiceId=?',inv.id);this.log(user.id,'DEMO_INVOICE_PAID',inv.id,{total:inv.total,credit:inv.credit,simulatedExternalAmount:inv.due});});}
  notify(user:User,input:Record<string,unknown>){this.admin(user);return this.tx(()=>{const target=label(input.userId,100),lot=this.lot(label(input.lotId,100));need(this.one("SELECT id FROM users WHERE id=? AND role='bidder'",target),'Selecione uma conta de participante.');const message=label(input.message,1200);let invoice:Invoice|undefined;if(input.payment){invoice=this.one<Invoice>("SELECT * FROM invoices WHERE lotId=? AND userId=? AND status='pending'",lot.id,target);need(invoice&&lot.winnerId===target,'O aviso de cobrança exige uma fatura válida para o vencedor selecionado.');}
    const noticeId=id();this.run('INSERT INTO notices(id,userId,lotId,invoiceId,message,contact,createdAt) VALUES(?,?,?,?,?,?,?)',noticeId,target,lot.id,invoice?.id??null,message,'Equipe de homologação · contato de teste',this.now());this.log(user.id,'NOTICE_PUBLISHED',noticeId,{userId:target,lotId:lot.id,payment:!!invoice});return noticeId;});}
  dismiss(user:User,noticeId:string){need(this.run('UPDATE notices SET seen=1 WHERE id=? AND userId=?',noticeId,user.id).changes,'Aviso não encontrado.',404);}
  revokeNotice(user:User,noticeId:string){this.admin(user);this.run('UPDATE notices SET active=0 WHERE id=?',noticeId);this.log(user.id,'NOTICE_REVOKED',noticeId,{});}
  account(user:User){return {user,wallet:this.wallet(user.id),bids:this.all<Bid>('SELECT * FROM bids WHERE userId=? ORDER BY id DESC',user.id),autobids:this.all('SELECT * FROM autobids WHERE userId=?',user.id),lots:this.all<Lot>('SELECT * FROM lots WHERE id IN (SELECT lotId FROM bids WHERE userId=?) OR id IN (SELECT lotId FROM invoices WHERE userId=?) OR id IN (SELECT lotId FROM notices WHERE userId=?)',user.id,user.id,user.id),ledger:this.all('SELECT * FROM ledger WHERE userId=? ORDER BY id DESC',user.id),deposits:this.all('SELECT * FROM deposits WHERE userId=? ORDER BY createdAt DESC',user.id),withdrawals:this.all('SELECT * FROM withdrawals WHERE userId=? ORDER BY createdAt DESC',user.id),invoices:this.all<Invoice>('SELECT * FROM invoices WHERE userId=? ORDER BY createdAt DESC',user.id),notices:this.all('SELECT * FROM notices WHERE userId=? ORDER BY createdAt DESC',user.id),cart:this.all('SELECT c.*,l.title,l.price FROM carts c JOIN lots l ON l.id=c.lotId WHERE c.userId=?',user.id)};}
  dashboard(user:User){this.admin(user);return {users:this.all<User>('SELECT * FROM users').map(u=>({...u,wallet:this.wallet(u.id)})),lots:this.catalog(true),bids:this.all<Bid>('SELECT * FROM bids ORDER BY id DESC LIMIT 1000'),invoices:this.all<Invoice>('SELECT * FROM invoices ORDER BY createdAt DESC'),withdrawals:this.all('SELECT * FROM withdrawals ORDER BY createdAt DESC'),deposits:this.all('SELECT * FROM deposits ORDER BY createdAt DESC'),notices:this.all('SELECT * FROM notices ORDER BY createdAt DESC'),audit:this.all('SELECT * FROM audit ORDER BY id DESC LIMIT 1000'),ledger:this.all('SELECT * FROM ledger ORDER BY id DESC LIMIT 1000')};}
}

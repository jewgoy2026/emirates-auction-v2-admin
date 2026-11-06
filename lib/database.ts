export type Params=(string|number|null)[];
export interface DemoDatabase {
  exec(sql:string):unknown;
  prepare(sql:string):{all(...args:Params):unknown[];get(...args:Params):unknown;run(...args:Params):{changes:number|bigint}};
  transactionSync?<T>(fn:()=>T):T;
}

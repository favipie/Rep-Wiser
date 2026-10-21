import type {Data} from './model';
export type Stored={data:Data;revision:number;dirty:boolean};
export function keyFor(owner:string){return 'repwise:v1:'+owner}
export function readLocal(owner:string):Stored|null {const raw=localStorage.getItem(keyFor(owner));if(!raw)return null;const parsed=JSON.parse(raw);if(!parsed.data||!Array.isArray(parsed.data.sessions)||!Array.isArray(parsed.data.templates))throw new Error('Saved data could not be read. Export your browser storage before resetting it.');return parsed}
export function writeLocal(owner:string,value:Stored){localStorage.setItem(keyFor(owner),JSON.stringify(value))}
export function exportData(data:Data){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='repwise-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href)}

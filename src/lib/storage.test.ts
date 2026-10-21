import {describe,it,expect,beforeEach} from 'vitest';
import {blankData,perform,uid,type Session} from './model';import {exercises} from './exercises';import {readLocal,writeLocal,keyFor} from './storage';
const storage=new Map<string,string>();
beforeEach(()=>{storage.clear();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)}})});
describe('local journal persistence and account boundaries',()=>{
it('creates, restores, updates, and deletes a workout',()=>{const data=blankData();const session:Session={id:uid(),name:'Test workout',date:new Date().toISOString(),status:'draft',exercises:[perform(exercises[0])]};data.sessions.push(session);writeLocal('A',{data,revision:0,dirty:true});const restored=readLocal('A')!;expect(restored.data.sessions[0].id).toBe(session.id);restored.data.sessions[0].exercises[0].sets[0].reps=12;restored.data.sessions[0].status='complete';writeLocal('A',restored);expect(readLocal('A')!.data.sessions[0].exercises[0].sets[0].reps).toBe(12);restored.data.sessions=[];writeLocal('A',restored);expect(readLocal('A')!.data.sessions).toEqual([])});
it('never loads another account or guest journal',()=>{writeLocal('A',{data:{...blankData(),preferences:{goal:'Strength'} as never},revision:4,dirty:true});expect(readLocal('B')).toBeNull();expect(readLocal('guest')).toBeNull();expect(keyFor('A')).not.toBe(keyFor('B'))});
it('preserves unsynced data and cloud revision across reloads',()=>{writeLocal('A',{data:blankData(),revision:7,dirty:true});expect(readLocal('A')).toMatchObject({revision:7,dirty:true})});
it('fails visibly on corrupted data rather than overwriting it',()=>{storage.set(keyFor('A'),'broken');expect(()=>readLocal('A')).toThrow();expect(storage.get(keyFor('A'))).toBe('broken')});
});

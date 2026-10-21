import {describe,it,expect} from 'vitest';import {recommend} from './progression';import {perform,validateSession,volume,estimatedMax,type Performed} from './model';import {exercises} from './exercises';
function entry(reps=[12,12,12],rir:number|null=2):Performed{const e=perform(exercises[0]);return {...e,min:8,max:12,sets:e.sets.map((s,i)=>({...s,weight:40,reps:reps[i],rir,done:true}))}}
describe('double progression',()=>{
it('increases only when all sets reach target',()=>expect(recommend(entry())).toMatchObject({action:'increase',weight:42.5}));
it('holds partial targets',()=>expect(recommend(entry([12,11,12])).action).toBe('maintain'));
it('does not deload after one poor day',()=>expect(recommend(entry([7,7,7])).action).toBe('maintain'));
it('reviews repeated comparable decline',()=>expect(recommend(entry([8,8,8]),[entry([10,10,10]),entry([9,9,9])]).action).toBe('review'));
it('holds with unavailable increments',()=>expect(recommend({...entry(),increment:0}).action).toBe('maintain'));
it('handles missing RIR conservatively',()=>expect(recommend(entry(undefined,null)).action).toBe('maintain'));
it('honors different rep ranges',()=>expect(recommend({...entry([5,5,5]),min:3,max:5,increment:1}).weight).toBe(41));
it('honors explicit override',()=>expect(recommend({...entry(),override:41})).toMatchObject({action:'override',weight:41}));
it('excludes warmups',()=>{const e=entry();e.sets.push({...e.sets[0],id:'warmup',weight:10,reps:5,rir:null,warmup:true});expect(recommend(e).action).toBe('increase')});
it('does not increase with pain or technique concerns',()=>{expect(recommend({...entry(),pain:true}).action).toBe('review');expect(recommend({...entry(),technique:false}).action).toBe('review')});
it('holds when prescribed sets are incomplete',()=>{const e=entry();e.sets[2].done=false;expect(recommend(e).action).toBe('maintain')});
it('rejects mismatched working loads',()=>{const e=entry();e.sets[2].weight=35;expect(recommend(e).action).toBe('maintain')});
it('honors configured RIR',()=>expect(recommend(entry(undefined,0)).action).toBe('maintain'));
it('does not compare different loads for decline',()=>{const older=entry([15,15,15]);older.sets.forEach(s=>s.weight=20);expect(recommend(entry([8,8,8]),[older,entry([9,9,9])]).action).toBe('maintain')});
});
describe('workout data',()=>{
const session=()=>({id:'s',name:'Push',date:'2026-10-21',status:'complete' as const,exercises:[entry()]});
it('calculates logged volume',()=>expect(volume(session())).toBe(1440));
it('rejects invalid completed reps',()=>{const s=session();s.exercises[0].sets[0].reps=0;expect(validateSession(s)).toBeTruthy()});
it('rejects negative weights and fractional reps',()=>{const s=session();s.exercises[0].sets[0].weight=-1;expect(validateSession(s)).toBeTruthy();s.exercises[0].sets[0].weight=40;s.exercises[0].sets[0].reps=1.5;expect(validateSession(s)).toBeTruthy()});
it('labels high rep estimates unavailable',()=>expect(estimatedMax({...entry().sets[0],reps:20})).toBeNull());
});

describe('microloading',()=>{it('suggests available smaller jump after a successful lower load',()=>{const prior=entry();const now=entry([7,7,7]);now.sets.forEach(s=>s.weight=45);now.increment=1;expect(recommend(now,[prior])).toMatchObject({action:'smaller',weight:41})});it('holds when current effort is unknown',()=>{const prior=entry();const now=entry([7,7,7],null);now.sets.forEach(s=>s.weight=45);now.increment=1;expect(recommend(now,[prior]).action).toBe('maintain')})});

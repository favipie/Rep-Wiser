import { z } from 'zod';
export const setSchema = z.object({id:z.string(),weight:z.number().min(0).max(1500),reps:z.number().int().min(0).max(200),rir:z.number().min(0).max(10).nullable(),done:z.boolean(),warmup:z.boolean()});
export type LiftSet=z.infer<typeof setSchema>;
export type Exercise={id:string;name:string;muscle:string;secondary:string[];equipment:string;movement:string;min:number;max:number;increment:number;notes:string};
export type Performed={id:string;exerciseId:string;name:string;muscle:string;min:number;max:number;increment:number;required:number;sets:LiftSet[];notes:string;pain:boolean;technique:boolean;override:number|null};
export type Session={id:string;name:string;date:string;status:'draft'|'complete';exercises:Performed[]};
export type Template={id:string;name:string;days:number[];exercises:Performed[]};
export type Preferences={goal:string;experience:string;units:'kg'|'lb';split:string;days:number;equipment:string[];increment:number;rirMin:number;rirMax:number};
export type Data={preferences:Preferences|null;custom:Exercise[];templates:Template[];sessions:Session[]};
export const blankData=():Data=>({preferences:null,custom:[],templates:[],sessions:[]});
export const uid=()=>crypto.randomUUID();
export const defaultPreferences:Preferences={goal:'Hypertrophy',experience:'Beginner',units:'kg',split:'Upper / Lower',days:4,equipment:['Barbell','Dumbbell','Cable','Machine'],increment:2.5,rirMin:1,rirMax:3};
export const emptySet=():LiftSet=>({id:uid(),weight:0,reps:0,rir:null,done:false,warmup:false});
export function perform(e:Exercise):Performed{return {id:uid(),exerciseId:e.id,name:e.name,muscle:e.muscle,min:e.min,max:e.max,increment:e.increment,required:3,sets:Array.from({length:3},emptySet),notes:'',pain:false,technique:true,override:null}}
export const working=(e:Performed)=>e.sets.filter(s=>s.done&&!s.warmup);
export const volume=(s:Session)=>s.exercises.reduce((n,e)=>n+working(e).reduce((v,x)=>v+x.weight*x.reps,0),0);
export const estimatedMax=(s:LiftSet)=>s.reps>0&&s.reps<=12?s.weight*(1+s.reps/30):null;
export function validateSession(s:Session):string|null {
 if(!s.name.trim())return 'Give your workout a name.';
 for(const e of s.exercises){if(e.min<1||e.max<e.min||e.required<1||e.increment<0)return 'Check the rep range, required sets and increment.';for(const set of e.sets){if(!setSchema.safeParse(set).success)return 'Use valid positive weights, whole reps, and RIR from 0 to 10.';if(set.done&&set.reps===0)return 'Completed sets need at least one rep.'}}
 return null;
}

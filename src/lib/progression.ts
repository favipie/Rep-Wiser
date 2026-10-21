import { working, type Performed, type Preferences } from './model';
export type Recommendation={action:'increase'|'smaller'|'maintain'|'review'|'override';weight:number|null;reason:string};
export function recommend(current:Performed, history:Performed[]=[], prefs:Pick<Preferences,'rirMin'|'rirMax'>={rirMin:1,rirMax:3}):Recommendation {
 const sets=working(current);const weight=sets[0]?.weight??null;
 const result=(action:Recommendation['action'],reason:string,w=weight):Recommendation=>({action,weight:w,reason});
 if(current.pain||!current.technique)return result('review','A pain or technique concern was recorded. Resolve it before adding load.');
 if(current.override!==null)return result('override','Your chosen next load overrides the calculated suggestion.',current.override);
 if(sets.length<current.required)return result('maintain','Complete all prescribed working sets before evaluating progression.');
 if(!sets.every(s=>s.weight===weight))return result('maintain','Working loads differ. Compare consistent working sets before increasing.');
 const comparable=history.filter(e=>working(e).length===sets.length&&working(e).every(s=>s.weight===weight)&&e.min===current.min&&e.max===current.max).slice(-2);
 const totals=[...comparable,current].map(e=>working(e).reduce((n,s)=>n+s.reps,0));
 if(comparable.length===2&&((totals[2]<totals[1]&&totals[1]<totals[0])||[...comparable,current].every(e=>working(e).some(s=>s.reps<current.min))))return result('review','Performance declined across three comparable sessions, or minimum reps were repeatedly missed. Review recovery and training demands.');
 const prior=history.at(-1);const priorSets=prior?working(prior):[];const priorLoad=priorSets[0]?.weight;
 if(sets.some(s=>s.reps<current.min)&&sets.every(s=>s.rir!==null&&s.rir>=prefs.rirMin&&s.rir<=prefs.rirMax)&&prior&&!prior.pain&&prior.technique&&priorSets.length>=current.required&&prior.min===current.min&&prior.max===current.max&&priorSets.every(s=>s.weight===priorLoad&&s.reps>=prior.max&&s.rir!==null&&s.rir>=prefs.rirMin&&s.rir<=prefs.rirMax)&&priorLoad!==undefined&&weight!==null&&current.increment>0&&weight-priorLoad>current.increment)return result('smaller','The previous successful load met your targets, but the larger jump missed the minimum. Consider the smaller available increment.',Math.round((priorLoad+current.increment)*100)/100);
 if(sets.some(s=>s.reps<current.min))return result('maintain','A minimum rep target was missed. One session alone does not establish a trend; reassess next time.');
 if(sets.some(s=>s.rir===null))return result('maintain','RIR is missing. Keep the load and record effort before considering an increase.');
 if(!sets.every(s=>s.reps>=current.max))return result('maintain','Build reps within your target range. All prescribed working sets must reach the upper target.');
 if(!sets.every(s=>s.rir!>=prefs.rirMin&&s.rir!<=prefs.rirMax))return result('maintain','Your recorded RIR is outside the configured effort range. Review effort before adding load.');
 if(current.increment<=0)return result('maintain','No available weight increment is configured.');
 return result('increase','All working sets reached the upper rep target with the configured RIR and no concerns. Try the smallest configured increment; return toward the lower rep target.',Math.round((weight!+current.increment)*100)/100);
}

import type { Exercise } from './model';
const rows:[string,string,string,string,string[]][]=[
['Bench press','Chest','Barbell','Horizontal push',['Triceps','Shoulders']],['Incline dumbbell press','Chest','Dumbbell','Incline push',['Triceps']],['Cable fly','Chest','Cable','Adduction',[]],
['Lat pulldown','Back','Cable','Vertical pull',['Biceps']],['Barbell row','Back','Barbell','Horizontal pull',['Biceps']],['Seated cable row','Back','Cable','Horizontal pull',['Biceps']],
['Overhead press','Shoulders','Barbell','Vertical push',['Triceps']],['Lateral raise','Shoulders','Dumbbell','Abduction',[]],['Face pull','Shoulders','Cable','Horizontal pull',['Back']],
['Dumbbell curl','Biceps','Dumbbell','Elbow flexion',[]],['Hammer curl','Biceps','Dumbbell','Elbow flexion',[]],['Triceps pushdown','Triceps','Cable','Elbow extension',[]],
['Back squat','Quadriceps','Barbell','Squat',['Glutes']],['Leg press','Quadriceps','Machine','Squat',['Glutes']],['Leg extension','Quadriceps','Machine','Knee extension',[]],
['Romanian deadlift','Hamstrings','Barbell','Hinge',['Glutes']],['Leg curl','Hamstrings','Machine','Knee flexion',[]],['Hip thrust','Glutes','Barbell','Hip extension',[]],
['Standing calf raise','Calves','Machine','Plantar flexion',[]],['Cable crunch','Core','Cable','Trunk flexion',[]],['Push-up','Chest','Bodyweight','Horizontal push',['Triceps']],['Pull-up','Back','Bodyweight','Vertical pull',['Biceps']]
];
export const exercises:Exercise[]=rows.map(([name,muscle,equipment,movement,secondary],i)=>({id:'exercise-'+i,name,muscle,equipment,movement,secondary,min:equipment==='Barbell'?6:8,max:equipment==='Barbell'?10:15,increment:equipment==='Dumbbell'?1:equipment==='Bodyweight'?0:2.5,notes:equipment==='Bodyweight'?'Log added load only; zero means bodyweight.':'Use a controlled range of motion you can repeat.'}));

export const DEF_GROUPS = [
  {id:'g1',name:'Lower',mode:'core',active:true,required:1,exercises:[
    {id:'e1',name:'Leg Press',enabled:true},{id:'e2',name:'Leg Extension',enabled:true},
    {id:'e3',name:'Leg Curl',enabled:true},{id:'e4',name:'Goblet Squat',enabled:true},
    {id:'e5',name:'Romanian Deadlift',enabled:true},{id:'e6',name:'Walking Lunges',enabled:true}]},
  {id:'g2',name:'Shoulders',mode:'core',active:true,required:1,exercises:[
    {id:'e7',name:'Shoulder Press',enabled:true},{id:'e8',name:'Shrugs',enabled:true},
    {id:'e9',name:'Lateral & Front Raise Combo',enabled:true},{id:'e10',name:'Face Pull',enabled:true}]},
  {id:'g3',name:'Triceps',mode:'core',active:true,required:1,exercises:[
    {id:'e11',name:'Extension',enabled:true},{id:'e12',name:'Pushdown',enabled:true},{id:'e13',name:'Skull Crusher',enabled:true}]},
  {id:'g4',name:'Lower Arm / Biceps',mode:'core',active:true,required:1,exercises:[
    {id:'e14',name:'Preacher Curls',enabled:true},{id:'e15',name:'Wrist Curl',enabled:true},
    {id:'e16',name:'Hammer Curls',enabled:true},{id:'e17',name:'Single Arm Row',enabled:true},{id:'e18',name:'Upright Row',enabled:true}]},
  {id:'g5',name:'Chest',mode:'core',active:true,required:1,exercises:[
    {id:'e19',name:'Butterflies',enabled:true},{id:'e20',name:'Chest Press',enabled:true},{id:'e21',name:'Incline Chest Press',enabled:true}]},
  {id:'g6',name:'Back',mode:'core',active:true,required:1,exercises:[
    {id:'e22',name:'Row Machine',enabled:true},{id:'e23',name:'Lat Pull Downs',enabled:true},
    {id:'e24',name:'Barbell Pullover',enabled:true},{id:'e25',name:'Bent Over Row',enabled:true}]}
];

export const DEF_CFG = {bonusSlots:2, weightIncrement:5, streakMode:'weekly', streakGoal:3, restTimer:{enabled:false,duration:60}, profile:{weight:'',weightUnit:'lbs',height:'',heightUnit:'in',age:'',sex:'male'}, accentColor:null, cardPrefs:{showCues:true,showLastSession:true,showGroupLabel:true}, gamificationPrefs:{showHeaderBadge:true,showXPBar:true}, schemes:['3×10','3×12','4×10']};

export const DEF_MACHINES = [
  {id:'m1',icon:'🏃',name:'Treadmill',metric:'Distance',unit:'mi'},
  {id:'m2',icon:'⭕',name:'Elliptical',metric:'Distance',unit:'mi'},
  {id:'m3',icon:'🪜',name:'Stair Climber',metric:'Floors',unit:'fl'},
  {id:'m4',icon:'🚲',name:'Stationary Bike',metric:'Distance',unit:'mi'}
];

export const THEME_BASES = [
  {id:'dark',  label:'DARK',  bg:'#080808', text:'#ececec', dots:['#e8271f','#aaa','#0f0f0f']},
  {id:'light', label:'LIGHT', bg:'#f0eeeb', text:'#1a1a1a', dots:['#c8102e','#555','#faf9f7']},
];

export const EFFORT_LABELS = ['','Easy','Good','Hard','Max'];
export const EFFORT_COLORS = ['','#16a34a','#ca8a04','#dc2626','#aaa'];

export const GIST_FILENAME = 'forge-backup.json';

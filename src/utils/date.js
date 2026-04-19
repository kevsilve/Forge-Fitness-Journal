const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const DAYS_OF_WEEK = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

export function dotw(iso) { return DAYS[new Date(iso+'T12:00:00').getDay()]; }
export function fmtDate(iso) { return new Date(iso+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }
export function todayISO() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function isoFromDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function getWeekStart(offset) {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - ((now.getDay()+6)%7) + offset*7); // Monday-anchored
  d.setHours(0,0,0,0);
  return d;
}

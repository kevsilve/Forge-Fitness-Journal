import { dc } from './utils/misc.js';

export function ld(k, d) {
  try {
    const v = localStorage.getItem(k);
    return v != null ? JSON.parse(v) : dc(d);
  } catch(e) {
    console.warn('ld failed for', k, e);
    return dc(d);
  }
}

export function sv(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch(e) {
    if(e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      // toast may not be defined during early boot — guard it
      if(typeof toast === 'function') toast('⚠️ Storage full — clear old sessions to free space', 5000);
    }
    console.error('sv failed for', k, e);
  }
}

// 3725 → « 1 h 02 » ; 95 → « 1 min 35 »
export function fmtSeconds(s) {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')}`;
  if (m) return `${m} min ${String(sec).padStart(2, '0')}`;
  return `${sec} s`;
}

// Live stopwatch display: 01:02:05
export const clock = s => {
  const n = Math.max(0, Math.floor(s));
  return [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':');
};

// Staff availability (dashboard_users.availability) — text + color dot, never color alone
export const AVAILABILITY = {
  available: { label: 'Disponible', dot: 'bg-emerald-400' },
  busy:      { label: 'Occupé',     dot: 'bg-amber-400' },
  away:      { label: 'Absent',     dot: 'bg-ink-4' },
};
export const availabilityLabel = (s) => (s?.vacation_mode ? 'En vacances' : AVAILABILITY[s?.availability]?.label || 'Disponible');

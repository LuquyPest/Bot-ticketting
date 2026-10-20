// WCAG contrast helpers for colours chosen by a server (member space accent)
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// White or near-black text, whichever reads better on `bg`
export function readableText(bg) {
  if (!/^#[0-9a-f]{6}$/i.test(bg || '')) return '#ffffff';
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111827') ? '#ffffff' : '#111827';
}

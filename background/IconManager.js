/**
 * IconManager — updates the toolbar icon colour and badge based on session state.
 * Draws coloured squares into an OffscreenCanvas and sets them as the icon.
 */

const COLOURS = {
  deep_work: '#DC2626',
  shallow_work: '#D97706',
  break: '#16A34A',
  off: '#6B7280',
  cooldown: '#7C3AED'
};

const SIZES = [16, 48, 128];

function drawIcon(size, colour) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const radius = size * 0.2;
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(size, 0, size, size, radius);
  ctx.arcTo(size, size, 0, size, radius);
  ctx.arcTo(0, size, 0, 0, radius);
  ctx.arcTo(0, 0, size, 0, radius);
  ctx.closePath();
  ctx.fill();

  // Draw a small lock icon in white
  const lockSize = size * 0.45;
  const lx = (size - lockSize) / 2;
  const ly = (size - lockSize) / 2 + size * 0.05;

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  // Lock body
  const bw = lockSize * 0.7;
  const bh = lockSize * 0.5;
  const bx = lx + (lockSize - bw) / 2;
  const by = ly + lockSize * 0.45;
  const br = bw * 0.15;
  ctx.beginPath();
  ctx.moveTo(bx + br, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + bh, br);
  ctx.arcTo(bx + bw, by + bh, bx, by + bh, br);
  ctx.arcTo(bx, by + bh, bx, by, br);
  ctx.arcTo(bx, by, bx + bw, by, br);
  ctx.closePath();
  ctx.fill();

  // Lock shackle
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = size * 0.1;
  ctx.lineCap = 'round';
  const sw = bw * 0.5;
  const sx = bx + (bw - sw) / 2;
  const sy = by;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.arcTo(sx, ly, sx + sw, ly, sw * 0.5);
  ctx.arcTo(sx + sw, ly, sx + sw, sy, sw * 0.5);
  ctx.lineTo(sx + sw, sy);
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

export async function updateActionIcon(mode) {
  const colour = COLOURS[mode] ?? COLOURS.off;
  const imageData = {};
  for (const size of SIZES) {
    imageData[size] = drawIcon(size, colour);
  }

  await chrome.action.setIcon({ imageData });

  // Badge text
  if (mode === 'off') {
    await chrome.action.setBadgeText({ text: '' });
  } else {
    const labels = { deep_work: 'DW', shallow_work: 'SW', break: 'BR' };
    await chrome.action.setBadgeText({ text: labels[mode] ?? '' });
    await chrome.action.setBadgeBackgroundColor({ color: colour });
  }
}

export async function updateBadgeCountdown(remainingMs) {
  if (remainingMs <= 0) return;
  const minutes = Math.ceil(remainingMs / 60000);
  const text = minutes <= 99 ? String(minutes) : '99+';
  await chrome.action.setBadgeText({ text });
}

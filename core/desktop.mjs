export const FLOAT_SIZE = { width: 220, height: 242 };
export const petScale = settings => Number.isFinite(settings?.petScale) ? Math.max(.5, Math.min(1, settings.petScale)) : 1;
export const scaledFloatSize = (scale = 1, width = FLOAT_SIZE.width) => ({ width: Math.round(width * scale), height: Math.round(FLOAT_SIZE.height * scale) });

export function desktopUpgrade(state) {
  if (state.settings.desktopShellVersion === 1) return state;
  return {
    ...state,
    settings: { ...state.settings, floating: true, desktopShellVersion: 1 },
  };
}

export function floatPosition(saved, area, size = FLOAT_SIZE) {
  const x = Number.isFinite(saved?.x)
    ? saved.x
    : area.x + area.width - size.width - 24;
  const y = Number.isFinite(saved?.y)
    ? saved.y
    : area.y + area.height - size.height - 24;
  return {
    x: Math.round(
      Math.max(
        area.x,
        Math.min(x, area.x + Math.max(0, area.width - size.width)),
      ),
    ),
    y: Math.round(
      Math.max(
        area.y,
        Math.min(y, area.y + Math.max(0, area.height - size.height)),
      ),
    ),
  };
}

// A separate click-through bubble can sit above the pet without resizing its hit target.
export function bubblePosition(pet, area, bubble) {
  const x = Math.max(area.x, Math.min(
    Math.round(pet.x + (pet.width - bubble.width) / 2),
    area.x + area.width - bubble.width,
  ));
  const above = pet.y - bubble.height - 8;
  if (above >= area.y) return { x, y: above };
  const y = Math.max(area.y, Math.min(pet.y, area.y + area.height - bubble.height));
  const right = pet.x + pet.width + 8;
  if (right + bubble.width <= area.x + area.width) return { x: right, y };
  const left = pet.x - bubble.width - 8;
  if (left >= area.x) return { x: left, y };
  return { x, y: Math.max(area.y, Math.min(pet.y + pet.height + 8, area.y + area.height - bubble.height)) };
}

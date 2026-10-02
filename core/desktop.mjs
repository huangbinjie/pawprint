import {defaultSettings} from './defaults.mjs';
export const FLOAT_SIZE = { width: 220, height: 242 };
export const petScale = settings => Number.isFinite(settings?.petScale) ? Math.max(.5, Math.min(1, settings.petScale)) : 1;
export const scaledFloatSize = (scale = 1, width = FLOAT_SIZE.width) => ({ width: Math.round(width * scale), height: Math.round(FLOAT_SIZE.height * scale) });

export function desktopUpgrade(state) {
  const old = state.settings;
  const settings = {
    ...defaultSettings(old),
    ...(old.desktopShellVersion !== 1 ? { floating: true, desktopShellVersion: 1 } : {}),
    idleEnabled: typeof old.idleEnabled === 'boolean' ? old.idleEnabled : true,
    idleToys: typeof old.idleToys === 'boolean' ? old.idleToys : true,
  };
  if (Object.keys(settings).every(key => settings[key] === old[key])) return state;
  return { ...state, settings };
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

// Companion controls have their own hit target, bounded by the selected display.
export function companionPanelBounds(pet, area, preferred) {
  const width = Math.min(preferred.width, area.width);
  const height = Math.min(preferred.height, area.height);
  const position = bubblePosition(pet, area, { width, height });
  return { ...position, width, height };
}
export function petControlsBounds(pet,area,count){
  const width=Math.min(area.width,16+count*44+Math.max(0,count-1)*6),height=Math.min(56,area.height);
  const x=Math.max(area.x,Math.min(Math.round(pet.x+(pet.width-width)/2),area.x+area.width-width));
  const below=pet.y+pet.height+4;
  if(below+height<=area.y+area.height)return {x,y:below,width,height};
  const above=pet.y-height-4;
  if(above>=area.y)return {x,y:above,width,height};
  const pos=bubblePosition(pet,area,{width,height});return {...pos,width,height};
}

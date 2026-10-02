import test from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../core/game.mjs";
import { desktopUpgrade, floatPosition, FLOAT_SIZE } from "../core/desktop.mjs";
test("desktop upgrade enables the new shell once without changing pets or economy", () => {
  const state = initialState(1000);
  state.settings = { connected: true, floating: false };
  const upgraded = desktopUpgrade(state);
  assert.equal(upgraded.settings.floating, true);
  assert.equal(upgraded.settings.connected, true);
  assert.deepEqual({ ...upgraded, settings: state.settings }, state);
  assert.equal(state.settings.floating, false);
  upgraded.settings.floating = false;
  assert.equal(desktopUpgrade(upgraded), upgraded);
  assert.equal(desktopUpgrade(upgraded).settings.floating, false);
});
test("floating position survives negative-coordinate monitors and clamps removed-screen positions", () => {
  assert.deepEqual(
    floatPosition({ x: 50, y: 60 }, { x: 0, y: 25, width: 1440, height: 875 }),
    { x: 50, y: 60 },
  );
  assert.deepEqual(
    floatPosition(
      { x: 3000, y: 4000 },
      { x: 0, y: 25, width: 1440, height: 875 },
    ),
    { x: 1440 - FLOAT_SIZE.width, y: 900 - FLOAT_SIZE.height },
  );
  assert.deepEqual(
    floatPosition(
      { x: -1200, y: 100 },
      { x: -1440, y: 25, width: 1440, height: 875 },
    ),
    { x: -1200, y: 100 },
  );
  assert.deepEqual(
    floatPosition(
      { x: NaN, y: Infinity },
      { x: 0, y: 25, width: 1440, height: 875 },
    ),
    { x: 1440 - FLOAT_SIZE.width - 24, y: 900 - FLOAT_SIZE.height - 24 },
  );
});

test("bubble placement stays outside the pet hit box where the screen has room", async () => {
  const { bubblePosition } = await import("../core/desktop.mjs");
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  const size = { width: 210, height: 82 };
  assert.deepEqual(bubblePosition({ x: 600, y: 400, width: 110, height: 121 }, area, size), { x: 550, y: 310 });
  const nearTop = bubblePosition({ x: 600, y: 25, width: 110, height: 121 }, area, size);
  assert.ok(nearTop.x >= 710 || nearTop.x + size.width <= 600 || nearTop.y >= 146);
});

test('new homes roam and play by default; old explicit opt-outs survive migration', () => {
  const fresh = initialState(1000);
  assert.equal(fresh.settings.idleEnabled, true);
  assert.equal(fresh.settings.idleToys, true);
  const legacy = { ...fresh, settings: { connected: true, floating: false, desktopShellVersion: 1 } };
  const upgraded = desktopUpgrade(legacy);
  assert.equal(upgraded.settings.idleEnabled, true);
  assert.equal(upgraded.settings.idleToys, true);
  assert.equal(upgraded.settings.floating, false);
  const optedOut = { ...legacy, settings: { ...legacy.settings, idleEnabled: false, idleToys: false } };
  const preserved=desktopUpgrade(optedOut);assert.equal(preserved.settings.idleEnabled,false);assert.equal(preserved.settings.idleToys,false);assert.equal(desktopUpgrade(preserved),preserved);
});

test('separate work panels fit screen edges and displays with negative origins', async () => {
  const {companionPanelBounds} = await import('../core/desktop.mjs');
  for(const area of [{x:0,y:25,width:1440,height:875},{x:-1280,y:-300,width:1280,height:800},{x:0,y:0,width:280,height:360}]) {
    for(const pos of [{x:area.x,y:area.y},{x:area.x+area.width-110,y:area.y},{x:area.x+area.width-110,y:area.y+area.height-121}]) {
      const pet={...pos,width:110,height:121};
      const bounds=companionPanelBounds(pet,area,{width:350,height:580});
      assert.ok(bounds.x>=area.x&&bounds.y>=area.y);
      assert.ok(bounds.x+bounds.width<=area.x+area.width);
      assert.ok(bounds.y+bounds.height<=area.y+area.height);
      assert.deepEqual(pet,{...pos,width:110,height:121});
    }
  }
});
test('pet controls keep full-size targets at half pet scale and stay inside each display',async()=>{
 const {petControlsBounds}=await import('../core/desktop.mjs');
 for(const area of [{x:0,y:25,width:1440,height:875},{x:-1440,y:0,width:1440,height:900}])for(const scale of [.5,1]){
  const pet={x:area.x+600,y:area.y+100,width:220*scale,height:242*scale},dock=petControlsBounds(pet,area,3);
  assert.equal(dock.width,160);assert.equal(dock.height,56);assert.ok(dock.y>=pet.y+pet.height);assert.equal(pet.width,220*scale);
  const bottom=petControlsBounds({...pet,y:area.y+area.height-pet.height},area,4);assert.equal(bottom.width,210);assert.ok(bottom.y+bottom.height<=area.y+area.height-pet.height);
 }
});

test('fresh helpers start in English; migration preserves language, silence and every explicit opt-out',()=>{
 const fresh=initialState(1000);for(const key of ['connected','activityEnabled','activityTopics','attentionEnabled','quotaEnabled','idleEnabled','idleMouse','companionProactive'])assert.equal(fresh.settings[key],true,key);
 assert.equal(fresh.settings.language,'en');assert.equal(fresh.settings.workReminder,'quiet');
 const old={...fresh,settings:{language:'zh',connected:false,floating:false,desktopShellVersion:1,activityEnabled:false,activityTopics:false,attentionEnabled:false,quotaEnabled:false,idleEnabled:false,idleToys:false,idleMouse:false,companionProactive:false,workDnd:true,workReminder:'sound'}};
 const next=desktopUpgrade(old);for(const [k,v] of Object.entries(old.settings))assert.equal(next.settings[k],v,k);assert.equal(desktopUpgrade(next),next);assert.deepEqual({...next,settings:old.settings},old);
});

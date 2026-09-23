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

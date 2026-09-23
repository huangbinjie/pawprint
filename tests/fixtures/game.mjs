import { initialState, transition } from "../../core/game.mjs";
import { dayKey } from "../../core/economy.mjs";
import { Store } from "../../core/store.mjs";
export async function seedMatureCompanion(directory, now = Date.now()) {
  let seq = 0;
  const born = now - 2 * 86400000;
  let state = initialState(born);
  const act = (command, time) =>
    (state = transition(state, command, {
      now: time,
      rng: () => 0,
      id: () => `seed-${++seq}`,
    }));
  act({ type: "connect" }, born);
  act({ type: "free-egg" }, born);
  act({ type: "hatch", eggId: state.eggs[0].id }, born);
  act({ type: "rename", petId: state.pets[0].id, name: "松露" }, born);
  for (let i = 0; i < 2; i++) {
    const at = born + i * 86400000;
    act(
      {
        type: "observe",
        report: {
          complete: true,
          fresh: true,
          unpriced: 0,
          sourceId: "seed-history",
          days: [{ date: dayKey(at), tokens: 1000, usd: 15, unpriced: 0 }],
        },
      },
      at,
    );
    act({ type: "claim" }, at);
  }
  act({ type: "disconnect" }, now);
  const store = new Store(directory);
  await store.load(now);
  await store.save(state);
  return state;
}

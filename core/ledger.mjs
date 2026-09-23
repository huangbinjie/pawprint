import { availableCoins } from "./economy.mjs";
export function entry(state, amount, kind, label, now, id) {
  if (
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(state.balance + amount) ||
    state.balance + amount < 0 ||
    (amount < 0 && availableCoins(state) < -amount)
  )
    throw new Error("可用宠物币不够，部分金额可能正在等待局域网配种确认。");
  state.balance += amount;
  state.ledger.unshift({
    id: id(),
    at: now,
    amount,
    kind,
    label,
    balance: state.balance,
  });
}

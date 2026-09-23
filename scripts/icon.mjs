import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";
const svg = await readFile(new URL("../build/icon.svg", import.meta.url));
await writeFile(
  new URL("../build/icon.png", import.meta.url),
  new Resvg(svg).render().asPng(),
);
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><g fill="black"><ellipse cx="5" cy="10" rx="2.5" ry="3.2" transform="rotate(-25 5 10)"/><ellipse cx="9.5" cy="5.5" rx="2.4" ry="3.1"/><ellipse cx="15" cy="6" rx="2.4" ry="3.1" transform="rotate(15 15 6)"/><ellipse cx="19.1" cy="11.2" rx="2.3" ry="3" transform="rotate(25 19.1 11.2)"/><path d="M6.5 15C9 10.3 13 10 15.5 13C17 15 19 16 18 19C17 22 14 20.7 12 20.4C10 20.5 8 22 6.4 20C5.2 18.5 5.6 16.5 6.5 15Z"/></g></svg>`;
await writeFile(
  new URL("../build/trayTemplate.png", import.meta.url),
  new Resvg(traySvg).render().asPng(),
);
await writeFile(
  new URL("../build/trayTemplate@2x.png", import.meta.url),
  new Resvg(traySvg, { fitTo: { mode: "zoom", value: 2 } }).render().asPng(),
);

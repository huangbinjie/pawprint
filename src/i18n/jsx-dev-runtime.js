import { jsxDEV as base, Fragment } from "react/jsx-dev-runtime";
import { localizeProps } from "./locale.js";
export { Fragment };
export const jsxDEV = (type, props, ...args) => base(type, localizeProps(type, props), ...args);

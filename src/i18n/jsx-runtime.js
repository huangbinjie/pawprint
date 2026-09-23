import { jsx as baseJsx, jsxs as baseJsxs, Fragment } from "react/jsx-runtime";
import { localizeProps } from "./locale.js";
export { Fragment };
export const jsx = (type, props, key) => baseJsx(type, localizeProps(type, props), key);
export const jsxs = (type, props, key) => baseJsxs(type, localizeProps(type, props), key);

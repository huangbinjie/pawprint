import React from "react";
export default function RawText({ children }) {
  return <span translate="no" data-user-text="" style={{ whiteSpace: "pre-wrap" }}>{children}</span>;
}

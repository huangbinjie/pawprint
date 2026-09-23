import React, { useId } from "react";
export default function Egg({ className = "", ready = false }) {
  const id = useId().replaceAll(":", "");
  return (
    <svg
      className={`egg ${className} ${ready ? "ready" : ""}`}
      viewBox="0 0 200 230"
      role="img"
      aria-label={ready ? "准备孵化的宠物蛋" : "正在孵化的宠物蛋"}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FAEDD3" />
          <stop offset=".6" stopColor="#EBD7B4" />
          <stop offset="1" stopColor="#CAB990" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="211" rx="60" ry="9" fill="#5E5339" opacity=".12" />
      <g className="egg-shell">
        <path
          d="M100 25 C137 25 168 105 164 150 C160 204 41 207 36 150 C32 105 65 25 100 25Z"
          fill={`url(#${id})`}
        />
        <g fill="#AAA886" opacity=".6">
          <ellipse
            cx="77"
            cy="80"
            rx="9"
            ry="13"
            transform="rotate(-20 77 80)"
          />
          <ellipse cx="122" cy="126" rx="12" ry="9" />
          <ellipse cx="65" cy="153" rx="7" ry="10" />
          <circle cx="127" cy="171" r="6" />
          <circle cx="110" cy="62" r="5" />
        </g>
        <path
          d="M56 108 Q65 69 83 54"
          stroke="#fff"
          strokeWidth="8"
          opacity=".38"
          strokeLinecap="round"
        />
        {ready && (
          <path
            d="M78 29 L92 68 L82 88 L112 105 L96 129"
            fill="none"
            stroke="#A79672"
            strokeWidth="3"
          />
        )}
      </g>
    </svg>
  );
}

import React, { useId } from "react";
import { phenotype, TRAITS } from "../../core/genetics.mjs";
export default function Cat({
  genome,
  className = "",
  mood = "idle",
  label = "基因猫咪",
  onClick,
  talentId = null,
  talentLevel = 1,
  skillId = null,
}) {
  const uid = useId().replaceAll(":", ""),
    p = phenotype(genome),
    coat = TRAITS.coat[p.coat],
    eyes = TRAITS.eyes[p.eyes],
    eye = TRAITS.eyeSize[p.eyeSize],
    body = TRAITS.body[p.body],
    face = TRAITS.face[p.face],
    spacing = TRAITS.eyeSpacing[p.eyeSpacing],
    pupil = TRAITS.pupil[p.pupil],
    muzzle = TRAITS.muzzle[p.muzzle],
    nose = TRAITS.nose[p.nose],
    patternLayout = TRAITS.patternScale[p.patternScale];
  const noEars = TRAITS.ears[p.ears].absent === true;
  const noTail = TRAITS.tail[p.tail].absent === true;
  const timing = [...uid].reduce((n, c) => n + c.charCodeAt(0), 0);
  const headShape =
    face.shape ??
    (p.face === 3 ? "square" : p.face === 6 ? "triangle" : "round");
  const headPath =
    headShape === "square"
      ? "M69 103 Q70 78 96 77 L182 77 Q211 82 211 107 L211 167 Q210 198 181 199 L97 199 Q67 192 67 168Z"
      : headShape === "triangle"
        ? "M64 120 Q68 74 116 74 Q170 62 204 101 Q223 125 195 159 L155 194 Q137 211 119 193 L76 159Z"
        : headShape === "heart"
          ? "M65 116C61 81 102 60 138 82C172 59 214 80 211 118C209 155 169 185 139 202C104 182 71 157 65 116Z"
          : "M64 148 C59 106 82 78 112 75 C137 65 169 71 187 86 C214 103 223 135 211 160 C204 185 177 202 139 201 C103 202 76 187 64 164Z";
  const belly = body.belly ?? 0;
  const bodyPath = `M98 172 Q${85 - belly} 192 ${91 - belly} 247 Q${93 - belly} 270 124 270 L171 270 Q${200 + belly} 270 ${195 + belly} 237 Q${194 + belly} 194 177 177Z`;
  const patterns = (
    <g
      fill={coat.shade}
      opacity=".75"
      transform={`translate(139 170) rotate(${patternLayout.rotation}) scale(${patternLayout.sx} ${patternLayout.sy}) translate(-139 -170)`}
    >
      {p.pattern === 1 && (
        <>
          <path d="M103 72L113 106L126 79Z M133 71L144 105L153 74Z M170 79L172 110L187 90Z" />
          <path d="M65 139L92 147L66 155Z M68 162L94 164L75 177Z M215 135L190 146L217 151Z M215 159L190 163L207 176Z M101 202L118 218L97 217Z M96 225L120 233L94 240Z M186 204L165 222L189 218Z" />
        </>
      )}
      {p.pattern === 2 &&
        [
          [87, 121, 12, 10],
          [164, 100, 17, 11],
          [184, 165, 13, 9],
          [108, 181, 11, 8],
          [119, 218, 12, 8],
          [167, 235, 14, 10],
          [87, 154, 7, 6],
        ].map(([x, y, rx, ry], i) => (
          <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} />
        ))}
      {p.pattern === 3 && (
        <>
          <path d="M148 62C175 66 223 70 225 128C208 159 172 151 155 128C144 108 139 88 148 62Z" />
          <ellipse cx="180" cy="217" rx="27" ry="32" />
        </>
      )}
      {p.pattern === 4 && (
        <>
          <path d="M64 90L98 76L116 90L105 108L127 125L104 145L83 131L66 145Z M146 153L163 133L188 145L198 168L179 185L148 179Z M101 211L127 199L148 218L137 248L109 249Z" />
          <ellipse cx="177" cy="91" rx="14" ry="7" />
          <ellipse cx="178" cy="241" rx="12" ry="18" />
        </>
      )}
      {p.pattern === 5 && (
        <>
          <path d="M93 184Q147 215 195 184L210 232Q157 206 90 239Z" />
          <path d="M80 78Q138 50 207 79L197 105Q137 93 76 105Z" />
        </>
      )}
      {p.pattern === 6 &&
        Array.from({ length: 9 }, (_, i) => (
          <path
            key={i}
            d={`M${69 + i * 17} 57 Q${83 + i * 14} 106 ${77 + i * 16} 156 M${95 + i * 12} 198l-5 51`}
            fill="none"
            stroke={coat.shade}
            strokeWidth="3"
            opacity=".65"
          />
        ))}
      {p.pattern === 7 && (
        <>
          <path d="M62 61H143V200H63Z M145 192H204V267H145Z" fill="#594A40" />
          <path
            d="M121 77Q170 75 185 113L149 128L174 155L152 197L120 166L104 181L91 146L120 126Z M93 204L144 227L126 263L85 252Z"
            fill="#CB985C"
          />
        </>
      )}
    </g>
  );
  const furTexture = (
    <g
      stroke={coat.shade}
      opacity={p.fur === 5 ? 0.25 : 0.38}
      strokeWidth={p.fur === 1 ? 1.5 : 2}
      strokeLinecap="round"
    >
      {p.fur === 1 &&
        Array.from({ length: 20 }, (_, i) => (
          <path
            key={i}
            d={`M${80 + ((i * 31) % 116)} ${85 + ((i * 23) % 175)}l2 3`}
          />
        ))}
      {(p.fur === 2 || p.fur === 3) &&
        Array.from({ length: p.fur === 3 ? 22 : 12 }, (_, i) => (
          <path
            key={i}
            d={`M${78 + ((i * 37) % 125)} ${90 + ((i * 29) % 170)}l-5 -9l9 5`}
            fill="none"
          />
        ))}
      {p.fur === 4 &&
        Array.from({ length: 12 }, (_, i) => (
          <path key={i} d={`M${86 + i * 10} 174q-6 38 0 75`} fill="none" />
        ))}
      {p.fur === 5 && (
        <path
          d="M95 105Q120 78 166 87 M106 214Q110 242 117 249"
          stroke="#FFF"
          strokeWidth="5"
          fill="none"
        />
      )}
    </g>
  );
  const earPairs = [
    [
      "M74 111L65 49Q67 42 76 47L118 82Z",
      "M163 82L207 45Q215 44 216 54L211 118Z",
    ],
    null,
    [
      "M72 119Q51 100 68 82Q83 69 114 83L95 108Z",
      "M166 82Q200 64 217 85Q231 105 207 119L185 105Z",
    ],
    [
      "M77 121L40 69Q37 58 50 59L118 82Z",
      "M163 82L227 58Q239 58 235 74L207 121Z",
    ],
    ["M74 114L67 38Q74 32 86 52L115 84Z", "M163 82Q227 74 217 113L191 112Z"],
    [
      "M72 116L57 25Q60 17 70 27L120 84Z",
      "M162 83L215 22Q224 17 223 30L212 121Z",
    ],
    [
      "M73 111L58 45L66 26L70 44L78 29L81 51L116 83Z",
      "M164 84L202 46L210 28L213 48L221 35L219 67L210 116Z",
    ],
  ];
  const tailPaths = [
    "M184 248C246 265 273 242 259 217C246 196 237 200 239 182",
    "M184 247C270 274 270 180 242 182C216 184 225 220 246 209",
    "M184 242Q216 249 214 231",
    "M184 248C246 270 279 249 272 214Q267 182 253 175",
    "M183 249Q239 264 258 220L271 202",
    "M184 249Q250 269 258 233L258 168Q250 153 240 166",
    "M188 245Q214 256 219 243",
  ];
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 -25 310 335"
      style={{ "--blink-time": `${5.7 + timing % 7 * .37}s`, "--blink-delay": `${-(timing % 4)}s`, "--tail-angle": `${[2,6].includes(p.tail) ? -2 : p.tail === 1 ? -3 : -5}deg`, "--ear-angle": `${p.ears === 2 ? 2 : 4}deg` }}
      data-ears={noEars ? "absent" : "present"}
      data-tail={noTail ? "absent" : "present"}
      className={`cat gentle-cat ${noTail && skillId === "chase" ? "tailless-look" : ""} ${className} ${mood} ${skillId ? `skill-${skillId}` : ""} ${talentId ? `perform talent-${talentId} talent-level-${talentLevel}` : ""}`}
      onClick={onClick}
      data-phenotype={JSON.stringify(p)}
    >
      {talentId && talentLevel >= 2 && (
        <g className="talent-sparkles" fill="#D5B767">
          {[0, 1, 2, ...(talentLevel >= 3 ? [3, 4] : [])].map((i) => (
            <path
              key={i}
              transform={`translate(${55 + i * 47} ${50 + (i % 2) * 24}) scale(${talentLevel >= 3 ? 1 : 0.65})`}
              d="M0-8L2-2L8 0L2 2L0 8L-2 2L-8 0L-2-2Z"
            />
          ))}
        </g>
      )}
      <defs>
        <clipPath id={`${uid}-skill-box`}><rect x="0" y="0" width="300" height="225" /></clipPath>
        <clipPath id={`${uid}-head`}>
          <path d={headPath} />
        </clipPath>
        <clipPath id={`${uid}-trunk`}>
          <path d={bodyPath} />
        </clipPath>
        <linearGradient id={`${uid}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".2" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse
        cx="150"
        cy="280"
        rx={76 * body.sx}
        ry="11"
        fill="#584731"
        opacity=".12"
      />
      <g
        clipPath={skillId === "box" ? `url(#${uid}-skill-box)` : undefined}
        transform={`translate(145 270) scale(${body.sx} ${body.sy}) translate(-145 -270)`}
      >
        <g className="cat-body">
          {!noTail && <g className="cat-tail" data-part="tail"><path
            d={tailPaths[p.tail]}
            fill="none"
            stroke={p.pattern === 0 ? coat.color : coat.shade}
            strokeWidth={
              p.tail === 3 ? 11 : p.tail === 4 ? 34 : p.tail === 6 ? 27 : 25
            }
            strokeLinecap="round"
          />
          {p.tail === 4 && (
            <path
              d="M234 248l5-15 9 6-2-18 14 6-3-20 15 5"
              fill="none"
              stroke={coat.color}
              strokeWidth="5"
            />
          )}
          </g>}
          <path d={bodyPath} fill={coat.color} />
          <g clipPath={`url(#${uid}-trunk)`}>
            {patterns}
            {furTexture}
          </g>
          {p.white === 0 && (
            <path
              d="M112 183Q139 175 169 183L180 211L145 236L109 213Z"
              fill="#F7F2E6"
            />
          )}
          {p.white === 3 && (
            <path
              d="M121 188Q141 181 164 188L160 210L141 218L122 208Z"
              fill="#F7F2E6"
            />
          )}
          {p.white === 5 && (
            <path
              d="M157 197Q196 211 177 246Q142 250 148 227Z"
              fill="#F7F2E6"
            />
          )}
          {(p.fur === 2 || p.fur === 3 || p.fur === 4) && (
            <path
              d={
                p.fur === 3
                  ? "M95 199l-14 9 9 5-13 15 13-2-10 20 14-7 M189 200l13 8-7 6 12 16-13-4 9 19-13-5"
                  : "M94 212l-8 13 6-2-5 18 8-4 M190 212l9 13-6-2 5 18-8-4"
              }
              fill={coat.color}
            />
          )}
          <g
            transform={`translate(139 139) scale(${face.sx} ${face.sy}) translate(-139 -139)`}
          >
            {!noEars && [0, 1].map(i => <g key={i} className={`gentle-ear gentle-ear-${i}`} data-part="ear" style={{ transformOrigin: `${i ? 188 : 87}px 108px` }}>
              {p.ears === 1
                ? <ellipse cx={i ? 192 : 83} cy={i ? 90 : 91} rx="29" ry="30" fill={coat.color} />
                : <path d={earPairs[p.ears][i]} fill={coat.color} />}
              {p.ears === 0 && <path d={i ? "M184 82L206 57L205 97Z" : "M76 96L73 58L100 82Z"} fill="#DBA5A0" />}
              {p.ears === 1 && <ellipse cx={i ? 194 : 81} cy="87" rx="16" ry="18" fill="#DBA5A0" opacity=".6" />}
            </g>)}
            {(p.fur === 2 || p.fur === 3 || p.fur === 4) && (
              <path
                d={
                  p.fur === 3
                    ? "M80 89l-13-12 3 18-18-4 10 17-19 5 21 12-21 9 20 7-14 21 23-3 M196 90l15-15-4 23 20-5-12 20 18 5-20 9 22 13-22 6 13 17-22-2"
                    : "M71 106l-10-5 3 13-11 4 11 9-8 12 12 2-5 14 12-2 M207 108l12-6-3 15 11 4-12 8 9 12-12 2 5 13-13-2"
                }
                fill={coat.color}
              />
            )}
            <path d={headPath} fill={coat.color} />
            <g clipPath={`url(#${uid}-head)`}>
              {patterns}
              {furTexture}
              {p.white === 4 && (
                <path d="M134 86L147 86L148 170L131 170Z" fill="#F7F2E6" />
              )}
              {p.white === 5 && (
                <ellipse cx="185" cy="148" rx="28" ry="33" fill="#F7F2E6" />
              )}
              {p.white === 6 && (
                <path d="M73 143Q140 181 208 141L220 208H60Z" fill="#F7F2E6" />
              )}
            </g>
            <path d={headPath} fill={`url(#${uid}-shine)`} />
            <g
              transform={`translate(137 166) scale(${muzzle.sx} ${muzzle.sy}) translate(-137 -166)`}
            >
              <ellipse
                cx="121"
                cy="166"
                rx="20"
                ry="16"
                fill={p.white === 2 ? coat.color : "#F4E9D5"}
              />
              <ellipse
                cx="151"
                cy="166"
                rx="20"
                ry="16"
                fill={p.white === 2 ? coat.color : "#F4E9D5"}
              />
            </g>
            {[104 - spacing.dx, 173 + spacing.dx].map((x, i) => (
              <g
                key={i}
                transform={`translate(${x} ${139 + (spacing.yOffset || 0) + (i ? spacing.dy : 0)})`}
              >
                <g className="cat-eye">
                  <g
                    transform={`scale(${eye.scale * (eye.sx || 1)} ${eye.scale * (eye.sy || 1)})`}
                  >
                    <ellipse rx="13" ry="16" fill="#FDFCF5" />
                    <ellipse
                      rx="9"
                      ry="12"
                      fill={i && eyes.other ? eyes.other : eyes.color}
                    />
                    <ellipse
                      rx={p.expression === 4 ? Math.min(pupil.rx, 3) : pupil.rx}
                      ry={pupil.ry}
                      fill="#33352F"
                    />
                    <circle cx="-3" cy="-6" r="3.4" fill="white" />
                    {[1, 3, 5].includes(p.expression) && (
                      <path
                        d={
                          p.expression === 1
                            ? "M-15-18H15V-1Q0-4-15-1Z"
                            : p.expression === 3
                              ? i
                                ? "M-15-18H15V3L-15-9Z"
                                : "M-15-18H15V-9L-15 3Z"
                              : "M-15-18H15V-5L-15 2Z"
                        }
                        fill={coat.color}
                      />
                    )}
                    {p.expression === 6 && (
                      <>
                        <ellipse rx="14" ry="17" fill={coat.color} />
                        <path
                          d="M-11 2Q0-12 11 2"
                          fill="none"
                          stroke="#505342"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </>
                    )}
                  </g>
                </g>
                {[2, 3, 5].includes(p.expression) && (
                  <path
                    d={
                      p.expression === 2
                        ? i
                          ? "M-13-23L11-27"
                          : "M-12-27L12-23"
                        : p.expression === 3
                          ? i
                            ? "M-12-19L12-25"
                            : "M-12-25L12-19"
                          : "M-12-25Q1-31 12-26"
                    }
                    stroke={coat.shade}
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                  />
                )}
              </g>
            ))}
            <path
              d="M130 159Q137 155 144 159L138 165Q136 166 135 164Z"
              fill={nose.color}
              transform={`translate(137 160) scale(${nose.sx} ${nose.sy}) translate(-137 -160)`}
            />
            <path
              d={
                p.expression === 4
                  ? "M134 171Q140 165 143 173Q139 182 134 171Z"
                  : p.expression === 3
                    ? "M137 165L137 171M128 176L146 176"
                    : p.expression === 2
                      ? "M137 165L137 171M128 174Q137 170 146 174"
                      : p.expression === 6
                        ? "M128 169Q138 184 150 168"
                        : "M137 165L137 170Q132 177 126 172M137 170Q142 177 148 172"
              }
              stroke="#705E50"
              strokeWidth="2.3"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M96 159L63 154M96 165L59 167M96 171L69 179M175 159L207 154M176 166L215 168M173 172L203 181"
              stroke={coat.shade}
              strokeWidth="1.7"
              fill="none"
              opacity=".6"
            />
          </g>
          <g
            fill={p.white === 1 ? "#F7F2E6" : coat.color}
            stroke={coat.shade}
            strokeOpacity=".35"
            strokeWidth="2"
          >
            <g className="cat-frontpaw-left">
              <path d="M108 236L106 262Q110 276 130 270L134 244" />
              <path
                d="M114 264L114 270M121 265L121 271"
                fill="none"
                strokeWidth="1.5"
              />
            </g>
            <g className="cat-frontpaw-right">
              <path d="M158 245L158 267Q172 277 183 265L180 238" />
              <path
                d="M167 265L167 272M174 264L174 271"
                fill="none"
                strokeWidth="1.5"
              />
            </g>
          </g>
          <path
            d="M109 196Q139 204 169 195"
            fill="none"
            stroke="#7C8D6A"
            strokeWidth="8"
          />
          <circle cx="140" cy="204" r="8" fill="#D9B867" />
          <circle cx="140" cy="204" r="3" fill="#AD8C4A" />
        </g>
      </g>
      {skillId === "box" && <g className="skill-box-object">
        <path d="M65 215L145 228L220 215L215 281L74 281Z" fill="#cfa677" stroke="#a57c50" strokeWidth="3" />
        <path d="M65 215L47 235L134 247L145 228L159 249L236 235L220 215" fill="#e4c295" stroke="#a57c50" strokeWidth="3" />
        <path d="M142 249v28" stroke="#b58957" strokeWidth="3" />
      </g>}
      {skillId === "ball" && <g className="skill-ball-object">
        <circle cx="190" cy="264" r="19" fill="#dda366" stroke="#a77543" strokeWidth="2" />
        <path d="M173 257q17 10 34 0M173 273q17-10 34 0M190 245q-15 19 0 38M190 245q15 19 0 38" fill="none" stroke="#fff4d6" strokeWidth="3" />
      </g>}
      {skillId === "starnap" && <g className="skill-dream-stars" fill="#e3bd65">
        {[0,1,2,3].map(i => <path key={i} transform={`translate(${45+i*61} ${55+(i%2)*25})`} d="M0-9L3-3L9 0L3 3L0 9L-3 3L-9 0L-3-3Z" />)}
      </g>}
    </svg>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

/*
  Marky, StudyMate's mascot. Pure SVG + a little JavaScript:
    * eyes follow the mouse pointer (pointermove -> move the pupils)
    * blinks at random intervals
    * moods change the face: idle, happy (^ ^), confused, wave
  Everything that touches `window` runs inside useEffect, which only runs
  in the browser, so server and browser render the same first HTML.
*/

export type MascotMood = "idle" | "happy" | "confused" | "wave";

const VIEW_W = 200; // SVG coordinate width; used to convert screen pixels
const EYE_Y = 96;   // eye centre height in SVG coordinates

export function Mascot({ mood = "idle", className }: { mood?: MascotMood; className?: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const faceRef = useRef<SVGGElement>(null);
  const pupilRefs = useRef<(SVGGElement | null)[]>([]);
  const [blinking, setBlinking] = useState(false);
  const reduceMotion = useReducedMotion();

  // ---- Eyes follow the pointer ----------------------------------------
  useEffect(() => {
    if (reduceMotion) return;
    let frame = 0;
    let px = 0;
    let py = 0;

    function update() {
      frame = 0;
      const svg = svgRef.current;
      if (!svg) return;
      const box = svg.getBoundingClientRect();
      const scale = box.width / VIEW_W;
      // Where Marky's eyes are on the screen, in pixels
      const cx = box.left + (VIEW_W / 2) * scale;
      const cy = box.top + EYE_Y * scale;
      const dx = px - cx;
      const dy = py - cy;
      const dist = Math.hypot(dx, dy) || 1;
      // Unit direction, scaled down when the pointer is close to the face
      const pull = Math.min(dist / (180 * scale), 1);
      const ux = (dx / dist) * pull;
      const uy = (dy / dist) * pull;

      // Set the SVG transform directly instead of using React state:
      // pointermove fires ~60 times a second, and re-rendering React that
      // often for two circles would be wasted work.
      pupilRefs.current.forEach((p) => p?.setAttribute("transform", `translate(${ux * 6} ${uy * 6})`));
      faceRef.current?.setAttribute("transform", `translate(${ux * 4} ${uy * 3})`);
    }

    function onMove(e: PointerEvent) {
      px = e.clientX;
      py = e.clientY;
      // requestAnimationFrame: at most one update per screen refresh
      if (!frame) frame = requestAnimationFrame(update);
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [reduceMotion]);

  // ---- Random blinking -------------------------------------------------
  useEffect(() => {
    if (reduceMotion) return;
    let timer: ReturnType<typeof setTimeout>;
    function scheduleBlink() {
      timer = setTimeout(() => {
        setBlinking(true);
        timer = setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 130);
      }, 2200 + Math.random() * 3200);
    }
    scheduleBlink();
    return () => clearTimeout(timer);
  }, [reduceMotion]);

  const eyesClosedHappy = mood === "happy" || mood === "wave";

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 200 230"
      role="img"
      aria-label="Marky, the StudyMate robot"
      className={cn("overflow-visible", className)}
    >
      {/* ground shadow, shrinks as Marky floats up */}
      <ellipse cx="100" cy="221" rx="46" ry="7" className="bot-shadow fill-foreground/15" />

      <g className="bot-bob">
        {/* antenna with a highlighter-yellow bulb */}
        <line x1="100" y1="46" x2="100" y2="26" className="stroke-foreground" strokeWidth="4" strokeLinecap="round" />
        <circle cx="100" cy="18" r="16" className="bot-glow fill-highlight/40" />
        <circle cx="100" cy="18" r="9" className="fill-highlight stroke-foreground" strokeWidth="3" />

        {/* ears */}
        <rect x="21" y="82" width="15" height="36" rx="7.5" className="fill-primary stroke-foreground" strokeWidth="4" />
        <rect x="164" y="82" width="15" height="36" rx="7.5" className="fill-primary stroke-foreground" strokeWidth="4" />

        {/* arms (drawn before the body so the shoulders tuck under it) */}
        <g className="stroke-foreground" strokeLinecap="round">
          <line x1="70" y1="174" x2="48" y2="196" strokeWidth="10" />
          <line x1="70" y1="174" x2="48" y2="196" strokeWidth="4" className="stroke-primary" />
        </g>
        <g className={cn("bot-arm", mood === "wave" && "bot-arm-wave")}>
          <line x1="130" y1="174" x2="152" y2="196" strokeWidth="10" strokeLinecap="round" className="stroke-foreground" />
          <line x1="130" y1="174" x2="152" y2="196" strokeWidth="4" strokeLinecap="round" className="stroke-primary" />
          <circle cx="153" cy="197" r="7" className="fill-card stroke-foreground" strokeWidth="3" />
        </g>
        <circle cx="47" cy="197" r="7" className="fill-card stroke-foreground" strokeWidth="3" />

        {/* body with a little highlighted page on the chest */}
        <rect x="64" y="154" width="72" height="54" rx="20" className="fill-primary stroke-foreground" strokeWidth="4" />
        <rect x="87" y="166" width="26" height="30" rx="4" className="fill-card" />
        <rect x="90" y="175" width="20" height="6" rx="2" className="fill-highlight" />
        <line x1="92" y1="187" x2="106" y2="187" className="stroke-foreground/50" strokeWidth="2.5" strokeLinecap="round" />

        {/* head + screen */}
        <rect x="32" y="44" width="136" height="112" rx="38" className="fill-card stroke-foreground" strokeWidth="4" />
        <rect x="48" y="61" width="104" height="78" rx="26" fill="var(--screen)" />

        {/* face: shifts slightly toward the pointer, like turning the head */}
        <g ref={faceRef} style={{ transition: "transform 120ms ease-out" }}>
          {eyesClosedHappy ? (
            <g fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round">
              <path d="M66 100 q12 -15 24 0" />
              <path d="M110 100 q12 -15 24 0" />
            </g>
          ) : (
            [78, 122].map((cx, i) => (
              <g
                key={cx}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  transform: blinking ? "scaleY(0.1)" : "scaleY(1)",
                  transition: "transform 90ms ease-in-out",
                }}
              >
                <circle cx={cx} cy={EYE_Y} r="15" fill="#ffffff" />
                <g ref={(el) => { pupilRefs.current[i] = el; }} style={{ transition: "transform 90ms ease-out" }}>
                  <circle cx={cx} cy={EYE_Y} r="8" fill="#171f4d" />
                  <circle cx={cx - 3} cy={EYE_Y - 3} r="2.6" fill="#ffffff" />
                </g>
              </g>
            ))
          )}

          {/* cheeks */}
          <ellipse cx="62" cy="121" rx="7" ry="4" fill="#ff8fb1" opacity="0.75" />
          <ellipse cx="138" cy="121" rx="7" ry="4" fill="#ff8fb1" opacity="0.75" />

          {/* mouth changes with mood */}
          {mood === "confused" ? (
            <path d="M86 123 q7 -7 14 0 t14 0" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
          ) : eyesClosedHappy ? (
            <path d="M86 115 q14 18 28 0 z" fill="#ff8fb1" stroke="#ffffff" strokeWidth="3.5" strokeLinejoin="round" />
          ) : (
            <path d="M89 117 q11 11 22 0" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
          )}
        </g>
      </g>
    </svg>
  );
}

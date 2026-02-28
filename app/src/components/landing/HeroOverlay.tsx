"use client";

import { useEffect } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnimFn = (...args: any[]) => any;

/**
 * Handles DOM animations for landing page elements
 * This component doesn't render anything - it only sets up animations
 */
export default function AnimationController() {
  useEffect(() => {
    let animate: AnimFn, stagger: AnimFn, inView: AnimFn;

    import("framer-motion/dom").then((m) => {
      animate = m.animate;
      stagger = m.stagger;
      inView = m.inView;

      const q = (sel: string) => Array.from(document.querySelectorAll(sel));

      // Initial page load animations
      animate(
        q(".landing-nav"),
        { opacity: [0, 1] },
        { duration: 1, delay: 0.3, easing: "ease-out" },
      );
      animate(
        q(".hero-eyebrow"),
        { opacity: [0, 1], x: [-8, 0] },
        { duration: 0.7, delay: 0.6, easing: "ease-out" },
      );
      animate(
        q(".hero-title"),
        { opacity: [0, 1], y: [24, 0] },
        { duration: 1.0, delay: 1.0, easing: [0.16, 1, 0.3, 1] },
      );
      animate(
        q(".hero-sub"),
        { opacity: [0, 1], y: [16, 0] },
        { duration: 0.8, delay: 1.45, easing: "ease-out" },
      );
      animate(
        q(".hero-actions"),
        { opacity: [0, 1], y: [10, 0] },
        { duration: 0.7, delay: 1.8, easing: "ease-out" },
      );
      animate(
        q(".stat"),
        { opacity: [0, 1], x: [20, 0] },
        {
          duration: 0.6,
          delay: stagger(0.2, { start: 1.6 }),
          easing: "ease-out",
        },
      );
      animate(
        q(".scroll-hint"),
        { opacity: [0, 1] },
        { duration: 0.8, delay: 2.8 },
      );

      // Scroll-triggered animations
      inView(
        ".section-header",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], y: [20, 0] },
            { duration: 0.6, easing: "ease-out" },
          );
        },
        { margin: "-80px" },
      );

      inView(
        ".feat-card",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], y: [32, 0] },
            { duration: 0.65, easing: [0.22, 1, 0.36, 1] },
          );
        },
        { margin: "-60px" },
      );

      inView(
        ".stages-title",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], y: [20, 0] },
            { duration: 0.7, easing: "ease-out" },
          );
        },
        { margin: "-80px" },
      );

      inView(
        ".stage-item",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], x: [-20, 0] },
            { duration: 0.55, easing: "ease-out" },
          );
        },
        { margin: "-60px" },
      );

      inView(
        ".cta-headline",
        ({ target }: { target: Element }) => {
          animate(
            target,
            { opacity: [0, 1], y: [20, 0] },
            { duration: 0.8, easing: "ease-out" },
          );
        },
        { margin: "-80px" },
      );

      inView(
        ".cta-btn",
        ({ target }: { target: Element }) => {
          animate(target, { opacity: [0, 1] }, { duration: 0.6, delay: 0.2 });
        },
        { margin: "-60px" },
      );
    });
  }, []);

  // This component doesn't render anything
  return null;
}

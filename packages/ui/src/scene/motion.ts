// GSAP, once. DESIGN 9.1: the camera and scripted beats belong to GSAP, and it knows the names of 9.2 from here. The DOM reads the
// same curves through custom properties, so a panel and a flight that use `settle` are the same curve.
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { BEZIER, cssEase, easePath, type EaseName } from '../core/ease.ts';

let done = false;

export function registerEases(): typeof gsap {
  if (done) return gsap;
  done = true;
  gsap.registerPlugin(CustomEase);
  for (const name of Object.keys(BEZIER) as EaseName[]) {
    CustomEase.create(name, easePath(name));
    document.documentElement.style.setProperty(`--${name}`, cssEase(name));
  }
  return gsap;
}

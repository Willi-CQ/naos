// Scene colours, the same hex values as the CSS tokens in DESIGN 5.1. THREE.Color converts them to linear.
import * as THREE from 'three';

export const HEX = {
  void: '#060504',
  pearl: '#EAF0F2',
  oiii: '#21E3BE',
  nad: '#FD9D4E',
  halpha: '#FC5466',
  lamp: '#B47800',
  ash: '#665F57',
  bone: '#BFB3A1',
  slag: '#94897A',
  rule: '#7C7062',
  meridian: '#8C7A66',
  now: '#FFE7D0',
  city: '#FFC77A',
  sliverFull: '#9FB8FF',
  sliverLow: '#FFB96E',
  starO: '#A2BBFF',
  starA: '#CDD9FF',
  starG: '#FFF2EB',
  starM: '#FFB96E',
  dust: '#FFD4A6',
} as const;

export type Token = keyof typeof HEX;

const cache = new Map<Token, THREE.Color>();

/** A shared linear colour. Treat it as read only. */
export function linear(token: Token): THREE.Color {
  let c = cache.get(token);
  if (!c) { c = new THREE.Color(HEX[token]); cache.set(token, c); }
  return c;
}

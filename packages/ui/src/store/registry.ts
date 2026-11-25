// Seams for the Hand. Overlays, slots, actions and keys register here, so docket/, launch/, ledger/ and sheets/ plug in without
// editing the shell. See src/hud/README.md.
import type { ComponentType, ReactNode } from 'react';

export type OverlayLayer = 'sheet' | 'docket' | 'palette' | 'dialog';

export interface OverlayDef {
  id: string;
  layer: OverlayLayer;
  /** A modal overlay turns global single keys off while it is on top. Find, Laws and Settings are modal, the docket uses a key scope. */
  modal: boolean;
  Component: ComponentType<{ arg: unknown }>;
}

const overlays = new Map<string, OverlayDef>();
export const registerOverlay = (def: OverlayDef): void => { overlays.set(def.id, def); };
export const overlayDef = (id: string): OverlayDef | undefined => overlays.get(id);

export type SlotName = 'followUp' | 'allStop';
const slots = new Map<SlotName, ComponentType<Record<string, never>>>();
export const registerSlot = (name: SlotName, Component: ComponentType<Record<string, never>>): void => { slots.set(name, Component); };
export const slotOf = (name: SlotName): ComponentType<Record<string, never>> | undefined => slots.get(name);

/** Named verbs the shell calls without knowing who does them. Each returns true when it acted. */
export type ActionName = 'attend' | 'stop' | 'allStop' | 'focusFollowUp' | 'addBudget' | 'fork' | 'resume';
type Action = (arg?: string) => boolean;
const actions = new Map<ActionName, Action>();
export const registerAction = (name: ActionName, run: Action): void => { actions.set(name, run); };
export const runAction = (name: ActionName, arg?: string): boolean => actions.get(name)?.(arg) ?? false;

export type KeyScope = 'global' | 'craft' | 'docket' | 'sky';

export interface KeyBinding {
  /** Same id replaces. That is how the docket takes over `attend.space`. */
  id: string;
  scope: KeyScope;
  match(e: KeyboardEvent): boolean;
  run(e: KeyboardEvent): void;
  /** Fires while typing in a text field too. Only Ctrl+. does (section 3.4). */
  inText?: boolean;
  /** Fires while a modal overlay is on top or single keys are off, because it is not a single key. */
  always?: boolean;
  /** Extra guard, read at key time. */
  when?(): boolean;
}

const bindings = new Map<string, KeyBinding>();
export const registerKeys = (list: readonly KeyBinding[]): void => { for (const b of list) bindings.set(b.id, b); };
export const unregisterKeys = (ids: readonly string[]): void => { for (const id of ids) bindings.delete(id); };
export const allKeys = (): KeyBinding[] => [...bindings.values()];

export type HudNode = ReactNode;

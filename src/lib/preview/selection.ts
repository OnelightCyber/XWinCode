import { create } from "zustand";

export interface ViewSelection {
  path: string;
  id: string;
  type: string;
  a: number;
  b: number;
}

export const useViewSelection = create<{ sel: ViewSelection | null }>(() => ({ sel: null }));

export const selectView = (sel: ViewSelection | null) => useViewSelection.setState({ sel });

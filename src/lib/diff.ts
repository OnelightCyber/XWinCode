export interface LineChange {
  kind: "add" | "mod" | "del";
  start: number;
  end: number;
}

type Hunk = [number, number, number, number];

const LIMIT = 1200;

function hunks(a: string[], b: string[]): Hunk[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, LIMIT);
  const base = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const i = k + base;
      const down = k === -d || (k !== d && v[i - 1] < v[i + 1]);
      let x = down ? v[i + 1] : v[i - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[i] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const steps: { x: number; y: number; insert: boolean }[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const i = k + base;
    const down = k === -d || (k !== d && prev[i - 1] < prev[i + 1]);
    const pk = down ? k + 1 : k - 1;
    const px = prev[pk + base];
    const py = px - pk;
    steps.push({ x: px, y: py, insert: down });
    x = px;
    y = py;
  }
  const out: Hunk[] = [];
  for (let s = steps.length - 1; s >= 0; s--) {
    const step = steps[s];
    const last = out[out.length - 1];
    if (last && last[1] === step.x && last[3] === step.y) {
      if (step.insert) last[3]++;
      else last[1]++;
    } else out.push(step.insert ? [step.x, step.x, step.y, step.y + 1] : [step.x, step.x + 1, step.y, step.y]);
  }
  return out;
}

export function lineChanges(before: string, after: string): LineChange[] {
  if (before === after) return [];
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const left = a.slice(head, a.length - tail);
  const right = b.slice(head, b.length - tail);
  const whole: Hunk[] = [[0, left.length, 0, right.length]];
  const list = left.length && right.length ? (hunks(left, right) ?? whole) : whole;
  const out: LineChange[] = [];
  for (const [a0, a1, b0, b1] of list) {
    const removed = a1 - a0;
    const added = b1 - b0;
    if (!removed && !added) continue;
    const start = head + b0 + 1;
    if (!added) out.push({ kind: "del", start: start - 1, end: start - 1 });
    else out.push({ kind: removed ? "mod" : "add", start, end: start + added - 1 });
  }
  return out;
}
